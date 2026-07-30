import type { LocalCourseLearningState } from '../domain/models';
import type { SaveCourseLearningStateInput } from './repository';

const METADATA_PREFIX = 'course-learning-state:';

type StoredCourseLearningState = {
  courseId?: unknown;
  completedNotebookCount?: unknown;
  currentNotebookId?: unknown;
  updatedAt?: unknown;
};

export function courseLearningStateMetadataKey(courseId: string): string {
  return `${METADATA_PREFIX}${courseId}`;
}

export function parseCourseLearningState(
  value: string,
  courseId: string,
  notebookIds: ReadonlySet<string>,
  fallbackUpdatedAt: number,
): LocalCourseLearningState | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const stored = parsed as StoredCourseLearningState;

  const completedNotebookCount = stored.completedNotebookCount;
  if (
    stored.courseId !== courseId ||
    !Number.isInteger(completedNotebookCount) ||
    (completedNotebookCount as number) < 0 ||
    (completedNotebookCount as number) > notebookIds.size
  ) {
    return null;
  }

  const storedNotebookId =
    typeof stored.currentNotebookId === 'string' && stored.currentNotebookId.length > 0
      ? stored.currentNotebookId
      : null;
  const currentNotebookId =
    storedNotebookId && notebookIds.has(storedNotebookId) ? storedNotebookId : null;
  const updatedAt =
    typeof stored.updatedAt === 'number' &&
    Number.isFinite(stored.updatedAt) &&
    stored.updatedAt >= 0
      ? stored.updatedAt
      : fallbackUpdatedAt;

  return {
    courseId,
    completedNotebookCount: completedNotebookCount as number,
    currentNotebookId,
    updatedAt,
  };
}

export function normalizeCourseLearningState(
  input: SaveCourseLearningStateInput,
  notebookIds: ReadonlySet<string>,
  existing: LocalCourseLearningState | null,
): LocalCourseLearningState {
  if (
    !Number.isInteger(input.completedNotebookCount) ||
    input.completedNotebookCount < 0 ||
    input.completedNotebookCount > notebookIds.size
  ) {
    throw new Error(`课程学习进度必须是 0 到 ${notebookIds.size} 之间的整数。`);
  }

  const currentNotebookId =
    input.currentNotebookId === undefined
      ? (existing?.currentNotebookId ?? null)
      : input.currentNotebookId;
  if (currentNotebookId !== null && !notebookIds.has(currentNotebookId)) {
    throw new Error('当前笔记本不属于这门课程。');
  }

  const updatedAt = input.updatedAt ?? Date.now();
  if (!Number.isFinite(updatedAt) || updatedAt < 0) {
    throw new Error('课程学习进度的更新时间无效。');
  }

  return {
    courseId: input.courseId,
    completedNotebookCount: input.completedNotebookCount,
    currentNotebookId,
    updatedAt,
  };
}
