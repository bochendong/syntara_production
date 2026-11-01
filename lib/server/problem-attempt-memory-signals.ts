import { createHash } from 'node:crypto';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import type {
  NotebookProblemAttemptRecord,
  NotebookProblemRecord,
} from '@/lib/problem-bank/schema';
import {
  type StudyMemoryRecord,
  type StudyMemoryTargetType,
} from '@/lib/server/study-memory-store';
import { indexStudyMemoryRecord } from '@/lib/server/study-memory-vector-store';

const MEMORY_SIGNAL_MIN_NON_PASSING_ATTEMPTS = 2;
const MEMORY_SIGNAL_SOURCE = 'problem_attempt_inference';
const MEMORY_SIGNAL_KIND = 'problem_attempt_signal';
const MAX_EVIDENCE_ATTEMPTS = 30;
const MAX_PATTERN_ATTEMPT_CANDIDATES = 400;
/** 同一道题连续这么多次「运行测试」没通过，算一次卡住。 */
const RUN_FAILURE_STREAK = 3;

type ProblemAttemptMemoryState = 'active_gap' | 'improving' | 'resolved';

type ProblemAttemptMemoryEvidence = {
  version: 3;
  memoryKey: string;
  semanticPatternKey: string;
  signalType: 'problem_attempt_learning_state';
  state: ProblemAttemptMemoryState;
  sourceType: 'problem_attempt';
  /**
   * Keep the singular fields while version 2 readers still exist. Version 3
   * consumers should use the plural source lists below.
   */
  problemId: string;
  problemTitle: string;
  problemIds: string[];
  problemTitles: string[];
  courseId: string | null;
  notebookId: string | null;
  attemptIds: string[];
  nonPassingAttemptIds: string[];
  passingAttemptIds: string[];
  passingProblemIds: string[];
  /**
   * Passing evidence for the current repair cycle. These lists reset whenever
   * a new non-pass reopens the gap, while the source lists above remain an
   * append-only audit trail.
   */
  resolutionPassingAttemptIds: string[];
  resolutionPassingProblemIds: string[];
  latestAttemptId: string;
  latestAttemptStatus: string;
  tags: string[];
};

type ExistingProblemAttemptMemory = {
  id: string;
  title: string;
  text: string;
  state: ProblemAttemptMemoryState;
  evidence: ProblemAttemptMemoryEvidence;
};

export type ProblemAttemptMemorySignalPlan = {
  action:
    | 'skipped'
    | 'created'
    | 'strengthened'
    | 'improving'
    | 'resolved'
    | 'reactivated'
    | 'unchanged';
  state: ProblemAttemptMemoryState | null;
  reason: string;
  attemptIds: string[];
  nonPassingAttemptIds: string[];
  passingAttemptIds: string[];
  passingProblemIds: string[];
  resolutionPassingAttemptIds: string[];
  resolutionPassingProblemIds: string[];
  latestAttemptId: string | null;
  latestAttemptStatus: string | null;
};

export type ProblemAttemptMemorySignalResult = ProblemAttemptMemorySignalPlan & {
  memoryId: string | null;
};

type ProblemAttemptMemorySignalArgs = {
  prisma: PrismaClient;
  userId: string;
  courseId?: string | null;
  notebookId?: string | null;
  problem: SignalProblem;
  attempt: NotebookProblemAttemptRecord;
  recentAttempts: NotebookProblemAttemptRecord[];
};

type SignalProblem = Pick<
  NotebookProblemRecord,
  'id' | 'title' | 'type' | 'tags' | 'courseId' | 'notebookId'
>;

/**
 * 做题过程里哪些事算「卡住」：正式提交没过、看了参考答案、看了隐藏测试、
 * 运行测试连续失败。看答案或隐藏测试之后再做对，不算独立做对。
 */
export type ProblemLearningSignal =
  | 'formal_failed'
  | 'solution_viewed'
  | 'hidden_tests_viewed'
  | 'run_streak'
  | 'passed';

type DerivedLearningEvidence = PatternAttemptEvidence & {
  signal: ProblemLearningSignal;
  sourceAttemptId: string;
};

type RawStudyMemoryRow = Omit<StudyMemoryRecord, 'createdAt' | 'updatedAt'> & {
  createdAt: Date | string;
  updatedAt: Date | string;
};

type SignalTarget = {
  targetType: Exclude<StudyMemoryTargetType, 'platform'>;
  targetId: string;
  courseId: string | null;
  notebookId: string | null;
};

type SemanticProblemPattern = {
  key: string;
  normalizedTags: string[];
  isConceptPattern: boolean;
};

type PatternAttemptEvidence = {
  attempt: NotebookProblemAttemptRecord;
  problemId: string;
  problemTitle: string;
  problemType: string;
  normalizedTags: string[];
};

type RawPatternAttemptRow = {
  id: string;
  problemId: string;
  userId: string;
  kind: string;
  status: string;
  score: number | null;
  answerJson: unknown;
  resultJson: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  problemTitle: string;
  problemType: string;
  problemTags: string[];
};

const STUDY_MEMORY_COLUMNS = `
  "id", "ownerId", "courseId", "notebookId", "targetType", "scope", "kind", "status",
  "source", "title", "text", "reason", "question", "sourceReferences", "createdAt", "updatedAt"
`;

function isNonPassingAttempt(attempt: NotebookProblemAttemptRecord) {
  return attempt.status === 'failed' || attempt.status === 'partial';
}

