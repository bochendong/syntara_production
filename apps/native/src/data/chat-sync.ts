import { syncedChatContent } from './synced-chat-content';
import { queueSync, syncPrefix } from './sync-outbox';
import { platformAvailable } from './browser-runtime';
import type { LocalConversation, LocalCourse, LocalMessage } from '../domain/models';
import { chatFileChips } from './chat-files';
import { chatImageThumbnails } from './chat-images';
import type {
  NativeSyncedChatMessage,
  NativeSyncedConversationList,
} from './platform-api-contracts';
import {
  deleteSyncedConversation,
  listNativePlatformCourses,
  listSyncedConversations,
  loadSyncedConversation,
  pushSyncedConversation,
} from './platform-api-client';
import type { LocalRepository } from './repository';
import { savePlatformCourseMeta } from '../lib/platform-course-meta';

/** How many recent messages each push re-sends; the server upserts them by id. */
const PUSH_MESSAGE_WINDOW = 20;
const MAX_SYNCED_TEXT_LENGTH = 40_000;

function timestampOf(value: number | string | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

/**
 * 把账号在网页上拥有、报名或购买的课程导入本机，课程 id 与网页一致，
 * 这样聊天可以直接按课程 id 同步。未登录或网络失败时保留上一次的结果。
 */
export async function syncPlatformCourses(repository: LocalRepository): Promise<string[] | null> {
  if (!platformAvailable()) return repository.getPlatformCourseIds();
  try {
    const courses = await listNativePlatformCourses();
    const now = Date.now();
    const localCourses: LocalCourse[] = courses.map((course) => ({
      id: course.id,
      name: course.name,
      description: course.description ?? '',
      language: course.language === 'en-US' ? 'en-US' : 'zh-CN',
      tags: [],
      purpose: 'university',
      university: null,
      courseCode: course.courseCode,
      createdAt: now,
      updatedAt: timestampOf(course.updatedAt, now),
    }));
    await repository.upsertPlatformCourses(localCourses);
    savePlatformCourseMeta(courses);
    const ids = localCourses.map((course) => course.id);
    await repository.setPlatformCourseIds(ids);
    return ids;
  } catch (cause) {
    console.warn('[chat-sync] platform course sync failed', cause);
    return repository.getPlatformCourseIds();
  }
}

export async function isPlatformCourse(
  repository: LocalRepository,
  courseId: string,
): Promise<boolean> {
  if (!platformAvailable()) return false;
  const ids = await repository.getPlatformCourseIds();
  return Boolean(ids?.includes(courseId));
}

function toSyncedMessage(message: LocalMessage): NativeSyncedChatMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  if (message.id.startsWith('stream-')) return null;
  const images = chatImageThumbnails(message.metadata);
  const files = chatFileChips(message.metadata);
  return {
    id: message.id,
    role: message.role,
    text: message.text.slice(0, MAX_SYNCED_TEXT_LENGTH),
    createdAt: message.createdAt,
    nativeContent: syncedChatContent(message.metadata),
    nativeContentAt:
      typeof message.metadata?.syncUpdatedAt === 'number'
        ? message.metadata.syncUpdatedAt
        : message.createdAt,
    ...(images.length || files.length
      ? {
          // 文件名和图片缩略图随聊天内容同步；原始上传文件不会重复保存。
          attachments: [
            ...images.map((image) => ({ name: image.name, mimeType: 'image/jpeg' })),
            ...files.map((file) => ({ name: file.name, size: file.size })),
          ],
        }
      : {}),
  };
}

function fromSyncedMessage(
  message: NativeSyncedChatMessage,
  conversationId: string,
  fallbackTime: number,
): LocalMessage {
  return {
    id: message.id,
    conversationId,
    role: message.role,
    text: message.text ?? '',
    metadata:
      (syncedChatContent(message.nativeContent)
        ? { ...syncedChatContent(message.nativeContent), syncUpdatedAt: message.nativeContentAt }
        : undefined) ??
      (message.attachments?.length
        ? {
            files: message.attachments.map((file) => ({
              name: file.name ?? '附件',
              size: file.size,
              kind: 'text',
            })),
          }
        : undefined),
    createdAt: timestampOf(message.createdAt, fallbackTime),
  };
}

