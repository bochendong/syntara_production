import type { GeneralConversation } from './general-chat';
import type { LocalConversation } from '../domain/models';
import type { LocalRepository } from './repository';
import { platformAvailable } from './browser-runtime';
import { listSyncedConversations } from './platform-api-client';

export interface RecentChat extends GeneralConversation {
  courseId: string | null;
  notebookId?: string | null;
}

/** Scope the course list to the signed-in account before merging ordinary chats. */
export function mergeRecentChats(
  courseIds: string[],
  courseChats: RecentChat[],
  generalChats: GeneralConversation[],
): RecentChat[] {
  const allowed = new Set(courseIds);
  const rows = new Map<string, RecentChat>();
  for (const chat of courseChats) {
    if (!chat.courseId || !allowed.has(chat.courseId)) continue;
    const existing = rows.get(chat.id);
    if (!existing || existing.updatedAt <= chat.updatedAt) rows.set(chat.id, chat);
  }
  for (const chat of generalChats) rows.set(chat.id, { ...chat, courseId: null });
  return [...rows.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt || a.id.localeCompare(b.id),
  );
}

/** Sync titles only; opening a chat loads its messages through the existing course flow. */
export async function syncRecentChatPage(
  repository: LocalRepository,
  courseIds: string[],
  options: { cursors?: Record<string, string | null>; query?: string } = {},
): Promise<{ cursors: Record<string, string | null>; failed: boolean }> {
  if (!platformAvailable()) return { cursors: {}, failed: false };
  const platformIds = new Set((await repository.getPlatformCourseIds()) ?? []);
  const ids = courseIds.filter(
    (id) => platformIds.has(id) && (!options.cursors || options.cursors[id] !== null),
  );
  const local = await repository.listConversations(ids);
  const byId = new Map(local.map((chat) => [chat.id, chat]));
  const cursors: Record<string, string | null> = { ...options.cursors };
  const results = await Promise.allSettled(
    ids.map(async (courseId) => {
      const page = await listSyncedConversations(courseId, {
        limit: 30,
        cursor: options.cursors?.[courseId],
        q: options.query,
      });
      for (const session of page.sessions) {
        const previous = byId.get(session.id);
        const updatedAt = new Date(session.updatedAt).getTime();
        if (previous && previous.updatedAt >= updatedAt) continue;
        const chat: LocalConversation = {
          id: session.id,
          courseId,
          notebookId: previous?.notebookId ?? null,
          title: session.title || '新对话',
          createdAt:
            previous?.createdAt ?? new Date(session.createdAt ?? session.updatedAt).getTime(),
          updatedAt,
        };
        await repository.mergeSyncedConversation(chat, []);
      }
      cursors[courseId] = page.nextCursor;
    }),
  );
  return { cursors, failed: results.some((result) => result.status === 'rejected') };
}