function isFormalAttempt(attempt: NotebookProblemAttemptRecord) {
  return attempt.kind === 'submit' || attempt.kind === 'answer';
}

function isReliableLearningAttempt(attempt: NotebookProblemAttemptRecord) {
  return (
    isFormalAttempt(attempt) &&
    (attempt.status === 'passed' || attempt.status === 'failed' || attempt.status === 'partial')
  );
}

function attemptEvent(attempt: NotebookProblemAttemptRecord) {
  const event = attempt.result?.event;
  return typeof event === 'string' ? event : null;
}

function isHelpEvent(event: string | null): event is 'solution_viewed' | 'hidden_tests_viewed' {
  return event === 'solution_viewed' || event === 'hidden_tests_viewed';
}

function isTestRun(attempt: NotebookProblemAttemptRecord) {
  return attempt.kind === 'run' && (attempt.result?.runTarget ?? 'public') !== 'code';
}

/** 便宜的预筛：明显不会产生学习证据的作答直接跳过，不查数据库。 */
function mayProduceLearningEvidence(attempt: NotebookProblemAttemptRecord) {
  const event = attemptEvent(attempt);
  if (event) return isHelpEvent(event);
  if (isTestRun(attempt)) return isNonPassingAttempt(attempt);
  return isReliableLearningAttempt(attempt);
}

function syntheticFailure(
  item: PatternAttemptEvidence,
  id: string,
  feedback: string,
): NotebookProblemAttemptRecord {
  return {
    ...item.attempt,
    id,
    kind: 'answer',
    status: 'failed',
    result: { ...(item.attempt.result ?? { publicCases: [] }), feedback },
  } as NotebookProblemAttemptRecord;
}

/**
 * 把一道道题的原始记录（提交、运行、查看答案/隐藏测试）换成记忆用的证据：
 * - 正式提交没过：一次卡住；
 * - 做对之前看了参考答案或隐藏测试：一次卡住，之后这道题再做对也不算独立做对；
 * - 运行测试（公开或隐藏）连续 3 次没过：一次卡住，做对或提交后重新计数；
 * - 只运行代码、重置作答、评测出错：不算。
 */
export function deriveProblemLearningEvidence(
  items: PatternAttemptEvidence[],
): DerivedLearningEvidence[] {
  const byProblem = new Map<string, PatternAttemptEvidence[]>();
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.attempt.id)) continue;
    seen.add(item.attempt.id);
    const list = byProblem.get(item.problemId) ?? [];
    list.push(item);
    byProblem.set(item.problemId, list);
  }
  const derived: DerivedLearningEvidence[] = [];
  for (const list of byProblem.values()) {
    list.sort(
      (left, right) =>
        left.attempt.createdAt - right.attempt.createdAt ||
        left.attempt.id.localeCompare(right.attempt.id),
    );
    let assisted = false;
    let passedIndependently = false;
    let streak = 0;
    let streakStart: string | null = null;
    for (const item of list) {
      const attempt = item.attempt;
      const event = attemptEvent(attempt);
      if (event) {
        if (!isHelpEvent(event) || passedIndependently) continue;
        assisted = true;
        derived.push({
          ...item,
          attempt: syntheticFailure(
            item,
            attempt.id,
            event === 'solution_viewed'
              ? '还没做对就查看了参考答案。'
              : '还没做对就查看了隐藏测试。',
          ),
          signal: event,
          sourceAttemptId: attempt.id,
        });
        continue;
      }
      if (isFormalAttempt(attempt)) {
        streak = 0;
        streakStart = null;
        if (attempt.status === 'passed') {
          if (assisted) continue;
          passedIndependently = true;
          derived.push({ ...item, signal: 'passed', sourceAttemptId: attempt.id });
        } else if (isNonPassingAttempt(attempt)) {
          derived.push({ ...item, signal: 'formal_failed', sourceAttemptId: attempt.id });
        }
        continue;
      }
      if (!isTestRun(attempt)) continue;
      if (attempt.status === 'passed') {
        streak = 0;
        streakStart = null;
        continue;
      }
      if (!isNonPassingAttempt(attempt)) continue;
      streak += 1;
      streakStart ??= attempt.id;
      if (streak !== RUN_FAILURE_STREAK) continue;
      const original = attemptFeedback(attempt);
      derived.push({
        ...item,
        attempt: syntheticFailure(
          item,
          `run-streak:${streakStart}`,
          `运行测试连续 ${RUN_FAILURE_STREAK} 次没通过。${original}`.trim(),
        ),
        signal: 'run_streak',
        sourceAttemptId: attempt.id,
      });
    }
  }
  return derived.sort(
    (left, right) =>
      right.attempt.createdAt - left.attempt.createdAt ||
      right.attempt.id.localeCompare(left.attempt.id),
  );
}

function compact(value: string | null | undefined, maxChars: number) {
  const text = value?.replace(/\s+/g, ' ').trim() || '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function attemptFeedback(attempt: NotebookProblemAttemptRecord | undefined) {
  if (!attempt) return '';
  return compact(
    [attempt.result?.feedback, attempt.result?.analysis]
      .map((item) => item?.trim())
      .filter(Boolean)
      .join(' '),
    240,
  );
}

function normalizeConceptTag(value: string) {
  return value.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
}

function normalizedConceptTags(tags: string[]) {
  return Array.from(new Set(tags.map(normalizeConceptTag).filter(Boolean))).sort();
}

