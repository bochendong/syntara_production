import { isValidPhotoAnswerUpload } from '../../../../lib/problem-bank/photo-answer';
import type { PhotoAnswerImage } from './local-problem-grading';
import { accountStorageKey } from './browser-runtime';
import type { LocalProblem, LocalProblemAttempt, LocalProblemProgress } from '../domain/models';
import { SYNTARA_ARCHIVE_FORMAT, SYNTARA_ARCHIVE_VERSION, type SyntaraArchiveV1 } from './archive';
import { isPlatformCourse } from './chat-sync';
import type { NativeProblemAttemptUpload } from './platform-api-contracts';
import { getNativeProblems, uploadNativeProblemAttempts } from './platform-api-client';
import { saveProblemLayers } from '../lib/course-layers';
import type { LocalRepository } from './repository';

/**
 * 网页课程的题库：题目跟网页走（按 updatedAt 增量拉），
 * 手机上的作答先进本机，再传到网页题库，网页和别的设备都能看到做过哪些题。
 */

// v2 fetches chapter metadata once for clients with an existing v1 checkpoint.
const SYNC_STATE_PREFIX = 'syntara.problem-sync.v2:';
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

type QueuedAttempt = NativeProblemAttemptUpload & { photoAttemptId?: string };
type Outbox = Record<string, QueuedAttempt[]>;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(accountStorageKey(key));
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(accountStorageKey(key), JSON.stringify(value));
  } catch {
    // 存不下时下次同步会整门课重新比对，不影响使用。
  }
}

function readState(courseId: string): ProblemSyncState {
  const state = readJson<Partial<ProblemSyncState> | null>(`${SYNC_STATE_PREFIX}${courseId}`, null);
  // Preserve the v1 server-owned IDs so withdrawn questions are still archived after upgrading.
  const previous =
    state ?? readJson<Partial<ProblemSyncState>>(`syntara.problem-sync.v1:${courseId}`, {});
  return {
    since: typeof state?.since === 'number' ? state.since : null,
    problemIds: Array.isArray(previous.problemIds) ? previous.problemIds : [],
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
  const event =
    result.event === 'solution_viewed' || result.event === 'answer_reset'
      ? result.event
      : undefined;
  const rawSnapshot = result.progressSnapshot;
  const snapshot =
    rawSnapshot && typeof rawSnapshot === 'object'
      ? (rawSnapshot as Record<string, unknown>)
      : null;
  const progressSnapshot =
    snapshot &&
    typeof snapshot.status === 'string' &&
    (snapshot.score === null ||
      (typeof snapshot.score === 'number' && snapshot.score >= 0 && snapshot.score <= 1)) &&
    typeof snapshot.attemptedCount === 'number' &&
    Number.isInteger(snapshot.attemptedCount) &&
    snapshot.attemptedCount >= 0
      ? { status: snapshot.status, score: snapshot.score, attemptedCount: snapshot.attemptedCount }
      : null;
  return {
    // 服务器只收字母、数字、- 和 _。
    id: attempt.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80),
    problemId: attempt.problemId,
    ...(event ? { event, progressSnapshot } : {}),
    status: attempt.status as NativeProblemAttemptUpload['status'],
    score: typeof attempt.score === 'number' ? Math.max(0, Math.min(1, attempt.score)) : null,
    answer: {
      ...(Array.isArray(selected)
        ? { selectedOptionIds: selected.filter((id): id is string => typeof id === 'string') }
        : {}),
      ...(typeof answer.text === 'string' ? { text: answer.text.slice(0, 40_000) } : {}),
      ...(Array.isArray(answer.images)
        ? {
            images: answer.images
              .filter((image): image is PhotoAnswerImage =>
                Boolean(
                  image &&
                  typeof image === 'object' &&
                  isValidPhotoAnswerUpload(image as PhotoAnswerImage),
                ),
              )
              .slice(0, 4),
          }
        : {}),
      ...(answer.kind === 'parts' && answer.parts && typeof answer.parts === 'object'
        ? { parts: answer.parts as NonNullable<NativeProblemAttemptUpload['answer']['parts']> }
        : {}),
      ...(typeof answer.code === 'string' ? { code: answer.code.slice(0, 120_000) } : {}),
      ...(answer.blanks && typeof answer.blanks === 'object'
        ? { blanks: answer.blanks as Record<string, string> }
        : {}),
      ...(answer.cells && typeof answer.cells === 'object'
        ? { cells: answer.cells as Record<string, string> }
        : {}),
    },
    ...(Array.isArray(result.parts)
      ? { parts: result.parts as NonNullable<NativeProblemAttemptUpload['parts']> }
      : {}),
    ...(Array.isArray(result.cells)
      ? { cells: result.cells as NonNullable<NativeProblemAttemptUpload['cells']> }
      : {}),
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
  // Images already live in the attempt repository; queue only their reference.
  const queued: QueuedAttempt = upload.answer.images?.length
    ? { ...upload, answer: { ...upload.answer, images: undefined }, photoAttemptId: attempt.id }
    : upload;
  outbox[courseId] = [...(outbox[courseId] ?? []), queued].slice(-OUTBOX_LIMIT);
  writeJson(OUTBOX_KEY, outbox);
  await flushProblemAttempts(repository, courseId).catch((cause) =>
    console.warn('[problem-sync] attempt upload failed', cause),
  );
}

async function flushProblemAttempts(repository: LocalRepository, courseId: string): Promise<void> {
  for (;;) {
    const pending = readJson<Outbox>(OUTBOX_KEY, {})[courseId] ?? [];
    if (!pending.length) return;
    const batch: NativeProblemAttemptUpload[] = [];
    let bytes = 0;
    for (const queued of pending.slice(0, UPLOAD_BATCH)) {
      let upload: NativeProblemAttemptUpload = queued;
      if (queued.photoAttemptId) {
        const document = await repository.loadProblemDocument(queued.problemId);
        const attempt = document?.attempts.find((item) => item.id === queued.photoAttemptId);
        const hydrated = attempt && uploadOf(attempt);
        if (!hydrated?.answer.images?.length)
          throw new Error('本机图片作答尚未读取成功，将稍后重试同步。');
        upload = hydrated;
      }
      const size = new TextEncoder().encode(JSON.stringify(upload)).length;
      if (batch.length && bytes + size > 3_500_000) break;
      batch.push(upload);
      bytes += size;
    }
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
    await flushProblemAttempts(repository, courseId);
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
  saveProblemLayers(courseId, remote);

  const upserts: LocalProblem[] = remote.problems
    .filter((problem) => {
      const existing = localById.get(problem.id);
      return (
        !existing ||
        existing.updatedAt !== problem.updatedAt ||
        existing.status !== problem.status ||
        existing.chapterId !== problem.chapterId ||
        existing.chapterName !== problem.chapterName
      );
    })
    // 层信息只存在 course-layers 里，不进本机题库表。
    .map(({ layer: _layer, releaseAddedIn: _added, contentUpdatedAt: _updated, ...problem }) => ({
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
