import type { LocalConversation, LocalCourse, LocalMessage } from '../domain/models';
import { chatImageThumbnails } from './chat-images';
import type { NativeSyncedChatMessage } from './platform-api-contracts';
import {
  deleteSyncedConversation,
  listNativePlatformCourses,
  listSyncedConversations,
  loadSyncedConversation,
  pushSyncedConversation,
} from './platform-api-client';
import type { LocalRepository } from './repository';

/** How many recent messages each push re-sends; the server upserts them by id. */
const PUSH_MESSAGE_WINDOW = 40;
const MAX_SYNCED_TEXT_LENGTH = 40_000;

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

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
  if (!isTauriRuntime()) return repository.getPlatformCourseIds();
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
  if (!isTauriRuntime()) return false;
  const ids = await repository.getPlatformCourseIds();
  return Boolean(ids?.includes(courseId));
}

function toSyncedMessage(message: LocalMessage): NativeSyncedChatMessage | null {
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  if (message.id.startsWith('stream-')) return null;
  const images = chatImageThumbnails(message.metadata);
  return {
    id: message.id,
    role: message.role,
    text: message.text.slice(0, MAX_SYNCED_TEXT_LENGTH),
    createdAt: message.createdAt,
    ...(images.length
      ? {
          // 只同步图片的名字，原图和缩略图留在手机上。
          attachments: images.map((image) => ({ name: image.name, mimeType: 'image/jpeg' })),
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
    createdAt: timestampOf(message.createdAt, fallbackTime),
  };
}

/** 发送完一轮后把这段对话最近的消息推到网页，网页按消息 id 去重。 */
export async function pushConversation(
  repository: LocalRepository,
  conversation: LocalConversation,
): Promise<void> {
  if (!(await isPlatformCourse(repository, conversation.courseId))) return;
  const messages = (await repository.listMessages(conversation.id))
    .slice(-PUSH_MESSAGE_WINDOW)
    .map(toSyncedMessage)
    .filter((message): message is NativeSyncedChatMessage => Boolean(message));
  if (!messages.length) return;
  await pushSyncedConversation({
    courseId: conversation.courseId,
    sessionId: conversation.id,
    title: conversation.title,
    messages,
  });
}

/** 打开课程时把网页上的对话拉到本机；返回是否有新内容。 */
export async function pullCourseConversations(
  repository: LocalRepository,
  courseId: string,
  localConversations: LocalConversation[],
): Promise<boolean> {
  if (!(await isPlatformCourse(repository, courseId))) return false;
  const remote = await listSyncedConversations(courseId);
  const localById = new Map(localConversations.map((item) => [item.id, item]));
  let changed = false;
  for (const session of remote.sessions) {
    const updatedAt = timestampOf(session.updatedAt, Date.now());
    const local = localById.get(session.id);
    if (local && local.updatedAt >= updatedAt && local.title === session.title) continue;
    const snapshot = await loadSyncedConversation(courseId, session.id);
    const createdAt = timestampOf(session.createdAt, updatedAt);
    const inserted = await repository.mergeSyncedConversation(
      {
        id: session.id,
        courseId,
        notebookId: null,
        title: session.title || '新对话',
        createdAt: local?.createdAt ?? createdAt,
        updatedAt,
      },
      snapshot.messages
        .filter((message) => message.role === 'user' || message.role === 'assistant')
        .map((message) => fromSyncedMessage(message, session.id, createdAt)),
    );
    changed = changed || inserted > 0 || !local || local.title !== session.title;
  }
  return changed;
}

/** 在手机上删除对话时，同时删除网页上的同一段对话。 */
export async function deleteRemoteConversation(
  repository: LocalRepository,
  conversation: LocalConversation,
): Promise<void> {
  if (!(await isPlatformCourse(repository, conversation.courseId))) return;
  const snapshot = await loadSyncedConversation(conversation.courseId, conversation.id).catch(
    () => null,
  );
  if (!snapshot?.session) return;
  await deleteSyncedConversation(conversation.courseId, conversation.id, snapshot.currentRevision);
}
