import { queueSync, syncPrefix } from './sync-outbox';
import { groupNotebookTranslations } from '../lib/notebook-translations';
import { isPlatformCourse } from './chat-sync';
import { saveNativeLearningProgress } from './platform-api-client';
import type { LocalRepository } from './repository';

/** 手机上改了学习进度后写回账号；不是网页课程时什么都不做。 */
export async function pushLearningProgress(
  repository: LocalRepository,
  courseId: string,
  completedNotebookCount: number,
  currentNotebookId: string | null,
  updatedAt = Date.now(),
): Promise<void> {
  if (!(await isPlatformCourse(repository, courseId))) return;
  const workspace = await repository.loadCourseWorkspace(courseId);
  const ordered = groupNotebookTranslations(workspace?.notebooks ?? []);
  const kind =
    completedNotebookCount <= 0
      ? 'not_started'
      : completedNotebookCount >= ordered.length
        ? 'completed_all'
        : 'notebook';
  await queueSync(
    repository,
    'progress',
    courseId,
    'latest',
    {
      courseId,
      kind,
      notebookId:
        kind === 'notebook'
          ? (currentNotebookId ?? ordered[completedNotebookCount - 1]?.id ?? null)
          : null,
      updatedAt,
    },
    updatedAt,
  );
  await flushLearningProgress(repository, courseId);
}

const progressFlushes = new WeakMap<LocalRepository, Map<string, Promise<void>>>();
export function flushLearningProgress(
  repository: LocalRepository,
  courseId: string,
): Promise<void> {
  let running = progressFlushes.get(repository);
  if (!running) {
    running = new Map();
    progressFlushes.set(repository, running);
  }
  if (running.has(courseId)) return running.get(courseId)!;
  const operation = (async () => {
    for (const entry of await repository.listSyncEntries(syncPrefix('progress', courseId))) {
      await saveNativeLearningProgress(JSON.parse(entry.value));
      await repository.removeSyncEntry(entry.key, entry.value);
    }
  })().finally(() => running!.delete(courseId));
  running.set(courseId, operation);
  return operation;
}