function sameStrings(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function semanticProblemAttemptPattern(problem: Pick<NotebookProblemRecord, 'id' | 'tags'>) {
  const normalizedTags = normalizedConceptTags(problem.tags);
  if (normalizedTags.length === 0) {
    return {
      key: `problem:${problem.id}`,
      normalizedTags,
      isConceptPattern: false,
    } satisfies SemanticProblemPattern;
  }
  const digest = createHash('sha256')
    .update(normalizedTags.join('\u001f'))
    .digest('hex')
    .slice(0, 24);
  return {
    key: `concept-tags:${digest}`,
    normalizedTags,
    isConceptPattern: true,
  } satisfies SemanticProblemPattern;
}

function uniqueIds(...groups: Array<Array<string | null | undefined>>) {
  return Array.from(
    new Set(
      groups
        .flat()
        .map((id) => id?.trim())
        .filter((id): id is string => Boolean(id)),
    ),
  )
    .sort()
    .slice(-MAX_EVIDENCE_ATTEMPTS);
}

function uniqueStrings(...groups: Array<Array<string | null | undefined>>) {
  return Array.from(
    new Set(
      groups
        .flat()
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort();
}

function sameIds(left: string[], right: string[]) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function recentFormalAttempts(args: {
  attempt: NotebookProblemAttemptRecord;
  recentAttempts: NotebookProblemAttemptRecord[];
}) {
  const byId = new Map<string, NotebookProblemAttemptRecord>();
  for (const attempt of [...args.recentAttempts, args.attempt]) {
    if (isReliableLearningAttempt(attempt)) byId.set(attempt.id, attempt);
  }
  return [...byId.values()].sort(
    (left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id),
  );
}

function patternAttemptFromRow(row: RawPatternAttemptRow): PatternAttemptEvidence {
  return {
    attempt: {
      id: row.id,
      problemId: row.problemId,
      userId: row.userId,
      kind: row.kind as NotebookProblemAttemptRecord['kind'],
      status: row.status as NotebookProblemAttemptRecord['status'],
      score: row.score,
      answer: asRecord(row.answerJson),
      result: row.resultJson ? asRecord(row.resultJson) : undefined,
      createdAt: new Date(row.createdAt).getTime(),
      updatedAt: new Date(row.updatedAt).getTime(),
    } as NotebookProblemAttemptRecord,
    problemId: row.problemId,
    problemTitle: row.problemTitle,
    problemType: row.problemType,
    normalizedTags: normalizedConceptTags(row.problemTags || []),
  };
}

async function loadPatternAttemptEvidence(args: {
  prisma: PrismaClient;
  userId: string;
  target: SignalTarget;
  pattern: SemanticProblemPattern;
  problem: SignalProblem;
  attempt: NotebookProblemAttemptRecord;
  recentAttempts: NotebookProblemAttemptRecord[];
}): Promise<DerivedLearningEvidence[]> {
  const byAttemptId = new Map<string, PatternAttemptEvidence>();
  for (const attempt of [...args.recentAttempts, args.attempt]) {
    if (attempt.problemId !== args.problem.id) continue;
    byAttemptId.set(attempt.id, {
      attempt,
      problemId: args.problem.id,
      problemTitle: args.problem.title,
      problemType: args.problem.type,
      normalizedTags: args.pattern.normalizedTags,
    });
  }

  // Tagged problems share evidence with every same-tag problem in the target.
  // An untagged problem stays isolated to its own history.
  const rows = await args.prisma.$queryRawUnsafe<RawPatternAttemptRow[]>(
    `
      SELECT
        a."id",
        a."problemId",
        a."userId",
        a."kind"::text AS "kind",
        a."status"::text AS "status",
        a."score",
        a."answerJson",
        a."resultJson",
        a."createdAt",
        a."updatedAt",
        p."title" AS "problemTitle",
        p."type"::text AS "problemType",
        p."tags" AS "problemTags"
      FROM "NotebookProblemAttempt" AS a
      INNER JOIN "NotebookProblem" AS p ON p."id" = a."problemId"
      LEFT JOIN "Notebook" AS n ON n."id" = p."notebookId"
      WHERE
        a."userId" = $1
        AND a."kind"::text IN ('submit', 'answer', 'run')
        AND (
          ($2 = 'notebook' AND p."notebookId" = $3)
          OR ($2 = 'course' AND COALESCE(p."courseId", n."courseId") = $3)
        )
        AND ($5::text IS NULL OR a."problemId" = $5)
      ORDER BY a."createdAt" DESC
      LIMIT $4
    `,
    args.userId,
    args.target.targetType,
    args.target.targetId,
    MAX_PATTERN_ATTEMPT_CANDIDATES,
    args.pattern.isConceptPattern ? null : args.problem.id,
  );
  for (const row of rows) {
    const evidence = patternAttemptFromRow(row);
    if (args.pattern.isConceptPattern) {
      if (!sameStrings(evidence.normalizedTags, args.pattern.normalizedTags)) continue;
    } else if (evidence.problemId !== args.problem.id) {
      continue;
    }
    byAttemptId.set(evidence.attempt.id, evidence);
  }
  return deriveProblemLearningEvidence([...byAttemptId.values()]);
}

export function planProblemAttemptMemorySignal(args: {
  attempt: NotebookProblemAttemptRecord;
  recentAttempts: NotebookProblemAttemptRecord[];
  existing?: {
    state: ProblemAttemptMemoryState;
    attemptIds: string[];
    nonPassingAttemptIds: string[];
    passingAttemptIds: string[];
    passingProblemIds?: string[];
    resolutionPassingAttemptIds?: string[];
    resolutionPassingProblemIds?: string[];
    latestAttemptId: string;
    latestAttemptStatus: string;
  } | null;
}): ProblemAttemptMemorySignalPlan {
  if (!isReliableLearningAttempt(args.attempt)) {
    return {
      action: 'skipped',
      state: null,
      reason:
        'Run, pending, and error attempts remain practice evidence and do not promote durable learner memory.',
      attemptIds: [],
      nonPassingAttemptIds: [],
      passingAttemptIds: [],
      passingProblemIds: [],
      resolutionPassingAttemptIds: [],
      resolutionPassingProblemIds: [],
      latestAttemptId: null,
      latestAttemptStatus: null,
    };
  }

  const formalAttempts = recentFormalAttempts(args);
  const latestAttempt = args.attempt;
  const recentNonPassingIds = formalAttempts.filter(isNonPassingAttempt).map((item) => item.id);
  const recentPassingIds = formalAttempts
    .filter((item) => item.status === 'passed')
    .map((item) => item.id);
  const nonPassingAttemptIds = uniqueIds(
    args.existing?.nonPassingAttemptIds || [],
    recentNonPassingIds,
  );
  const passingAttemptIds = uniqueIds(args.existing?.passingAttemptIds || [], recentPassingIds);
  const passingProblemIds = uniqueStrings(
    args.existing?.passingProblemIds || [],
    formalAttempts.filter((item) => item.status === 'passed').map((item) => item.problemId),
  );
  const attemptIds = uniqueIds(
    args.existing?.attemptIds || [],
    nonPassingAttemptIds,
    passingAttemptIds,
  );
  const representedAttempt = args.existing?.attemptIds.includes(args.attempt.id);

  if (args.existing && representedAttempt) {
    return {
      action: 'unchanged',
      state: args.existing.state,
      reason: 'This attempt is already represented by the durable learner memory.',
      attemptIds: uniqueIds(args.existing.attemptIds),
      nonPassingAttemptIds: uniqueIds(args.existing.nonPassingAttemptIds),
      passingAttemptIds: uniqueIds(args.existing.passingAttemptIds),
      passingProblemIds: uniqueStrings(args.existing.passingProblemIds || []),
      resolutionPassingAttemptIds: uniqueIds(args.existing.resolutionPassingAttemptIds || []),
      resolutionPassingProblemIds: uniqueStrings(args.existing.resolutionPassingProblemIds || []),
      latestAttemptId: args.existing.latestAttemptId,
      latestAttemptStatus: args.existing.latestAttemptStatus,
    };
  }

  const existingResolutionPassingAttemptIds = uniqueIds(
    args.existing?.resolutionPassingAttemptIds || [],
  );
  const existingResolutionPassingProblemIds = uniqueStrings(
    args.existing?.resolutionPassingProblemIds || [],
    formalAttempts
      .filter(
        (item) => item.status === 'passed' && existingResolutionPassingAttemptIds.includes(item.id),
      )
      .map((item) => item.problemId),
  );
  const resolutionPassingAttemptIds =
    latestAttempt.status === 'passed'
      ? uniqueIds(existingResolutionPassingAttemptIds, [latestAttempt.id])
      : [];
  const resolutionPassingProblemIds =
    latestAttempt.status === 'passed'
      ? uniqueStrings(existingResolutionPassingProblemIds, [latestAttempt.problemId])
      : [];

  if (nonPassingAttemptIds.length < MEMORY_SIGNAL_MIN_NON_PASSING_ATTEMPTS) {
    return {
      action: 'skipped',
      state: null,
      reason: 'A single non-passing result stays in short-term state and attempt history.',
      attemptIds,
      nonPassingAttemptIds,
      passingAttemptIds,
      passingProblemIds,
      resolutionPassingAttemptIds,
      resolutionPassingProblemIds,
      latestAttemptId: latestAttempt.id,
      latestAttemptStatus: latestAttempt.status,
    };
  }

  const state: ProblemAttemptMemoryState =
    latestAttempt.status !== 'passed'
      ? 'active_gap'
      : args.existing?.state === 'resolved' || resolutionPassingProblemIds.length >= 2
        ? 'resolved'
        : 'improving';
  const unchanged = Boolean(
    args.existing &&
    args.existing.state === state &&
    args.existing.latestAttemptId === latestAttempt.id &&
    args.existing.latestAttemptStatus === latestAttempt.status &&
    sameIds(uniqueIds(args.existing.attemptIds), attemptIds) &&
    sameIds(uniqueIds(args.existing.nonPassingAttemptIds), nonPassingAttemptIds) &&
    sameIds(uniqueIds(args.existing.passingAttemptIds), passingAttemptIds) &&
    sameIds(
      uniqueIds(args.existing.resolutionPassingAttemptIds || []),
      resolutionPassingAttemptIds,
    ) &&
    sameIds(
      uniqueStrings(args.existing.resolutionPassingProblemIds || []),
      resolutionPassingProblemIds,
    ),
  );

  if (unchanged) {
    return {
      action: 'unchanged',
      state,
      reason: 'This attempt is already represented by the durable learner memory.',
      attemptIds,
      nonPassingAttemptIds,
      passingAttemptIds,
      passingProblemIds,
      resolutionPassingAttemptIds,
      resolutionPassingProblemIds,
      latestAttemptId: latestAttempt.id,
      latestAttemptStatus: latestAttempt.status,
    };
  }

  const action: ProblemAttemptMemorySignalPlan['action'] =
    state === 'resolved'
      ? 'resolved'
      : state === 'improving'
        ? 'improving'
        : args.existing?.state === 'resolved'
          ? 'reactivated'
          : args.existing
            ? 'strengthened'
            : 'created';

  return {
    action,
    state,
    reason:
      state === 'resolved'
        ? `Independent passing attempts on ${resolutionPassingProblemIds.length} same-pattern problems close this durable gap.`
        : state === 'improving'
          ? 'A later passing attempt is positive counter-evidence, but one pass does not prove durable mastery.'
          : action === 'reactivated'
            ? 'A new non-passing attempt reopens the previously resolved same-pattern gap.'
            : `${nonPassingAttemptIds.length} formal non-passing attempts support a durable learning gap.`,
    attemptIds,
    nonPassingAttemptIds,
    passingAttemptIds,
    passingProblemIds,
    resolutionPassingAttemptIds,
    resolutionPassingProblemIds,
    latestAttemptId: latestAttempt.id,
    latestAttemptStatus: latestAttempt.status,
  };
}

function resolveSignalTarget(args: ProblemAttemptMemorySignalArgs): SignalTarget | null {
  const notebookId = args.notebookId?.trim() || args.problem.notebookId?.trim() || null;
  const courseId = args.courseId?.trim() || args.problem.courseId?.trim() || null;
  // 学习记忆按课程放（App 的记忆页和星图按课程读），notebookId 只用来连到章节。
  if (courseId) {
    return {
      targetType: 'course',
      targetId: courseId,
      courseId,
      notebookId,
    };
  }
  if (notebookId) {
    return {
      targetType: 'notebook',
      targetId: notebookId,
      courseId,
      notebookId,
    };
  }
  return null;
}

function memoryKey(target: SignalTarget, pattern: SemanticProblemPattern) {
  return `problem-attempt-learning:${target.targetType}:${target.targetId}:${pattern.key}`;
}

function deterministicMemoryId(userId: string, key: string) {
  const digest = createHash('sha256').update(`${userId}:${key}`).digest('hex').slice(0, 32);
  return `memory_problem_attempt_${digest}`;
}

function serializeStudyMemory(row: RawStudyMemoryRow): StudyMemoryRecord {
  return {
    ...row,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringIds(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function existingEvidence(args: {
  memory: RawStudyMemoryRow | null;
  key: string;
  pattern: SemanticProblemPattern;
  problem: SignalProblem;
  target: SignalTarget;
}): ExistingProblemAttemptMemory | null {
  if (!args.memory) return null;
  const raw = asRecord(args.memory.sourceReferences);
  const attemptIds = stringIds(raw.attemptIds);
  const nonPassingAttemptIds = stringIds(raw.nonPassingAttemptIds);
  const passingAttemptIds = stringIds(raw.passingAttemptIds);
  const passingProblemIds = stringIds(raw.passingProblemIds);
  const legacyLatestStatus = String(raw.latestAttemptStatus || '').trim();
  const inferredState: ProblemAttemptMemoryState =
    raw.state === 'resolved' || args.memory.status === 'archived'
      ? 'resolved'
      : raw.state === 'improving' || args.memory.title.includes('改善中')
        ? 'improving'
        : 'active_gap';
  const normalizedNonPassingIds =
    nonPassingAttemptIds.length > 0
      ? nonPassingAttemptIds
      : legacyLatestStatus === 'passed'
        ? []
        : attemptIds;
  const normalizedPassingIds =
    passingAttemptIds.length > 0
      ? passingAttemptIds
      : legacyLatestStatus === 'passed'
        ? attemptIds.slice(-1)
        : [];
  const latestAttemptId =
    String(raw.latestAttemptId || '').trim() || attemptIds.at(-1) || args.memory.id;
  const legacyProblemId = String(raw.problemId || '').trim();
  const legacyProblemTitle = String(raw.problemTitle || '').trim();
  const problemIds = uniqueStrings(stringIds(raw.problemIds), [legacyProblemId]);
  const problemTitles = uniqueStrings(stringIds(raw.problemTitles), [legacyProblemTitle]);
  const hasResolutionAttemptIds = Array.isArray(raw.resolutionPassingAttemptIds);
  const hasResolutionProblemIds = Array.isArray(raw.resolutionPassingProblemIds);
  const resolutionPassingAttemptIds = hasResolutionAttemptIds
    ? stringIds(raw.resolutionPassingAttemptIds)
    : inferredState === 'active_gap'
      ? []
      : normalizedPassingIds;
  const resolutionPassingProblemIds = hasResolutionProblemIds
    ? stringIds(raw.resolutionPassingProblemIds)
    : inferredState === 'active_gap'
      ? []
      : passingProblemIds;

  return {
    id: args.memory.id,
    title: args.memory.title,
    text: args.memory.text,
    state: inferredState,
    evidence: {
      version: 3,
      memoryKey: args.key,
      semanticPatternKey: args.pattern.key,
      signalType: 'problem_attempt_learning_state',
      state: inferredState,
      sourceType: 'problem_attempt',
      problemId: legacyProblemId || problemIds.at(-1) || args.problem.id,
      problemTitle: legacyProblemTitle || problemTitles.at(-1) || args.problem.title,
      problemIds,
      problemTitles,
      courseId: args.target.courseId,
      notebookId: args.target.notebookId,
      attemptIds: uniqueIds(attemptIds, normalizedNonPassingIds, normalizedPassingIds),
      nonPassingAttemptIds: uniqueIds(normalizedNonPassingIds),
      passingAttemptIds: uniqueIds(normalizedPassingIds),
      passingProblemIds: uniqueStrings(passingProblemIds),
      resolutionPassingAttemptIds: uniqueIds(resolutionPassingAttemptIds),
      resolutionPassingProblemIds: uniqueStrings(resolutionPassingProblemIds),
      latestAttemptId,
      latestAttemptStatus: legacyLatestStatus || 'failed',
      tags: args.pattern.normalizedTags,
    },
  };
}

type SignalCounts = Record<Exclude<ProblemLearningSignal, 'passed'>, number>;

function countSignals(evidence: DerivedLearningEvidence[], nonPassingIds: string[]): SignalCounts {
  const ids = new Set(nonPassingIds);
  const counts: SignalCounts = {
    formal_failed: 0,
    solution_viewed: 0,
    hidden_tests_viewed: 0,
    run_streak: 0,
  };
  for (const item of evidence) {
    if (item.signal === 'passed' || !ids.has(item.attempt.id)) continue;
    counts[item.signal] += 1;
  }
  return counts;
}

function signalSummary(counts: SignalCounts | undefined, fallbackTotal: number) {
  if (!counts) return `${fallbackTotal} 次没做对`;
  const parts = [
    counts.formal_failed ? `提交没过 ${counts.formal_failed} 次` : '',
    counts.solution_viewed ? `看了参考答案 ${counts.solution_viewed} 次` : '',
    counts.hidden_tests_viewed ? `看了隐藏测试 ${counts.hidden_tests_viewed} 次` : '',
    counts.run_streak ? `运行测试连续失败 ${counts.run_streak} 轮` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('，') : `${fallbackTotal} 次没做对`;
}

function memoryText(args: {
  problem: SignalProblem;
  plan: ProblemAttemptMemorySignalPlan;
  latestAttempt: NotebookProblemAttemptRecord | undefined;
  latestNonPassingAttempt: NotebookProblemAttemptRecord | undefined;
  sourceProblems: Array<{ id: string; title: string; type: string }>;
  normalizedTags: string[];
  signalCounts?: SignalCounts;
}) {
  const gapFeedback = attemptFeedback(args.latestNonPassingAttempt);
  const topic =
    args.normalizedTags.length > 0
      ? args.normalizedTags.join('、')
      : compact(args.problem.title, 40);
  const sourceSummary =
    args.sourceProblems
      .slice(0, 6)
      .map((source) => `「${compact(source.title, 40)}」`)
      .join('、') || `「${compact(args.problem.title, 40)}」`;
  const stuck = signalSummary(args.signalCounts, args.plan.nonPassingAttemptIds.length);

  if (args.plan.state === 'resolved') {
    return [
      `「${topic}」这个卡点已关闭：之后在 ${args.plan.resolutionPassingProblemIds.length} 道不同的同类题上独立做对了。`,
      `之前卡住的情况：${stuck}。`,
      `来源题目：${sourceSummary}。`,
    ].join('\n');
  }

  if (args.plan.state === 'improving') {
    return [
      `「${topic}」改善中：之前${stuck}，最近一次独立做对了。`,
      '再独立做对一道不同的同类题，才算真正过关。',
      `来源题目：${sourceSummary}。`,
    ].join('\n');
  }

  return [
    `「${topic}」还没过关：${stuck}。`,
    gapFeedback ? `最近的错因：${gapFeedback}` : '',
    `来源题目：${sourceSummary}。`,
    '下次先找出错的那一步，再做一道同类小题确认。',
  ]
    .filter(Boolean)
    .join('\n');
}

async function findExistingMemory(args: {
  prisma: PrismaClient;
  userId: string;
  target: SignalTarget;
  key: string;
  pattern: SemanticProblemPattern;
  problemId: string;
  fallbackId: string;
}) {
  const rows = await args.prisma.$queryRawUnsafe<RawStudyMemoryRow[]>(
    `
      SELECT ${STUDY_MEMORY_COLUMNS}
      FROM "StudyMemory"
      WHERE
        "ownerId" = $1
        AND "scope" = 'private'
        AND ("id" = $2 OR "source" = $3)
        AND (
          ($4 = 'notebook' AND "targetType" = 'notebook' AND "notebookId" = $5)
          -- 早先按笔记本存的做题记忆也归到课程里，避免同一个卡点出现两颗。
          OR ($4 = 'course' AND "targetType" IN ('course', 'notebook') AND "courseId" = $5)
        )
      ORDER BY "updatedAt" DESC
      LIMIT 100
    `,
    args.userId,
    args.fallbackId,
    MEMORY_SIGNAL_SOURCE,
    args.target.targetType,
    args.target.targetId,
  );
  return (
    rows.find((row) => row.id === args.fallbackId) ||
    rows.find((row) => {
      const raw = asRecord(row.sourceReferences);
      return String(raw.memoryKey || '').trim() === args.key;
    }) ||
    rows.find((row) => {
      const raw = asRecord(row.sourceReferences);
      const storedPatternKey = String(raw.semanticPatternKey || '').trim();
      if (storedPatternKey) return storedPatternKey === args.pattern.key;

      // Version 2 stored only a singular problem id and raw tags. Tagged
      // records can be adopted by the new semantic key; untagged records must
      // remain isolated to their original problem.
      const legacyProblemId = String(raw.problemId || '').trim();
      const legacyTags = normalizedConceptTags(stringIds(raw.tags));
      return args.pattern.isConceptPattern
        ? sameStrings(legacyTags, args.pattern.normalizedTags)
        : legacyProblemId === args.problemId;
    }) ||
    null
  );
}

async function upsertMemory(args: {
  prisma: PrismaClient;
  id: string;
  userId: string;
  target: SignalTarget;
  title: string;
  text: string;
  reason: string;
  evidence: ProblemAttemptMemoryEvidence;
  status: 'active' | 'archived';
}) {
  const rows = await args.prisma.$queryRawUnsafe<RawStudyMemoryRow[]>(
    `
      INSERT INTO "StudyMemory" (
        "id", "ownerId", "courseId", "notebookId", "targetType",
        "scope", "kind", "status", "source", "title", "text",
        "reason", "question", "sourceReferences", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, $5,
        'private', $6, $7, $8, $9, $10,
        $11, NULL, $12::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("id") DO UPDATE SET
        "courseId" = EXCLUDED."courseId",
        "notebookId" = EXCLUDED."notebookId",
        "targetType" = EXCLUDED."targetType",
        "kind" = EXCLUDED."kind",
        "status" = EXCLUDED."status",
        "source" = EXCLUDED."source",
        "title" = EXCLUDED."title",
        "text" = EXCLUDED."text",
        "reason" = EXCLUDED."reason",
        "sourceReferences" = EXCLUDED."sourceReferences",
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "StudyMemory"."ownerId" = EXCLUDED."ownerId"
      RETURNING ${STUDY_MEMORY_COLUMNS}
    `,
    args.id,
    args.userId,
    args.target.courseId,
    args.target.notebookId,
    args.target.targetType,
    MEMORY_SIGNAL_KIND,
    args.status,
    MEMORY_SIGNAL_SOURCE,
    args.title,
    args.text,
    args.reason,
    JSON.stringify(args.evidence),
  );
  if (!rows[0]) throw new Error('Problem-attempt memory upsert did not return a row');
  return rows[0];
}

export async function maybeWriteProblemAttemptMemorySignal(
  args: ProblemAttemptMemorySignalArgs,
): Promise<ProblemAttemptMemorySignalResult> {
  if (!mayProduceLearningEvidence(args.attempt)) {
    const plan = planProblemAttemptMemorySignal({
      attempt: args.attempt,
      recentAttempts: args.recentAttempts,
    });
    return { ...plan, memoryId: null };
  }

  const target = resolveSignalTarget(args);
  if (!target) {
    return {
      action: 'skipped',
      state: null,
      reason: 'The problem has no course or notebook target for private learner memory.',
      attemptIds: [],
      nonPassingAttemptIds: [],
      passingAttemptIds: [],
      passingProblemIds: [],
      resolutionPassingAttemptIds: [],
      resolutionPassingProblemIds: [],
      latestAttemptId: args.attempt.id,
      latestAttemptStatus: args.attempt.status,
      memoryId: null,
    };
  }

  const pattern = semanticProblemAttemptPattern(args.problem);
  const key = memoryKey(target, pattern);
  const stableId = deterministicMemoryId(args.userId, key);
  let result: ProblemAttemptMemorySignalResult | null = null;

  const written = await args.prisma.$transaction(async (tx): Promise<RawStudyMemoryRow | null> => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `${args.userId}:${key}`);
    const existingRow = await findExistingMemory({
      prisma: tx as PrismaClient,
      userId: args.userId,
      target,
      key,
      pattern,
      problemId: args.problem.id,
      fallbackId: stableId,
    });
    const existing = existingEvidence({
      memory: existingRow,
      key,
      pattern,
      problem: args.problem,
      target,
    });
    const patternAttemptEvidence = await loadPatternAttemptEvidence({
      prisma: tx as PrismaClient,
      userId: args.userId,
      target,
      pattern,
      problem: args.problem,
      attempt: args.attempt,
      recentAttempts: args.recentAttempts,
    });
    const triggerEvidence = patternAttemptEvidence.find(
      (item) => item.sourceAttemptId === args.attempt.id,
    );
    if (!triggerEvidence) {
      result = {
        action: 'skipped',
        state: existing?.state ?? null,
        reason:
          'This record is not learning evidence on its own (a short run streak, an assisted pass, or a repeat view).',
        attemptIds: [],
        nonPassingAttemptIds: [],
        passingAttemptIds: [],
        passingProblemIds: [],
        resolutionPassingAttemptIds: [],
        resolutionPassingProblemIds: [],
        latestAttemptId: args.attempt.id,
        latestAttemptStatus: args.attempt.status,
        memoryId: existing?.id || null,
      };
      return null;
    }
    const plan = planProblemAttemptMemorySignal({
      attempt: triggerEvidence.attempt,
      recentAttempts: patternAttemptEvidence.map((item) => item.attempt),
      existing: existing?.evidence,
    });

    if (plan.action === 'skipped' || plan.action === 'unchanged' || !plan.state) {
      result = {
        ...plan,
        memoryId: existing?.id || null,
      };
      return null;
    }

    const formalAttempts = recentFormalAttempts({
      attempt: triggerEvidence.attempt,
      recentAttempts: patternAttemptEvidence.map((item) => item.attempt),
    });
    const signalCounts = countSignals(patternAttemptEvidence, plan.nonPassingAttemptIds);
    const latestAttempt = formalAttempts.find((attempt) => attempt.id === plan.latestAttemptId);
    const latestNonPassingAttempt = formalAttempts.find(isNonPassingAttempt);
    const representedAttemptIds = new Set(plan.attemptIds);
    const representedProblems = patternAttemptEvidence.filter((item) =>
      representedAttemptIds.has(item.attempt.id),
    );
    const problemIds = uniqueStrings(
      existing?.evidence.problemIds || [],
      representedProblems.map((item) => item.problemId),
      [args.problem.id],
    );
    const problemTitles = uniqueStrings(
      existing?.evidence.problemTitles || [],
      representedProblems.map((item) => item.problemTitle),
      [args.problem.title],
    );
    const sourceProblemsById = new Map<string, { id: string; title: string; type: string }>();
    for (const item of representedProblems) {
      sourceProblemsById.set(item.problemId, {
        id: item.problemId,
        title: item.problemTitle,
        type: item.problemType,
      });
    }
    sourceProblemsById.set(args.problem.id, {
      id: args.problem.id,
      title: args.problem.title,
      type: args.problem.type,
    });
    const sourceProblems = [...sourceProblemsById.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
    const evidence: ProblemAttemptMemoryEvidence = {
      version: 3,
      memoryKey: key,
      semanticPatternKey: pattern.key,
      signalType: 'problem_attempt_learning_state',
      state: plan.state,
      sourceType: 'problem_attempt',
      problemId: args.problem.id,
      problemTitle: args.problem.title,
      problemIds,
      problemTitles,
      courseId: target.courseId,
      notebookId: target.notebookId,
      attemptIds: plan.attemptIds,
      nonPassingAttemptIds: plan.nonPassingAttemptIds,
      passingAttemptIds: plan.passingAttemptIds,
      passingProblemIds: plan.passingProblemIds,
      resolutionPassingAttemptIds: plan.resolutionPassingAttemptIds,
      resolutionPassingProblemIds: plan.resolutionPassingProblemIds,
      latestAttemptId: plan.latestAttemptId || args.attempt.id,
      latestAttemptStatus: plan.latestAttemptStatus || args.attempt.status,
      tags: pattern.normalizedTags,
    };
    const patternTitle =
      pattern.normalizedTags.length > 0
        ? pattern.normalizedTags.join('、')
        : compact(args.problem.title, 80);
    const title =
      plan.state === 'resolved'
        ? `已关闭：${patternTitle}`
        : plan.state === 'improving'
          ? `改善中：${patternTitle}`
          : `卡点：${patternTitle}`;
    const writtenMemory = await upsertMemory({
      prisma: tx as PrismaClient,
      id: existing?.id || stableId,
      userId: args.userId,
      target,
      title,
      text: memoryText({
        problem: args.problem,
        plan,
        latestAttempt,
        latestNonPassingAttempt,
        sourceProblems,
        normalizedTags: pattern.normalizedTags,
        signalCounts,
      }),
      reason: plan.reason,
      evidence,
      status: plan.state === 'resolved' ? 'archived' : 'active',
    });
    result = {
      ...plan,
      memoryId: writtenMemory.id,
    };
    return writtenMemory;
  });

  if (written) {
    try {
      await indexStudyMemoryRecord(args.prisma, serializeStudyMemory(written));
    } catch (error) {
      console.warn('[problem-attempt-memory] failed to refresh vector index', {
        memoryId: written.id,
        error,
      });
    }
  }

  return (
    result || {
      action: 'skipped',
      state: null,
      reason: 'No durable memory update was required.',
      attemptIds: [],
      nonPassingAttemptIds: [],
      passingAttemptIds: [],
      passingProblemIds: [],
      resolutionPassingAttemptIds: [],
      resolutionPassingProblemIds: [],
      latestAttemptId: args.attempt.id,
      latestAttemptStatus: args.attempt.status,
      memoryId: null,
    }
  );
}

/**
 * 每次做题记录（提交、运行测试、查看答案/隐藏测试）存好之后调用。
 * 记忆只是附带产物：任何失败都只记日志，不影响作答本身。
 */
export async function recordProblemAttemptMemorySignal(args: {
  prisma: PrismaClient;
  attempt: NotebookProblemAttemptRecord;
}): Promise<ProblemAttemptMemorySignalResult | null> {
  if (!mayProduceLearningEvidence(args.attempt)) return null;
  const problem = await args.prisma.notebookProblem.findUnique({
    where: { id: args.attempt.problemId },
    select: {
      id: true,
      title: true,
      type: true,
      tags: true,
      courseId: true,
      notebookId: true,
      notebook: { select: { courseId: true } },
    },
  });
  if (!problem) return null;
  return maybeWriteProblemAttemptMemorySignal({
    prisma: args.prisma,
    userId: args.attempt.userId,
    courseId: problem.courseId || problem.notebook?.courseId || null,
    notebookId: problem.notebookId,
    problem: {
      id: problem.id,
      title: problem.title,
      type: problem.type as SignalProblem['type'],
      tags: problem.tags,
      courseId: problem.courseId || problem.notebook?.courseId || null,
      notebookId: problem.notebookId,
    },
    attempt: args.attempt,
    recentAttempts: [args.attempt],
  });
}