/** 发送完一轮后把这段对话最近的消息推到网页，网页按消息 id 去重。 */
export async function pushConversation(
  repository: LocalRepository,
  conversation: LocalConversation,
): Promise<void> {
  if (!(await isPlatformCourse(repository, conversation.courseId))) return;
  if (
    (
      await repository.listSyncEntries(
        syncPrefix('chat-delete', conversation.courseId) + encodeURIComponent(conversation.id),
      )
    ).length
  )
    return;
  await queueSync(repository, 'chat', conversation.courseId, conversation.id, {
    conversation,
    generation: crypto.randomUUID(),
  });
  await flushConversationOutbox(repository, conversation.courseId);
}

const chatFlushes = new WeakMap<LocalRepository, Map<string, Promise<void>>>();
export async function flushConversationOutbox(
  repository: LocalRepository,
  courseId: string,
): Promise<void> {
  let running = chatFlushes.get(repository);
  if (!running) {
    running = new Map();
    chatFlushes.set(repository, running);
  }
  if (running.has(courseId)) return running.get(courseId);
  const operation = (async () => {
    for (const entry of await repository.listSyncEntries(syncPrefix('chat-delete', courseId))) {
      const conversation = JSON.parse(entry.value) as LocalConversation;
      const snapshot = await loadSyncedConversation(courseId, conversation.id);
      if (snapshot.session || snapshot.currentRevision === 0) {
        const result = await deleteSyncedConversation(
          courseId,
          conversation.id,
          snapshot.currentRevision,
        );
        if (!result.accepted) throw new Error('对话删除暂时未同步，将自动重试。');
      }
      for (const pending of await repository.listSyncEntries(
        syncPrefix('chat', courseId) + encodeURIComponent(conversation.id),
      )) {
        if (pending.key === syncPrefix('chat', courseId) + encodeURIComponent(conversation.id))
          await repository.removeSyncEntry(pending.key, pending.value);
      }
      await repository.removeSyncEntry(entry.key, entry.value);
    }
    for (const entry of await repository.listSyncEntries(syncPrefix('chat', courseId))) {
      const { conversation } = JSON.parse(entry.value) as { conversation: LocalConversation };
      const messages = (await repository.listMessages(conversation.id))
        .map(toSyncedMessage)
        .filter((message): message is NativeSyncedChatMessage => Boolean(message));
      let batch: NativeSyncedChatMessage[] = [];
      const send = async () => {
        if (!batch.length) return;
        const result = await pushSyncedConversation({
          courseId,
          sessionId: conversation.id,
          title: conversation.title,
          messages: batch,
        });
        if (result.deleted) {
          await repository.deleteConversation(conversation.id);
          return false;
        }
        if (!result.accepted) throw new Error('聊天同步冲突，将自动重试。');
        if (result.serverDeletedMessageIds?.length)
          await repository.mergeSyncedConversation(
            conversation,
            [],
            result.serverDeletedMessageIds,
          );
        batch = [];
        return true;
      };
      let deleted = false;
      for (const message of messages) {
        if (
          batch.length &&
          (batch.length >= PUSH_MESSAGE_WINDOW ||
            JSON.stringify([...batch, message]).length > 2_800_000)
        ) {
          if ((await send()) === false) {
            deleted = true;
            break;
          }
        }
        batch.push(message);
      }
      if (!deleted) await send();
      await repository.removeSyncEntry(entry.key, entry.value);
    }
  })().finally(() => running!.delete(courseId));
  running.set(courseId, operation);
  return operation;
}

