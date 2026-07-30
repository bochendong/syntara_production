import type { NextRequest } from 'next/server';
import { z } from 'zod';

import {
  decideTeachingTurn,
  learnTurnDecisionToResponse,
  type LearnAction,
  type LearnArtifact,
  type LearnEvidenceLink,
  type LearnProblemBankSearchResult,
  type LearnTurnDecision,
} from '@/features/learn-core';
import { createRequestSemanticRouter } from '@/features/learn-core/server/semantic-router-runtime';
import { generatePublicExplanation } from '@/features/public-api/server/explanation';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

const MAX_CONTEXT_ITEM_CHARS = 30_000;
const MAX_CONTEXT_DEPTH = 8;
const MAX_CONTEXT_NODES = 1_000;

function boundedContextIssue(root: unknown): string | null {
  const stack: Array<{ depth: number; value: unknown }> = [{ depth: 0, value: root }];
  let approximateChars = 0;
  let nodes = 0;

  while (stack.length) {
    const current = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_CONTEXT_NODES) return `contains more than ${MAX_CONTEXT_NODES} values`;
    if (current.depth > MAX_CONTEXT_DEPTH) return `exceeds nesting depth ${MAX_CONTEXT_DEPTH}`;

    if (typeof current.value === 'string') {
      approximateChars += current.value.length;
    } else if (Array.isArray(current.value)) {
      approximateChars += current.value.length;
      for (const value of current.value) {
        stack.push({ depth: current.depth + 1, value });
      }
    } else if (current.value && typeof current.value === 'object') {
      const entries = Object.entries(current.value as Record<string, unknown>);
      approximateChars += entries.reduce((total, [key]) => total + key.length, 0);
      for (const [, value] of entries) {
        stack.push({ depth: current.depth + 1, value });
      }
    } else {
      approximateChars += 16;
    }

    if (approximateChars > MAX_CONTEXT_ITEM_CHARS) {
      return `exceeds approximately ${MAX_CONTEXT_ITEM_CHARS} characters`;
    }
  }
  return null;
}

export const nativeBoundedRecordSchema = z
  .record(z.string().max(120), z.unknown())
  .superRefine((value, context) => {
    const issue = boundedContextIssue(value);
    if (issue) context.addIssue({ code: 'custom', message: `context item ${issue}` });
  });

export const nativeBoundedAttemptContextSchema = z.object({
  id: z.string().trim().max(200).optional(),
  problemId: z.string().trim().max(200).optional(),
  problemTitle: z.string().trim().max(300).optional(),
  title: z.string().trim().max(300).optional(),
  problemType: z.string().trim().max(80).optional(),
  status: z.string().trim().max(80).optional(),
  score: z.number().finite().nullable().optional(),
  attemptedCount: z.number().int().min(0).max(100_000).optional(),
  passedCount: z.number().int().min(0).max(100_000).optional(),
  answer: z.string().max(2_400).optional(),
  feedback: z.string().max(1_200).optional(),
  attemptedAt: z.string().trim().max(80).optional(),
});

export const nativeTeachingTurnRequestSchema = z.object({
  requestId: z.string().trim().min(1).max(160),
  clientTurnId: z.string().trim().min(1).max(160).optional(),
  question: z.string().trim().min(1).max(4000).optional(),
  course: z.object({
    id: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1).max(200),
    code: z.string().trim().max(80).nullish(),
    language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
    description: z.string().trim().max(4000).optional().default(''),
  }),
  conversation: z.object({
    id: z.string().trim().min(1).max(200).optional(),
    recentMessages: z
      .array(
        z.object({
          id: z.string().trim().max(200).optional(),
          role: z.enum(['user', 'assistant']),
          text: z.string().trim().max(4000),
        }),
      )
      .max(12),
  }),
  localContext: z
    .object({
      calendarEvents: z.array(nativeBoundedRecordSchema).max(120).default([]),
      memories: z.array(nativeBoundedRecordSchema).max(40).default([]),
      attempts: z.array(nativeBoundedAttemptContextSchema).max(24).default([]),
      problemCandidates: z.array(nativeBoundedRecordSchema).max(40).default([]),
      notebookExcerpts: z.array(nativeBoundedRecordSchema).max(12).default([]),
      sourceExcerpts: z.array(nativeBoundedRecordSchema).max(12).default([]),
      recentPlans: z.array(nativeBoundedRecordSchema).max(8).default([]),
    })
    .default({
      calendarEvents: [],
      memories: [],
      attempts: [],
      problemCandidates: [],
      notebookExcerpts: [],
      sourceExcerpts: [],
      recentPlans: [],
    }),
  preferences: z
    .object({
      language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
      allowWebSearch: z.boolean().default(false),
    })
    .default({ language: 'zh-CN', allowWebSearch: false }),
});

