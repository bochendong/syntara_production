import type {
  RemoteLearnChatSession,
  RemoteLearnConversationBaseSnapshot,
  RemoteLearnMessagePayload,
} from '@/features/learn-conversations/client/remote-conversation-api';

const LEARN_SESSION_INDEX_PREFIX = 'syntara-learn-session-index:v1';
const LEARN_SESSION_MESSAGES_PREFIX = 'syntara-learn-session-messages:v1';
const LEARN_SESSION_TAB_MESSAGES_PREFIX = 'syntara-learn-session-tab-messages:v1';
const LEARN_SESSION_COMPOSER_DRAFT_PREFIX = 'syntara-learn-session-composer-draft:v1';
const LEARN_SESSION_REMOTE_BASE_PREFIX = 'syntara-learn-session-remote-base:v1';
const LEARN_SESSION_DIRTY_MESSAGES_PREFIX = 'syntara-learn-session-dirty-messages:v1';
const LEARN_DELETED_SESSION_IDS_PREFIX = 'syntara-learn-deleted-session-ids:v1';
const LEARN_DELETED_MESSAGE_IDS_PREFIX = 'syntara-learn-deleted-message-ids:v1';
const MAX_LOCAL_MESSAGES = 120;
const MAX_DELETED_SESSION_IDS = 80;

export type LearnChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount?: number;
  currentRevision?: number;
  remoteState?: 'local-only' | 'remote';
};

type SessionMessageStorage = 'local' | 'tab';

function scopedKey(prefix: string, ...parts: string[]): string {
  return [prefix, ...parts.map(encodeURIComponent)].join(':');
}

export function learnSessionIndexKey(userId: string, courseId: string): string {
  return scopedKey(LEARN_SESSION_INDEX_PREFIX, userId, courseId);
}

function learnSessionMessagesKey(userId: string, courseId: string, sessionId: string): string {
  return scopedKey(LEARN_SESSION_MESSAGES_PREFIX, userId, courseId, sessionId);
}

function learnSessionTabMessagesKey(userId: string, courseId: string, sessionId: string): string {
  return scopedKey(LEARN_SESSION_TAB_MESSAGES_PREFIX, userId, courseId, sessionId);
}

function learnSessionComposerDraftKey(userId: string, courseId: string, sessionId: string): string {
  return scopedKey(LEARN_SESSION_COMPOSER_DRAFT_PREFIX, userId, courseId, sessionId);
}

function learnSessionRemoteBaseKey(userId: string, courseId: string, sessionId: string): string {
  return scopedKey(LEARN_SESSION_REMOTE_BASE_PREFIX, userId, courseId, sessionId);
}

function learnSessionDirtyMessagesKey(userId: string, courseId: string, sessionId: string): string {
  return scopedKey(LEARN_SESSION_DIRTY_MESSAGES_PREFIX, userId, courseId, sessionId);
}

function deletedLearnSessionIdsKey(userId: string, courseId: string): string {
  return scopedKey(LEARN_DELETED_SESSION_IDS_PREFIX, userId, courseId);
}

export function deletedLearnMessageIdsKey(
  userId: string,
  courseId: string,
  sessionId: string,
): string {
  return scopedKey(LEARN_DELETED_MESSAGE_IDS_PREFIX, userId, courseId, sessionId);
}

function messageStorage(scope: SessionMessageStorage): Storage | null {
  if (typeof window === 'undefined') return null;
  return scope === 'local' ? localStorage : sessionStorage;
}

function messageStorageKey(
  scope: SessionMessageStorage,
  userId: string,
  courseId: string,
  sessionId: string,
): string {
  return scope === 'local'
    ? learnSessionMessagesKey(userId, courseId, sessionId)
    : learnSessionTabMessagesKey(userId, courseId, sessionId);
}

