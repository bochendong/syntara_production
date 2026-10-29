import type { LocalRepository } from './repository';
import { flushConversationOutbox } from './chat-sync';
import { syncCourseCalendar } from './calendar-sync';
import { flushLearningProgress } from './progress-sync';
import { flushGeneralOutbox } from './general-chat';
import { syncPrefix } from './sync-outbox';

/** Flush abandoned-course queues too: reconnecting on course B must not leave
 * course A's offline deletions or edits waiting until A is opened again. */
export async function flushPendingAccountChanges(repository: LocalRepository, courseIds: string[]) {
  for (const courseId of courseIds) {
    const pending = async (kind: string) =>
      (await repository.listSyncEntries(syncPrefix(kind, courseId))).length > 0;
    if ((await pending('chat')) || (await pending('chat-delete')))
      await flushConversationOutbox(repository, courseId).catch((cause) =>
        console.warn('[chat-sync] deferred', cause),
      );
    if (await pending('progress'))
      await flushLearningProgress(repository, courseId).catch((cause) =>
        console.warn('[progress-sync] deferred', cause),
      );
    if (await pending('calendar'))
      await syncCourseCalendar(repository, courseId).catch((cause) =>
        console.warn('[calendar-sync] deferred', cause),
      );
  }
  if (
    (await repository.listSyncEntries(syncPrefix('general-message', 'account'))).length ||
    (await repository.listSyncEntries(syncPrefix('general-delete', 'account'))).length
  )
    await flushGeneralOutbox().catch((cause) => console.warn('[general-chat] deferred', cause));
}