export type NativeTeachingTurnRequest = z.infer<typeof nativeTeachingTurnRequestSchema>;

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function numberValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

function stringList(value: unknown, max = 20): string[] {
  return Array.isArray(value)
    ? value
        .filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
        .map((item) => item.trim())
        .slice(0, max)
    : [];
}

function selectedQuestion(input: NativeTeachingTurnRequest) {
  if (input.question?.trim()) return input.question.trim();
  const latestUserMessage = input.conversation.recentMessages
    .slice()
    .reverse()
    .find((message) => message.role === 'user');
  return latestUserMessage?.text.trim() ?? '';
}

function sourceNote(record: Record<string, unknown>, index: number, kind: string) {
  const content = textValue(record, 'content', 'text', 'excerpt', 'markdown', 'summary');
  if (!content) return null;
  return {
    title: textValue(record, 'title', 'name') || `${kind} ${index + 1}`,
    content: content.slice(0, 30_000),
    sourceRef: textValue(record, 'sourceRef', 'sourceId', 'id') || undefined,
  };
}

function learnerSummary(input: NativeTeachingTurnRequest) {
  const memories = input.localContext.memories
    .slice(0, 20)
    .map((item) => {
      const title = textValue(item, 'title', 'kind') || '学习记忆';
      const text = textValue(item, 'text', 'excerpt', 'summary');
      return text ? `- ${title}: ${text}` : '';
    })
    .filter(Boolean);
  const attempts = input.localContext.attempts.slice(0, 20).map((item) => {
    const record = recordValue(item);
    const title = textValue(record, 'title', 'problemTitle', 'problemId') || '作答';
    const status = textValue(record, 'status');
    const answer = textValue(record, 'answer').slice(0, 800);
    const feedback = textValue(record, 'feedback').slice(0, 600);
    const details = [
      status ? `状态：${status}` : '',
      answer ? `学生答案：${answer}` : '',
      feedback ? `批改反馈：${feedback}` : '',
    ].filter(Boolean);
    return `- ${title}: ${details.join('；') || '有作答记录'}`;
  });
  return [...memories, ...attempts].join('\n').slice(0, 4000);
}

function learnInput(input: NativeTeachingTurnRequest) {
  const question = selectedQuestion(input);
  const problems = input.localContext.problemCandidates;
  const notebookReady = input.localContext.notebookExcerpts.length > 0;
  const sourceReady = input.localContext.sourceExcerpts.length > 0;
  return {
    question,
    recentMessages: input.conversation.recentMessages.map(({ role, text }) => ({ role, text })),
    attachments: [],
    courseId: input.course.id,
    courseName: input.course.name,
    courseCode: input.course.code ?? undefined,
    hasSyllabus: input.localContext.calendarEvents.length > 0,
    progressKnown: input.localContext.memories.length > 0 || input.localContext.attempts.length > 0,
    learnerSnapshot: {
      memories: input.localContext.memories,
      attempts: input.localContext.attempts,
    },
    calendarEvents: input.localContext.calendarEvents,
    recentPlans: input.localContext.recentPlans,
    recentArtifacts: [],
    recentActions: [],
    recentActivities: [],
    problemBank: {
      available: problems.length > 0,
      activeCount: problems.length,
      samples: problems.slice(0, 12),
    },
    resourceStates: {
      notebooks: notebookReady ? ('ready' as const) : ('empty' as const),
      problems: problems.length ? ('ready' as const) : ('empty' as const),
      sources: sourceReady ? ('ready' as const) : ('empty' as const),
    },
    sourceUploads: input.localContext.sourceExcerpts,
    layeredMemorySummary: learnerSummary(input),
  };
}

