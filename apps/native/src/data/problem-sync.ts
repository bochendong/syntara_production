import type { LocalProblem, LocalProblemAttempt, LocalProblemProgress } from '../domain/models';
import { SYNTARA_ARCHIVE_FORMAT, SYNTARA_ARCHIVE_VERSION, type SyntaraArchiveV1 } from './archive';
import { isPlatformCourse } from './chat-sync';
import type { NativeProblemAttemptUpload } from './platform-api-contracts';
import { getNativeProblems, uploadNativeProblemAttempts } from './platform-api-client';
import type { LocalRepository } from './repository';

/**
 * 网页课程的题库：题目跟网页走（按 updatedAt 增量拉），
 * 手机上的作答先进本机，再传到网页题库，网页和别的设备都能看到做过哪些题。
 */

const SYNC_STATE_PREFIX = 'syntara.problem-sync.v1:';
const OUTBOX_KEY = 'syntara.problem-attempt-outbox.v1';
/** 和服务器 NATIVE_ATTEMPT_UPLOAD_LIMIT 一致。 */
const UPLOAD_BATCH = 100;
/** 一直传不上去的作答最多留这么多条，免得无限增长。 */
const OUTBOX_LIMIT = 2000;

type ProblemSyncState = {
  /** 上次拉取时服务器的时间，下次只要这之后改过的题。 */
  since: number | null;
  /** 从网页同步下来的题目 id；网页上删掉时只收回这些，手机自己导入的题不动。 */
  problemIds: string[];
};

type Outbox = Record<string, NativeProblemAttemptUpload[]>;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 存不下时下次同步会整门课重新比对，不影响使用。
  }
}

function readState(courseId: string): ProblemSyncState {
  const state = readJson<Partial<ProblemSyncState>>(`${SYNC_STATE_PREFIX}${courseId}`, {});
  return {
    since: typeof state.since === 'number' ? state.since : null,
    problemIds: Array.isArray(state.problemIds) ? state.problemIds : [],
  };
}

function archiveOf(parts: Partial<SyntaraArchiveV1>): SyntaraArchiveV1 {
  return {
    format: SYNTARA_ARCHIVE_FORMAT,
    version: SYNTARA_ARCHIVE_VERSION,
    exportedAt: Date.now(),
    source: { kind: 'postgresql' },
    courses: [],
    notebooks: [],
    notebookPages: [],
    markdownSections: [],
    problems: [],
    problemAttempts: [],
    problemProgress: [],
    conversations: [],
    messages: [],
    studyMemories: [],
    assets: [],
    pageAssets: [],
    notebookAssets: [],
    missingAssetPaths: [],
    ...parts,
  };
}

function uploadOf(attempt: LocalProblemAttempt): NativeProblemAttemptUpload | null {
  if (!['pending', 'passed', 'failed', 'partial'].includes(attempt.status)) return null;
  const answer = attempt.answer;
  const result = attempt.result ?? {};
  const selected = answer.selectedOptionIds;
  return {
    // 服务器只收字母、数字、- 和 _。
    id: attempt.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80),
    problemId: attempt.problemId,
    status: attempt.status as NativeProblemAttemptUpload['status'],
    score: typeof attempt.score === 'number' ? Math.max(0, Math.min(1, attempt.score)) : null,
    answer: {
      ...(Array.isArray(selected)
        ? { selectedOptionIds: selected.filter((id): id is string => typeof id === 'string') }
        : {}),
      ...(typeof answer.text === 'string' ? { text: answer.text.slice(0, 40_000) } : {}),
      ...(typeof answer.code === 'string' ? { code: answer.code.slice(0, 120_000) } : {}),
    },
    feedback: typeof result.feedback === 'string' ? result.feedback.slice(0, 8000) : null,
    autoGraded: result.autoGraded === true,
    createdAt: attempt.createdAt,
  };
}

/**
 * 做完一道题后调用：网页课程的作答排进待上传队列并立刻试着传一次。
 * 没网时留在队列里，下次打开课程同步时再传。
 */
export async function queueProblemAttempt(
  repository: LocalRepository,
  courseId: string,
  attempt: LocalProblemAttempt,
): Promise<void> {
  if (!(await isPlatformCourse(repository, courseId))) return;
  const upload = uploadOf(attempt);
  if (!upload || upload.id.length < 8) return;
  const outbox = readJson<Outbox>(OUTBOX_KEY, {});
  outbox[courseId] = [...(outbox[courseId] ?? []), upload].slice(-OUTBOX_LIMIT);
  writeJson(OUTBOX_KEY, outbox);
  await flushProblemAttempts(courseId).catch((cause) =>
    console.warn('[problem-sync] attempt upload failed', cause),
  );
}