/** 侧边栏每页的会话数，和网页「全部会话」的下一页一样按最近更新排序。 */
export const CONVERSATION_PAGE_SIZE = 30;
/** 打开课程时只预先下载最近几段有更新的对话，其余的点开时再下载。 */
const PREFETCH_CONVERSATION_COUNT = 5;
/** 本机已有旧消息、但网页上新增太多时，最多往前补几页把中间的空缺填上。 */
const MAX_GAP_FILL_PAGES = 4;

export interface ConversationPage {
  changed: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  /** 网页上这门课的会话总数。 */
  totalCount: number;
}

/** 把一页网页会话的标题和时间存到本机；返回有更新、需要下载消息的那些会话。 */
async function mergeConversationPage(
  repository: LocalRepository,
  courseId: string,
  sessions: NativeSyncedConversationList['sessions'],
  localConversations: LocalConversation[],
) {
  const localById = new Map(localConversations.map((item) => [item.id, item]));
  const stale: string[] = [];
  let changed = false;
  for (const session of sessions) {
    const updatedAt = timestampOf(session.updatedAt, Date.now());
    const local = localById.get(session.id);
    if (local && local.updatedAt >= updatedAt && local.title === session.title) continue;
    const createdAt = timestampOf(session.createdAt, updatedAt);
    await repository.mergeSyncedConversation(
      {
        id: session.id,
        courseId,
        notebookId: null,
        title: session.title || '新对话',
        createdAt: local?.createdAt ?? createdAt,
        updatedAt,
      },
      [],
    );
    if (!local || local.updatedAt < updatedAt) stale.push(session.id);
    changed = true;
  }
  return { changed, stale };
}

/**
 * 打开课程时拉第一页网页会话（30 个）。只预先下载最近 5 段有更新的对话的消息，
 * 其余点开时由 refreshConversationMessages 再下载，避免一次连发几十个请求。
 */
export async function pullCourseConversations(
  repository: LocalRepository,
  courseId: string,
  localConversations: LocalConversation[],
): Promise<ConversationPage> {
  if (!(await isPlatformCourse(repository, courseId))) {
    return { changed: false, hasMore: false, nextCursor: null, totalCount: 0 };
  }
  await flushConversationOutbox(repository, courseId);
  const remote = await listSyncedConversations(courseId, { limit: CONVERSATION_PAGE_SIZE });
  for (const id of remote.deletedSessionIds ?? []) {
    if (localConversations.some((item) => item.id === id)) await repository.deleteConversation(id);
  }
  const merged = await mergeConversationPage(
    repository,
    courseId,
    remote.sessions,
    localConversations,
  );
  for (const sessionId of merged.stale.slice(0, PREFETCH_CONVERSATION_COUNT)) {
    await refreshConversationMessages(repository, courseId, sessionId).catch((cause) =>
      console.warn('[chat-sync] prefetch failed', sessionId, cause),
    );
  }
  return {
    changed:
      merged.changed ||
      Boolean(
        remote.deletedSessionIds?.some((id) => localConversations.some((item) => item.id === id)),
      ),
    hasMore: remote.hasMore,
    nextCursor: remote.nextCursor,
    totalCount: remote.totalCount,
  };
}

/** 侧边栏滚到底：取下一页网页会话（只存标题和时间）。 */
export async function pullMoreCourseConversations(
  repository: LocalRepository,
  courseId: string,
  cursor: string,
  localConversations: LocalConversation[],
): Promise<ConversationPage> {
  const remote = await listSyncedConversations(courseId, {
    limit: CONVERSATION_PAGE_SIZE,
    cursor,
  });
  const merged = await mergeConversationPage(
    repository,
    courseId,
    remote.sessions,
    localConversations,
  );
  return {
    changed: merged.changed,
    hasMore: remote.hasMore,
    nextCursor: remote.nextCursor,
    totalCount: remote.totalCount,
  };
}