function localProblemSearch(
  input: NativeTeachingTurnRequest,
  args: { query: string; requestedCount: number },
): LearnProblemBankSearchResult {
  const queryTerms = args.query.normalize('NFKC').toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const scored = input.localContext.problemCandidates
    .map((candidate) => {
      const id = textValue(candidate, 'problemId', 'id');
      const title = textValue(candidate, 'title') || id;
      const tags = stringList(candidate.tags, 12);
      const excerpt = textValue(candidate, 'excerpt', 'content', 'summary');
      const haystack = `${title} ${tags.join(' ')} ${excerpt}`
        .normalize('NFKC')
        .toLocaleLowerCase();
      const hits = queryTerms.filter((term) => haystack.includes(term)).length;
      return { candidate, id, title, tags, excerpt, hits };
    })
    .filter((item) => item.id && (queryTerms.length === 0 || item.hits > 0))
    .sort((left, right) => right.hits - left.hits || left.title.localeCompare(right.title))
    .slice(0, args.requestedCount);
  return {
    query: args.query,
    requestedCount: args.requestedCount,
    source: 'problem_bank_summary',
    matches: scored.map((item) => ({
      problemId: item.id,
      title: item.title,
      score: Math.min(96, 52 + item.hits * 14),
      reason: '匹配 App 上传的本机题库标题、标签或摘要。',
      excerpt: item.excerpt,
      tags: item.tags,
      difficulty: textValue(item.candidate, 'difficulty'),
      problemType: textValue(item.candidate, 'type'),
      attemptStatus: textValue(item.candidate, 'latestAttemptStatus', 'status') || null,
      metadata: { source: 'native-local-problem-candidate' },
    })),
    excluded: [],
    rationale: ['只从 App 提供的真实题目候选中选择，不生成题目补位。'],
    gaps:
      scored.length < args.requestedCount
        ? [`严格匹配的本机题目只有 ${scored.length} 道，没有用相邻专题凑数。`]
        : [],
    searchedAt: new Date().toISOString(),
  };
}

function normalizedEvidenceSource(sourceType: LearnEvidenceLink['sourceType']) {
  if (sourceType === 'user_message') return 'user';
  return sourceType;
}

function collectEvidence(decision: LearnTurnDecision) {
  const byId = new Map<string, ReturnType<typeof mapEvidence>>();
  for (const step of decision.trace.steps) {
    for (const evidence of step.evidence ?? []) {
      byId.set(evidence.id, mapEvidence(evidence));
    }
  }
  for (const handoff of decision.trace.handoffs) {
    for (const evidence of handoff.evidence ?? []) {
      byId.set(evidence.id, mapEvidence(evidence));
    }
  }
  return [...byId.values()].slice(0, 24);
}

function mapEvidence(evidence: LearnEvidenceLink) {
  return {
    id: evidence.id,
    sourceType: normalizedEvidenceSource(evidence.sourceType),
    sourceId: evidence.sourceId,
    title: evidence.title,
    excerpt: evidence.quoteOrSummary,
    reason: evidence.supports,
    confidence: evidence.confidence,
    metadata: evidence.metadata,
  };
}

function mapActions(actions: LearnAction[], requestId: string, offset = 0) {
  return actions.map((action, index) => ({
    id: `${requestId}:action:${offset + index + 1}`,
    kind: action.kind,
    label: action.label,
    summary: action.summary,
    status: 'proposed',
    confirmation: action.confirmation === 'required' ? 'required' : 'none',
    payload: action.payload ?? {},
  }));
}

function normalizeReviewPlan(
  artifact: LearnArtifact,
  evidence: ReturnType<typeof collectEvidence>,
) {
  const value = recordValue(artifact);
  const tasks = Array.isArray(value.tasks) ? value.tasks.map(recordValue) : [];
  const calendarItems = Array.isArray(value.calendarDraftItems)
    ? value.calendarDraftItems.map(recordValue)
    : [];
  return {
    id: textValue(value, 'id') || `review-plan-${crypto.randomUUID()}`,
    title: textValue(value, 'title') || '复习计划',
    summary: textValue(value, 'summary', 'description'),
    learningGoal: textValue(value, 'learningGoal', 'goal'),
    estimatedMinutes: numberValue(value, 'estimatedMinutes', 'minutes'),
    tasks: tasks.map((task, index) => ({
      id: textValue(task, 'id') || `review-task-${index + 1}`,
      title: textValue(task, 'title', 'label') || `复习任务 ${index + 1}`,
      activity: textValue(task, 'activity', 'kind', 'type') || 'review',
      date: textValue(task, 'date', 'scheduledDate') || undefined,
      concepts: stringList(task.concepts ?? task.focusTopics),
      minutes: numberValue(task, 'minutes', 'durationMinutes'),
      reason: textValue(task, 'reason', 'description', 'summary'),
      evidenceIds: stringList(task.evidenceIds),
      problemIds: stringList(task.problemIds),
    })),
    calendarItems: calendarItems.map((item, index) => ({
      id: textValue(item, 'id') || `review-calendar-${index + 1}`,
      eventId: textValue(item, 'eventId') || undefined,
      title: textValue(item, 'title') || `复习任务 ${index + 1}`,
      date: textValue(item, 'date') || undefined,
      durationMinutes: numberValue(item, 'durationMinutes', 'minutes'),
      reason: textValue(item, 'reason', 'description'),
    })),
    evidence,
    rationale: stringList(value.rationale ?? value.reasons),
    gaps: stringList(value.gaps),
    nextSteps: stringList(value.nextSteps),
  };
}