async function flushProblemAttempts(courseId: string): Promise<void> {
  for (;;) {
    const pending = readJson<Outbox>(OUTBOX_KEY, {})[courseId] ?? [];
    if (!pending.length) return;
    const batch = pending.slice(0, UPLOAD_BATCH);
    const result = await uploadNativeProblemAttempts({ courseId, attempts: batch });
    const done = new Set([...result.saved, ...result.skipped]);
    // 重新读一次：上传期间可能又做了新的题。
    const outbox = readJson<Outbox>(OUTBOX_KEY, {});
    const remaining = (outbox[courseId] ?? []).filter((item) => !done.has(item.id));
    if (remaining.length) outbox[courseId] = remaining;
    else delete outbox[courseId];
    writeJson(OUTBOX_KEY, outbox);
    // 服务器一条都没收：别在这里死循环，下次同步再试。
    if (!batch.some((item) => done.has(item.id))) return;
  }
}

/**
 * 打开网页课程时调用：先传上还没传的作答，再拉网页题库里改过的题和做题进度。
 * 返回本机题库或进度有没有变。
 */
export async function syncCourseProblems(
  repository: LocalRepository,
  courseId: string,
): Promise<boolean> {
  if (!(await isPlatformCourse(repository, courseId))) return false;
  try {
    await flushProblemAttempts(courseId);
  } catch (cause) {
    console.warn('[problem-sync] attempt upload failed', cause);
  }

  const local = await repository.loadCourseWorkspace(courseId);
  if (!local) return false;
  const state = readState(courseId);
  const localById = new Map(local.problems.map((problem) => [problem.id, problem]));
  // 本机题库被清掉过（重装、换设备）时整门课重新拉。
  const missingLocal = state.problemIds.some((id) => !localById.has(id));
  let remote = await getNativeProblems(courseId, missingLocal ? null : state.since);
  // 网页上没改题、但这道题对你新可见了（比如解锁了新笔记）：增量拉不到，整门课补一次。
  const fetchedIds = new Set(remote.problems.map((problem) => problem.id));
  const newlyVisible = remote.problemIds.some((id) => {
    const existing = localById.get(id);
    return !fetchedIds.has(id) && (!existing || existing.status === 'archived');
  });
  if (newlyVisible && (missingLocal ? null : state.since) !== null) {
    remote = await getNativeProblems(courseId, null);
  }
  const notebookIds = new Set(local.notebooks.map((notebook) => notebook.id));
  let changed = false;

  const upserts: LocalProblem[] = remote.problems
    .filter((problem) => {
      const existing = localById.get(problem.id);
      return (
        !existing || existing.updatedAt !== problem.updatedAt || existing.status !== problem.status
      );
    })
    .map((problem) => ({
      ...problem,
      courseId,
      // 笔记还没同步到本机时先不挂，免得外键找不到。
      notebookId:
        problem.notebookId && notebookIds.has(problem.notebookId) ? problem.notebookId : null,
    }));

  // 网页上删掉、收回或改回草稿的题：本机归档，不再出现在题库里。
  const remoteIds = new Set(remote.problemIds);
  const removed = remote.complete
    ? state.problemIds
        .filter((id) => !remoteIds.has(id))
        .map((id) => localById.get(id))
        .filter((problem): problem is LocalProblem =>
          Boolean(problem && problem.status !== 'archived'),
        )
        .map((problem) => ({ ...problem, status: 'archived' as const, updatedAt: Date.now() }))
    : [];

  if (upserts.length || removed.length) {
    await repository.importArchive(archiveOf({ problems: [...upserts, ...removed] }));
    changed = true;
  }

  // 做题进度：网页上最后一次作答更晚（比如在网页上做过）就用网页的。
  const localProgress = new Map(
    (await repository.listProblemProgress(courseId)).map((progress) => [
      progress.problemId,
      progress,
    ]),
  );
  const knownProblemIds = new Set([...localById.keys(), ...upserts.map((problem) => problem.id)]);
  const progressUpdates: LocalProblemProgress[] = [];
  for (const progress of remote.progress) {
    if (!knownProblemIds.has(progress.problemId)) continue;
    const existing = localProgress.get(progress.problemId);
    if (
      existing &&
      ((existing.lastAttemptAt ?? 0) > (progress.lastAttemptAt ?? 0) ||
        (existing.attemptedCount === progress.attemptedCount &&
          existing.passedCount === progress.passedCount &&
          existing.status === progress.status))
    ) {
      continue;
    }
    progressUpdates.push({
      id: existing?.id ?? `progress:${progress.problemId}`,
      problemId: progress.problemId,
      // 网页上的作答不下载到手机，只保留本机最后一次作答的链接。
      latestAttemptId: existing?.latestAttemptId ?? null,
      status: progress.status,
      score: progress.score,
      attemptedCount: Math.max(progress.attemptedCount, existing?.attemptedCount ?? 0),
      passedCount: Math.max(progress.passedCount, existing?.passedCount ?? 0),
      lastAttemptAt: progress.lastAttemptAt,
      createdAt: existing?.createdAt ?? progress.createdAt,
      updatedAt: progress.updatedAt,
    });
  }
  if (progressUpdates.length) {
    await repository.importArchive(archiveOf({ problemProgress: progressUpdates }));
    changed = true;
  }

  writeJson(`${SYNC_STATE_PREFIX}${courseId}`, {
    since: remote.serverTime,
    problemIds: remote.complete
      ? remote.problemIds
      : [...new Set([...state.problemIds, ...remote.problemIds])],
  } satisfies ProblemSyncState);
  return changed;
}