/** 本机没有全部会话，所以搜索也问一下网页；找到的会话存到本机。 */
export async function searchCourseConversations(
  repository: LocalRepository,
  courseId: string,
  query: string,
  localConversations: LocalConversation[],
): Promise<boolean> {
  if (!(await isPlatformCourse(repository, courseId))) return false;
  const remote = await listSyncedConversations(courseId, {
    limit: CONVERSATION_PAGE_SIZE,
    q: query,
  });
  const merged = await mergeConversationPage(
    repository,
    courseId,
    remote.sessions,
    localConversations,
  );
  return merged.changed;
}

export interface ConversationMessagePage {
  /** 新存到本机的消息数。 */
  inserted: number;
  /** 网页上还有更早的消息时，取上一页用的游标。 */
  olderCursor: string | null;
}

async function mergeMessagePage(
  repository: LocalRepository,
  courseId: string,
  sessionId: string,
  before: string | null,
) {
  const snapshot = await loadSyncedConversation(courseId, sessionId, { before });
  if (!snapshot.session) {
    // A positive revision with no session is an explicit server tombstone.
    // An unknown / never-uploaded local conversation must be preserved.
    if (snapshot.currentRevision > 0) await repository.deleteConversation(sessionId);
    return null;
  }
  const updatedAt = timestampOf(snapshot.session.updatedAt, Date.now());
  const createdAt = timestampOf(snapshot.session.createdAt, updatedAt);
  const messages = snapshot.messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => fromSyncedMessage(message, sessionId, createdAt));
  const inserted = await repository.mergeSyncedConversation(
    {
      id: sessionId,
      courseId,
      notebookId: null,
      title: snapshot.session.title || '新对话',
      createdAt,
      updatedAt,
    },
    messages,
    snapshot.deletedMessageIds,
  );
  const page = snapshot.messagePage;
  return {
    inserted,
    returned: messages.length,
    olderCursor: page?.hasMore ? page.nextCursor : null,
  };
}

/**
 * 点开一段网页对话时下载最近 30 条消息。如果本机原本就有旧消息、而这一页全是新的，
 * 说明中间还有空缺，再往前补几页，直到接上本机已有的消息。
 */
export async function refreshConversationMessages(
  repository: LocalRepository,
  courseId: string,
  sessionId: string,
): Promise<ConversationMessagePage | null> {
  if (!(await isPlatformCourse(repository, courseId))) return null;
  const hadLocalMessages = (await repository.listMessages(sessionId)).length > 0;
  let page = await mergeMessagePage(repository, courseId, sessionId, null);
  if (!page) return null;
  let inserted = page.inserted;
  for (
    let filled = 0;
    hadLocalMessages &&
    page.olderCursor &&
    page.returned > 0 &&
    page.inserted === page.returned &&
    filled < MAX_GAP_FILL_PAGES;
    filled += 1
  ) {
    const older = await mergeMessagePage(repository, courseId, sessionId, page.olderCursor);
    if (!older) break;
    page = older;
    inserted += older.inserted;
  }
  return { inserted, olderCursor: page.olderCursor };
}

/** 聊天往上翻到本机最早的一条时，再从网页取更早的 30 条。 */
export async function loadOlderConversationMessages(
  repository: LocalRepository,
  courseId: string,
  sessionId: string,
  before: string,
): Promise<ConversationMessagePage | null> {
  const page = await mergeMessagePage(repository, courseId, sessionId, before);
  return page ? { inserted: page.inserted, olderCursor: page.olderCursor } : null;
}

/** 在手机上删除对话时，同时删除网页上的同一段对话。 */
export async function deleteRemoteConversation(
  repository: LocalRepository,
  conversation: LocalConversation,
): Promise<void> {
  if (!(await isPlatformCourse(repository, conversation.courseId))) return;
  await queueSync(repository, 'chat-delete', conversation.courseId, conversation.id, conversation);
  // The durable deletion survives app restarts. Keep local deletion usable offline.
  void flushConversationOutbox(repository, conversation.courseId).catch((cause) =>
    console.warn('[chat-sync] deletion queued', cause),
  );
}