function normalizeProblemSelection(search: LearnProblemBankSearchResult | null | undefined) {
  if (!search?.matches.length) return undefined;
  return {
    id: `problem-selection-${crypto.randomUUID()}`,
    title: '从本机题库选择的练习',
    query: search.query,
    requestedCount: search.requestedCount,
    problems: search.matches.map((match) => ({
      problemId: match.problemId,
      title: match.title,
      reason: match.reason,
      type: match.problemType,
      difficulty: match.difficulty,
      tags: match.tags,
      latestAttemptStatus: match.attemptStatus,
      metadata: match.metadata,
    })),
    rationale: search.rationale,
    gaps: search.gaps,
  };
}

export async function runNativeTeachingTurn(
  request: NextRequest,
  input: NativeTeachingTurnRequest,
) {
  const decision = await decideTeachingTurn(learnInput(input), {
    semanticRouter: createRequestSemanticRouter(request),
    searchProblemBank: ({ query, requestedCount }) =>
      Promise.resolve(localProblemSearch(input, { query, requestedCount })),
  });
  const evidence = collectEvidence(decision);
  let answer = decision.replyText.trim();
  let model: Record<string, unknown> | undefined;

  if (decision.answerMode === 'course_answer') {
    const resolved = await resolveModelFromHeaders(request, { allowOpenAIModelOverride: true });
    const sourceNotes = [
      ...input.localContext.notebookExcerpts.map((item, index) =>
        sourceNote(item, index, '课程笔记'),
      ),
      ...input.localContext.sourceExcerpts.map((item, index) =>
        sourceNote(item, index, '课程资料'),
      ),
      ...input.localContext.memories
        .slice(0, 8)
        .map((item, index) => sourceNote(item, index, '学习记忆')),
    ].flatMap((note) => (note ? [note] : []));
    const handoff = decision.trace.handoffs.at(-1);
    const topic = [
      selectedQuestion(input),
      handoff?.requiredBehavior.length
        ? `\n回答要求：\n${handoff.requiredBehavior.map((item) => `- ${item}`).join('\n')}`
        : '',
      input.course.description ? `\n课程说明：${input.course.description}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const explanation = await generatePublicExplanation({
      model: resolved.model,
      input: {
        kind: 'concept',
        topic,
        courseName: input.course.name,
        language: input.preferences.language,
        sourceNotes,
      },
    });
    answer = explanation.markdown;
    model = {
      provider: resolved.providerId,
      model: resolved.modelString,
      inputTokens: explanation.usage?.inputTokens ?? null,
      outputTokens: explanation.usage?.outputTokens ?? null,
    };
  }

  if (!answer) {
    answer =
      decision.answerMode === 'client_practice_plan'
        ? '我已经根据本机题库筛选了可直接打开的针对题，请确认后开始。'
        : decision.answerMode === 'client_activity_plan'
          ? '我已经按你的约束生成了可执行的学习计划。'
          : '我已经整理好下一步操作，执行前会先由你确认。';
  }

  const artifacts = decision.artifacts;
  const reviewArtifact = artifacts.find((artifact) => artifact.kind === 'review_plan');
  const metadata = {
    schemaVersion: 1,
    lectureEligible: decision.answerMode === 'course_answer',
    lectureEligibilityReason:
      decision.answerMode === 'course_answer' ? ('course_answer' as const) : undefined,
    learningActions: [
      ...mapActions(decision.directCalls, input.requestId),
      ...mapActions(decision.proposals, input.requestId, decision.directCalls.length),
    ],
    reviewPlan: reviewArtifact ? normalizeReviewPlan(reviewArtifact, evidence) : undefined,
    problemSelection: normalizeProblemSelection(decision.planningDecision?.problemBankSearch),
    evidence,
    teachingRunId: decision.trace.runId,
    model,
  };
  return {
    requestId: input.requestId,
    clientTurnId: input.clientTurnId ?? input.requestId,
    answerMode: decision.answerMode,
    assistantMessage: { text: answer, metadata },
    decision: learnTurnDecisionToResponse(decision),
  };
}