export function makeLearnSessionId(_regenerationScope?: string): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function readLearnSessionComposerDraft(
  userId: string,
  courseId: string,
  sessionId: string,
): string {
  if (typeof window === 'undefined') return '';
  try {
    return sessionStorage.getItem(learnSessionComposerDraftKey(userId, courseId, sessionId)) ?? '';
  } catch {
    return '';
  }
}

export function writeLearnSessionComposerDraft(
  userId: string,
  courseId: string,
  sessionId: string,
  draft: string,
): void {
  if (typeof window === 'undefined') return;
  const key = learnSessionComposerDraftKey(userId, courseId, sessionId);
  try {
    if (!draft) {
      sessionStorage.removeItem(key);
      return;
    }
    sessionStorage.setItem(key, draft);
  } catch {
    // sessionStorage may be unavailable or full.
  }
}

export function readLearnSessionRemoteBase(
  userId: string,
  courseId: string,
  sessionId: string,
): RemoteLearnConversationBaseSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(learnSessionRemoteBaseKey(userId, courseId, sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RemoteLearnConversationBaseSnapshot>;
    if (
      !Number.isSafeInteger(parsed.revision) ||
      (parsed.revision ?? -1) < 0 ||
      typeof parsed.title !== 'string' ||
      !Array.isArray(parsed.messages)
    ) {
      return null;
    }
    const messages = parsed.messages.filter((message): message is RemoteLearnMessagePayload =>
      Boolean(
        message &&
        typeof message.id === 'string' &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.text === 'string' &&
        typeof message.createdAt === 'number',
      ),
    );
    return {
      revision: parsed.revision as number,
      title: parsed.title,
      messages: messages.slice(-MAX_LOCAL_MESSAGES),
      messageWindow:
        parsed.messageWindow &&
        typeof parsed.messageWindow === 'object' &&
        typeof parsed.messageWindow.hasMore === 'boolean' &&
        typeof parsed.messageWindow.isComplete === 'boolean'
          ? {
              hasMore: parsed.messageWindow.hasMore,
              isComplete: parsed.messageWindow.isComplete,
            }
          : {
              hasMore: messages.length >= MAX_LOCAL_MESSAGES,
              isComplete: messages.length < MAX_LOCAL_MESSAGES,
            },
    };
  } catch {
    return null;
  }
}

export function writeLearnSessionRemoteBase(
  userId: string,
  courseId: string,
  sessionId: string,
  snapshot: RemoteLearnConversationBaseSnapshot,
): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(
      learnSessionRemoteBaseKey(userId, courseId, sessionId),
      JSON.stringify({ ...snapshot, messages: snapshot.messages.slice(-MAX_LOCAL_MESSAGES) }),
    );
  } catch {
    // sessionStorage may be unavailable or full.
  }
}

export function deleteLearnSessionRemoteBase(
  userId: string,
  courseId: string,
  sessionId: string,
): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(learnSessionRemoteBaseKey(userId, courseId, sessionId));
  } catch {
    // sessionStorage may be unavailable.
  }
}

export function readLearnSessionDirtyMessages(
  userId: string,
  courseId: string,
  sessionId: string,
): RemoteLearnMessagePayload[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(learnSessionDirtyMessagesKey(userId, courseId, sessionId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((message): message is RemoteLearnMessagePayload => {
        if (!message || typeof message !== 'object') return false;
        const candidate = message as Partial<RemoteLearnMessagePayload>;
        return Boolean(
          typeof candidate.id === 'string' &&
          (candidate.role === 'user' || candidate.role === 'assistant') &&
          typeof candidate.text === 'string' &&
          typeof candidate.createdAt === 'number',
        );
      })
      .slice(-MAX_LOCAL_MESSAGES);
  } catch {
    return [];
  }
}

export function writeLearnSessionDirtyMessages(
  userId: string,
  courseId: string,
  sessionId: string,
  messages: RemoteLearnMessagePayload[],
): void {
  if (typeof window === 'undefined') return;
  const key = learnSessionDirtyMessagesKey(userId, courseId, sessionId);
  try {
    if (messages.length === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(messages.slice(-MAX_LOCAL_MESSAGES)));
  } catch {
    // localStorage may be unavailable or full.
  }
}

export function readDeletedLearnMessageIds(
  userId: string,
  courseId: string,
  sessionId: string,
): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(deletedLearnMessageIdsKey(userId, courseId, sessionId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(String).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function writeDeletedLearnMessageIds(
  userId: string,
  courseId: string,
  sessionId: string,
  ids: Set<string>,
): void {
  if (typeof window === 'undefined') return;
  const key = deletedLearnMessageIdsKey(userId, courseId, sessionId);
  try {
    if (ids.size === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage may be unavailable.
  }
}

export function rememberDeletedLearnMessageId(
  userId: string,
  courseId: string,
  sessionId: string,
  messageId: string,
): void {
  const ids = readDeletedLearnMessageIds(userId, courseId, sessionId);
  ids.add(messageId);
  writeDeletedLearnMessageIds(userId, courseId, sessionId, ids);
}

export function clearDeletedLearnMessageIds(
  userId: string,
  courseId: string,
  sessionId: string,
): void {
  writeDeletedLearnMessageIds(userId, courseId, sessionId, new Set());
}

export function readDeletedLearnSessionIds(userId: string, courseId: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(deletedLearnSessionIdsKey(userId, courseId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.map(String).filter(Boolean).slice(-MAX_DELETED_SESSION_IDS));
  } catch {
    return new Set();
  }
}

function writeDeletedLearnSessionIds(userId: string, courseId: string, ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  const key = deletedLearnSessionIdsKey(userId, courseId);
  try {
    if (ids.size === 0) {
      localStorage.removeItem(key);
      return;
    }
    localStorage.setItem(key, JSON.stringify(Array.from(ids)));
  } catch {
    // localStorage may be unavailable.
  }
}

export function rememberDeletedLearnSessionId(
  userId: string,
  courseId: string,
  sessionId: string,
): void {
  const ids = readDeletedLearnSessionIds(userId, courseId);
  ids.add(sessionId);
  writeDeletedLearnSessionIds(userId, courseId, ids);
}

export function forgetDeletedLearnSessionId(
  userId: string,
  courseId: string,
  sessionId: string,
): void {
  const ids = readDeletedLearnSessionIds(userId, courseId);
  ids.delete(sessionId);
  writeDeletedLearnSessionIds(userId, courseId, ids);
}

export function filterDeletedLearnSessions(
  userId: string,
  courseId: string,
  sessions: LearnChatSession[],
): LearnChatSession[] {
  const deletedIds = readDeletedLearnSessionIds(userId, courseId);
  if (!deletedIds.size) return sessions;
  return sessions.filter((session) => !deletedIds.has(session.id));
}

export function sortLearnSessionsForList(
  _userId: string,
  _courseId: string,
  sessions: LearnChatSession[],
): LearnChatSession[] {
  return [...sessions].sort((left, right) => {
    const leftIsBlankNew = left.title === '新对话';
    const rightIsBlankNew = right.title === '新对话';
    if (leftIsBlankNew !== rightIsBlankNew) return leftIsBlankNew ? -1 : 1;
    return right.updatedAt - left.updatedAt;
  });
}

export function readLearnSessions(userId: string, courseId: string): LearnChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(learnSessionIndexKey(userId, courseId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<LearnChatSession>[];
    if (!Array.isArray(parsed)) return [];
    const sessions = parsed.filter((item): item is LearnChatSession =>
      Boolean(
        item &&
        typeof item.id === 'string' &&
        typeof item.title === 'string' &&
        typeof item.createdAt === 'number' &&
        typeof item.updatedAt === 'number' &&
        (item.messageCount === undefined ||
          (Number.isSafeInteger(item.messageCount) && item.messageCount >= 0)) &&
        (item.currentRevision === undefined ||
          (Number.isSafeInteger(item.currentRevision) && item.currentRevision >= 0)) &&
        (item.remoteState === undefined ||
          item.remoteState === 'local-only' ||
          item.remoteState === 'remote'),
      ),
    );
    return filterDeletedLearnSessions(
      userId,
      courseId,
      sortLearnSessionsForList(userId, courseId, sessions),
    );
  } catch {
    return [];
  }
}

export function writeLearnSessions(
  userId: string,
  courseId: string,
  sessions: LearnChatSession[],
): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(
      learnSessionIndexKey(userId, courseId),
      JSON.stringify(
        filterDeletedLearnSessions(
          userId,
          courseId,
          sortLearnSessionsForList(userId, courseId, sessions),
        ),
      ),
    );
  } catch {
    // localStorage may be unavailable or full.
  }
}

export function mergeLearnSessions(
  userId: string,
  courseId: string,
  current: LearnChatSession[],
  incoming: Array<LearnChatSession | RemoteLearnChatSession>,
): LearnChatSession[] {
  const deletedIds = readDeletedLearnSessionIds(userId, courseId);
  const byId = new Map<string, LearnChatSession>();
  for (const session of current) {
    if (!deletedIds.has(session.id)) byId.set(session.id, session);
  }
  for (const session of incoming) {
    if (deletedIds.has(session.id)) continue;
    const existing = byId.get(session.id);
    const incomingRemoteState =
      'remoteState' in session &&
      (session.remoteState === 'local-only' || session.remoteState === 'remote')
        ? session.remoteState
        : undefined;
    if (existing && incomingRemoteState === 'remote' && session.updatedAt < existing.updatedAt) {
      byId.set(session.id, {
        ...existing,
        messageCount:
          typeof session.messageCount === 'number' ? session.messageCount : existing.messageCount,
        currentRevision:
          typeof session.currentRevision === 'number'
            ? Math.max(existing.currentRevision ?? 0, session.currentRevision)
            : existing.currentRevision,
        remoteState: 'remote',
      });
      continue;
    }
    if (!existing || session.updatedAt >= existing.updatedAt) {
      byId.set(session.id, {
        id: session.id,
        title: session.title || existing?.title || '新对话',
        createdAt: session.createdAt || existing?.createdAt || Date.now(),
        updatedAt: session.updatedAt || existing?.updatedAt || Date.now(),
        messageCount:
          typeof session.messageCount === 'number' ? session.messageCount : existing?.messageCount,
        currentRevision:
          typeof session.currentRevision === 'number'
            ? session.currentRevision
            : existing?.currentRevision,
        remoteState: incomingRemoteState ?? existing?.remoteState,
      });
    }
  }
  return sortLearnSessionsForList(userId, courseId, Array.from(byId.values()));
}

export function readLearnSessionMessagesJson(
  userId: string,
  courseId: string,
  sessionId: string,
  scope: SessionMessageStorage,
): string | null {
  try {
    return (
      messageStorage(scope)?.getItem(messageStorageKey(scope, userId, courseId, sessionId)) ?? null
    );
  } catch {
    return null;
  }
}

export function writeLearnSessionMessagesJson(
  userId: string,
  courseId: string,
  sessionId: string,
  scope: SessionMessageStorage,
  value: string,
): void {
  try {
    messageStorage(scope)?.setItem(messageStorageKey(scope, userId, courseId, sessionId), value);
  } catch {
    // Browser storage may be unavailable or full.
  }
}

export function deleteLearnSessionMessageStorage(
  userId: string,
  courseId: string,
  sessionId: string,
): void {
  try {
    localStorage.removeItem(learnSessionMessagesKey(userId, courseId, sessionId));
  } catch {
    // localStorage may be unavailable.
  }
  try {
    sessionStorage.removeItem(learnSessionTabMessagesKey(userId, courseId, sessionId));
  } catch {
    // sessionStorage may be unavailable.
  }
  clearDeletedLearnMessageIds(userId, courseId, sessionId);
  writeLearnSessionDirtyMessages(userId, courseId, sessionId, []);
}
