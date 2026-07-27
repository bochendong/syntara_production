import { backendJson } from '@/lib/utils/backend-api';
import type { LearningAction } from '@/lib/types/chat';

export type RemoteLearnChatSession = {
  id: string;
  conversationId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  currentRevision?: number;
};

export type RemoteLearnMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  plan?: unknown;
  progressProposal?: unknown;
  pendingAction?: unknown;
  lecturePrompt?: unknown;
  lectureDeck?: unknown;
  learningActions?: LearningAction[];
  artifacts?: unknown;
  publicTrace?: unknown;
  attachments?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    size?: number;
    width?: number;
    height?: number;
  }>;
};

export type RemoteLearnConversationResponse = {
  storage: 'database' | 'unavailable';
  session: RemoteLearnChatSession | null;
  messages: RemoteLearnMessage[];
  currentRevision?: number;
};

export type RemoteLearnSessionListResponse = {
  storage: 'database' | 'unavailable';
  sessions: RemoteLearnChatSession[];
  hasMore?: boolean;
  nextCursor?: string | null;
  totalCount?: number;
};

export type RemoteLearnSessionPageResponse = {
  storage: 'database' | 'unavailable';
  sessions: RemoteLearnChatSession[];
  hasMore: boolean;
  nextCursor: string | null;
  totalCount: number;
};

export type RemoteLearnSessionPageOptions = {
  limit?: number;
  cursor?: string | null;
  ownerScope?: string;
  signal?: AbortSignal;
};

export type RemoteLearnMessagePayload = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
  plan?: unknown;
  progressProposal?: unknown;
  pendingAction?: unknown;
  lecturePrompt?: unknown;
  lectureDeck?: unknown;
  learningActions?: LearningAction[];
  artifacts?: unknown;
  publicTrace?: unknown;
  attachments?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    size?: number;
    width?: number;
    height?: number;
  }>;
};

export type RemoteLearnConversationMutationResponse = {
  storage: 'database' | 'unavailable';
  ok: boolean;
  accepted?: boolean;
  currentRevision?: number;
  deleted?: boolean;
  session?: RemoteLearnChatSession | null;
};

export type RemoteLearnConversationBaseSnapshot = {
  revision: number;
  title: string;
  messages: RemoteLearnMessagePayload[];
};

const CONVERSATION_MUTATION_TIMEOUT_MS = 130_000;
const CONVERSATION_LIST_TIMEOUT_MS = 40_000;
const CONVERSATION_LOAD_TIMEOUT_MS = 20_000;
const MAX_CONVERSATION_SYNC_ATTEMPTS = 3;
const MAX_SYNCED_MESSAGES = 120;
export const LEARN_CONVERSATION_RECONCILED_EVENT = 'syntara:learn-conversation-reconciled';
export const LEARN_CONVERSATION_CHANGED_STORAGE_KEY = 'syntara:learn-conversation-changed';
const conversationMutationQueues = new Map<string, Promise<void>>();
const conversationServerRevisions = new Map<string, number>();
const conversationGeneratedRevisions = new Map<string, number>();
const conversationBaseSnapshots = new Map<string, RemoteLearnConversationBaseSnapshot>();
const conversationSyncErrors = new Map<string, string>();
const deletedConversationKeys = new Set<string>();

function conversationKey(courseId: string, sessionId: string, ownerScope = 'current-user') {
  return [ownerScope, courseId, sessionId].map(encodeURIComponent).join(':');
}

function observeConversationRevision(
  courseId: string,
  sessionId: string,
  revision?: number,
  ownerScope?: string,
) {
  if (!Number.isSafeInteger(revision) || revision === undefined || revision < 0) return;
  const key = conversationKey(courseId, sessionId, ownerScope);
  conversationServerRevisions.set(
    key,
    Math.max(conversationServerRevisions.get(key) ?? 0, revision),
  );
}

function rememberConversationSnapshot(
  courseId: string,
  sessionId: string,
  snapshot: RemoteLearnConversationBaseSnapshot,
  ownerScope?: string,
) {
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) return;
  const key = conversationKey(courseId, sessionId, ownerScope);
  const current = conversationBaseSnapshots.get(key);
  if (current && current.revision > snapshot.revision) return;
  conversationServerRevisions.set(
    key,
    Math.max(conversationServerRevisions.get(key) ?? 0, snapshot.revision),
  );
  conversationBaseSnapshots.set(key, snapshot);
}

function observeConversationDeleted(
  courseId: string,
  sessionId: string,
  deleted: boolean,
  ownerScope?: string,
) {
  const key = conversationKey(courseId, sessionId, ownerScope);
  if (deleted) {
    deletedConversationKeys.add(key);
  } else {
    deletedConversationKeys.delete(key);
  }
}

function nextConversationRevision(
  courseId: string,
  sessionId: string,
  ownerScope?: string,
): number {
  const key = conversationKey(courseId, sessionId, ownerScope);
  const next = Math.max(
    Date.now(),
    (conversationServerRevisions.get(key) ?? 0) + 1,
    (conversationGeneratedRevisions.get(key) ?? 0) + 1,
  );
  conversationGeneratedRevisions.set(key, next);
  return next;
}

function jsonValueEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function arrayHasStableIds(
  value: unknown[],
): value is Array<Record<string, unknown> & { id: string }> {
  return value.every((item) => isJsonRecord(item) && typeof item.id === 'string');
}

function mergeChangedJsonValue(base: unknown, remote: unknown, local: unknown): unknown {
  if (jsonValueEqual(local, base)) return remote;
  if (jsonValueEqual(remote, base)) return local;
  if (jsonValueEqual(local, remote)) return remote;

  if (isJsonRecord(remote) && isJsonRecord(local)) {
    const baseRecord = isJsonRecord(base) ? base : {};
    const merged: Record<string, unknown> = {};
    const keys = new Set([
      ...Object.keys(baseRecord),
      ...Object.keys(remote),
      ...Object.keys(local),
    ]);
    for (const key of keys) {
      const value = mergeChangedJsonValue(baseRecord[key], remote[key], local[key]);
      if (value !== undefined) merged[key] = value;
    }
    return merged;
  }

  if (
    Array.isArray(remote) &&
    Array.isArray(local) &&
    arrayHasStableIds(remote) &&
    arrayHasStableIds(local)
  ) {
    const baseItems = Array.isArray(base) && arrayHasStableIds(base) ? base : [];
    const baseById = new Map(baseItems.map((item) => [item.id, item]));
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    const localById = new Map(local.map((item) => [item.id, item]));
    const orderedIds = [
      ...remote.map((item) => item.id),
      ...local.map((item) => item.id).filter((id) => !remoteById.has(id)),
    ];
    return orderedIds.flatMap((id) => {
      const baseItem = baseById.get(id);
      const remoteItem = remoteById.get(id);
      const localItem = localById.get(id);
      if (baseItem && (!remoteItem || !localItem)) return [];
      if (!remoteItem) return localItem ? [localItem] : [];
      if (!localItem) return [remoteItem];
      return [mergeChangedJsonValue(baseItem, remoteItem, localItem)];
    });
  }

  // Both sides changed the same scalar (or an unkeyed array). The current local action is the
  // user's explicit intent, so preserve it while independently changed object fields are merged.
  return local;
}

export function mergeRemoteLearnConversationMessages(
  base: RemoteLearnMessagePayload[],
  remote: RemoteLearnMessagePayload[],
  local: RemoteLearnMessagePayload[],
  options: { inferLocalDeletions?: boolean } = {},
): RemoteLearnMessagePayload[] {
  const baseById = new Map(base.map((message) => [message.id, message]));
  const remoteById = new Map(remote.map((message) => [message.id, message]));
  const localById = new Map(local.map((message) => [message.id, message]));
  const orderedIds = [
    ...remote.map((message) => message.id),
    ...local.map((message) => message.id).filter((id) => !remoteById.has(id)),
  ];

  return orderedIds
    .flatMap((id): RemoteLearnMessagePayload[] => {
      const baseMessage = baseById.get(id);
      const remoteMessage = remoteById.get(id);
      const localMessage = localById.get(id);
      // A server-side deletion always wins. A missing local message is only a deletion when the
      // caller owns a complete in-memory snapshot; persisted browser caches can be truncated or
      // stale and must pass inferLocalDeletions=false plus explicit message tombstones.
      if (baseMessage && !remoteMessage) return [];
      if (baseMessage && !localMessage) {
        return options.inferLocalDeletions === false && remoteMessage ? [remoteMessage] : [];
      }
      if (!remoteMessage) return localMessage ? [localMessage] : [];
      if (!localMessage) return [remoteMessage];
      const merged = mergeChangedJsonValue(
        baseMessage,
        remoteMessage,
        localMessage,
      ) as RemoteLearnMessagePayload;
      return [
        {
          ...merged,
          id,
          role: merged.role ?? localMessage.role ?? remoteMessage.role,
          text: merged.text ?? localMessage.text ?? remoteMessage.text ?? '',
          createdAt:
            merged.createdAt ?? localMessage.createdAt ?? remoteMessage.createdAt ?? Date.now(),
        },
      ];
    })
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
    .slice(-MAX_SYNCED_MESSAGES);
}

export function getRemoteLearnConversationBaseSnapshot(
  courseId: string,
  sessionId: string,
  ownerScope?: string,
): RemoteLearnConversationBaseSnapshot | null {
  return conversationBaseSnapshots.get(conversationKey(courseId, sessionId, ownerScope)) ?? null;
}

export function getRemoteLearnConversationSyncError(
  courseId: string,
  sessionId: string,
  ownerScope?: string,
): string | null {
  return conversationSyncErrors.get(conversationKey(courseId, sessionId, ownerScope)) ?? null;
}

function notifyConversationChanged(
  courseId: string,
  sessionId: string,
  revision: number,
  reconcileCurrentTab: boolean,
  ownerScope?: string,
) {
  if (typeof window === 'undefined') return;
  const detail = { courseId, sessionId, revision, ownerScope };
  if (reconcileCurrentTab) {
    window.dispatchEvent(new CustomEvent(LEARN_CONVERSATION_RECONCILED_EVENT, { detail }));
  }
  try {
    window.localStorage.setItem(
      LEARN_CONVERSATION_CHANGED_STORAGE_KEY,
      JSON.stringify({ ...detail, nonce: crypto.randomUUID() }),
    );
  } catch {
    /* localStorage may be unavailable */
  }
}

function enqueueConversationMutation<T>(
  courseId: string,
  sessionId: string,
  mutation: () => Promise<T>,
  ownerScope?: string,
): Promise<T> {
  const key = conversationKey(courseId, sessionId, ownerScope);
  const previous = conversationMutationQueues.get(key) ?? Promise.resolve();
  const operation = previous.then(mutation, mutation);
  const tail = operation.then(
    () => undefined,
    () => undefined,
  );
  conversationMutationQueues.set(key, tail);
  return operation.finally(() => {
    if (conversationMutationQueues.get(key) === tail) {
      conversationMutationQueues.delete(key);
    }
  });
}

function paramsFor(courseId: string, sessionId?: string) {
  const params = new URLSearchParams({ courseId });
  if (sessionId) params.set('sessionId', sessionId);
  return params.toString();
}

function sessionPageParamsFor(courseId: string, options: RemoteLearnSessionPageOptions) {
  const params = new URLSearchParams({ courseId });
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.cursor) params.set('cursor', options.cursor);
  return params.toString();
}

export async function listRemoteLearnSessionsPage(
  courseId: string,
  options: RemoteLearnSessionPageOptions = {},
): Promise<RemoteLearnSessionPageResponse | null> {
  try {
    const response = await backendJson<RemoteLearnSessionListResponse>(
      `/api/learn/conversations?${sessionPageParamsFor(courseId, options)}`,
      { signal: options.signal, timeoutMs: CONVERSATION_LIST_TIMEOUT_MS },
    );
    for (const session of response.sessions) {
      observeConversationRevision(
        courseId,
        session.id,
        session.currentRevision,
        options.ownerScope,
      );
    }
    return {
      ...response,
      hasMore: response.hasMore ?? false,
      nextCursor: response.nextCursor ?? null,
      totalCount: response.totalCount ?? response.sessions.length,
    };
  } catch (error) {
    // A course/session switch is an intentional cancellation, not a failed
    // database read. Preserve it so the shared learn queue can release
    // immediately instead of treating the next course as pool recovery work.
    if (options.signal?.aborted) throw error;
    console.warn('[learn-conversation-api] failed to list session page', error);
    return null;
  }
}

export async function listRemoteLearnSessions(
  courseId: string,
  ownerScope?: string,
): Promise<RemoteLearnSessionListResponse | null> {
  return listRemoteLearnSessionsPage(courseId, { ownerScope });
}

export async function loadRemoteLearnConversation(
  courseId: string,
  sessionId: string,
  ownerScope?: string,
): Promise<RemoteLearnConversationResponse | null> {
  try {
    return await loadRemoteLearnConversationOrThrow(courseId, sessionId, ownerScope);
  } catch (error) {
    console.warn('[learn-conversation-api] failed to load conversation', error);
    return null;
  }
}

export async function loadRemoteLearnConversationOrThrow(
  courseId: string,
  sessionId: string,
  ownerScope?: string,
  options: { signal?: AbortSignal } = {},
): Promise<RemoteLearnConversationResponse> {
  const response = await backendJson<RemoteLearnConversationResponse>(
    `/api/learn/conversations?${paramsFor(courseId, sessionId)}`,
    { signal: options.signal, timeoutMs: CONVERSATION_LOAD_TIMEOUT_MS },
  );
  const revision = response.currentRevision ?? response.session?.currentRevision ?? 0;
  observeConversationRevision(courseId, sessionId, revision, ownerScope);
  observeConversationDeleted(
    courseId,
    sessionId,
    response.session === null && revision > 0,
    ownerScope,
  );
  if (response.storage === 'database') {
    rememberConversationSnapshot(
      courseId,
      sessionId,
      {
        revision,
        title: response.session?.title ?? '新对话',
        messages: response.messages,
      },
      ownerScope,
    );
  }
  return response;
}

export async function syncRemoteLearnConversation(args: {
  courseId: string;
  sessionId: string;
  title: string;
  messages: RemoteLearnMessagePayload[];
  ownerScope?: string;
}): Promise<boolean> {
  const scopedKey = conversationKey(args.courseId, args.sessionId, args.ownerScope);
  const callBaseSnapshot = conversationBaseSnapshots.get(scopedKey) ?? {
    revision: 0,
    title: '新对话',
    messages: [],
  };
  const callDesired = {
    title: args.title,
    messages: args.messages.slice(-MAX_SYNCED_MESSAGES),
  };
  return enqueueConversationMutation(
    args.courseId,
    args.sessionId,
    async () => {
      const key = scopedKey;
      if (deletedConversationKeys.has(key)) {
        conversationSyncErrors.delete(key);
        return true;
      }

      const executionBaseSnapshot = conversationBaseSnapshots.get(key) ?? {
        revision: 0,
        title: '新对话',
        messages: [],
      };
      let desired = callDesired;
      let reconciled = executionBaseSnapshot.revision !== callBaseSnapshot.revision;
      if (reconciled) {
        desired = {
          title: mergeChangedJsonValue(
            callBaseSnapshot.title,
            executionBaseSnapshot.title,
            callDesired.title,
          ) as string,
          messages: mergeRemoteLearnConversationMessages(
            callBaseSnapshot.messages,
            executionBaseSnapshot.messages,
            callDesired.messages,
          ),
        };
      }

      for (let attempt = 0; attempt < MAX_CONVERSATION_SYNC_ATTEMPTS; attempt += 1) {
        if (deletedConversationKeys.has(key)) {
          conversationSyncErrors.delete(key);
          return true;
        }
        const baseSnapshot = conversationBaseSnapshots.get(key) ?? {
          revision: 0,
          title: '新对话',
          messages: [],
        };
        const clientRevision = nextConversationRevision(
          args.courseId,
          args.sessionId,
          args.ownerScope,
        );
        try {
          const response = await backendJson<RemoteLearnConversationMutationResponse>(
            '/api/learn/conversations',
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                courseId: args.courseId,
                sessionId: args.sessionId,
                title: desired.title,
                messages: desired.messages,
                baseRevision: baseSnapshot.revision,
                clientRevision,
              }),
              timeoutMs: CONVERSATION_MUTATION_TIMEOUT_MS,
            },
          );
          observeConversationRevision(
            args.courseId,
            args.sessionId,
            response.currentRevision,
            args.ownerScope,
          );
          if (response.deleted !== undefined) {
            observeConversationDeleted(
              args.courseId,
              args.sessionId,
              response.deleted,
              args.ownerScope,
            );
          }
          if (response.storage !== 'database' || !response.ok) {
            conversationSyncErrors.set(key, '会话存储当前不可用，服务端没有接受本次同步。');
            return false;
          }

          if (response.accepted !== false) {
            const acceptedRevision = response.currentRevision ?? clientRevision;
            rememberConversationSnapshot(
              args.courseId,
              args.sessionId,
              {
                revision: acceptedRevision,
                title: desired.title,
                messages: desired.messages,
              },
              args.ownerScope,
            );
            notifyConversationChanged(
              args.courseId,
              args.sessionId,
              acceptedRevision,
              reconciled,
              args.ownerScope,
            );
            conversationSyncErrors.delete(key);
            return true;
          }

          if (response.deleted) {
            const deletedRevision = response.currentRevision ?? baseSnapshot.revision;
            rememberConversationSnapshot(
              args.courseId,
              args.sessionId,
              {
                revision: deletedRevision,
                title: '新对话',
                messages: [],
              },
              args.ownerScope,
            );
            notifyConversationChanged(
              args.courseId,
              args.sessionId,
              deletedRevision,
              true,
              args.ownerScope,
            );
            conversationSyncErrors.delete(key);
            return true;
          }

          const remote = await loadRemoteLearnConversationOrThrow(
            args.courseId,
            args.sessionId,
            args.ownerScope,
          );
          const remoteRevision = remote.currentRevision ?? remote.session?.currentRevision ?? 0;
          if (remote.session === null && remoteRevision > 0) {
            notifyConversationChanged(
              args.courseId,
              args.sessionId,
              remoteRevision,
              true,
              args.ownerScope,
            );
            conversationSyncErrors.delete(key);
            return true;
          }
          if (remote.storage !== 'database') {
            conversationSyncErrors.set(key, '会话存储当前不可用，无法读取冲突后的最新版本。');
            return false;
          }

          // A genuinely missing revision-0 session is not a message deletion. Preserve the local
          // desired snapshot so it can recreate the session against base revision 0.
          if (remote.session) {
            desired = {
              title: mergeChangedJsonValue(
                baseSnapshot.title,
                remote.session.title,
                desired.title,
              ) as string,
              messages: mergeRemoteLearnConversationMessages(
                baseSnapshot.messages,
                remote.messages,
                desired.messages,
              ),
            };
          }
          reconciled = true;
        } catch (error) {
          console.warn('[learn-conversation-api] failed to sync conversation', error);
          conversationSyncErrors.set(
            key,
            error instanceof Error ? error.message : '会话同步请求失败',
          );
          return false;
        }
      }

      console.warn('[learn-conversation-api] conversation sync conflicts exhausted retries', {
        courseId: args.courseId,
        sessionId: args.sessionId,
      });
      conversationSyncErrors.set(key, '会话版本连续发生冲突，三次合并重试均未被服务端接受。');
      return false;
    },
    args.ownerScope,
  );
}

export async function deleteRemoteLearnConversation(
  courseId: string,
  sessionId: string,
  ownerScope?: string,
): Promise<boolean> {
  return enqueueConversationMutation(
    courseId,
    sessionId,
    async () => {
      const key = conversationKey(courseId, sessionId, ownerScope);
      const baseRevision =
        conversationServerRevisions.get(key) ?? conversationBaseSnapshots.get(key)?.revision ?? 0;
      const clientRevision = nextConversationRevision(courseId, sessionId, ownerScope);
      const params = new URLSearchParams({
        courseId,
        sessionId,
        baseRevision: String(baseRevision),
        clientRevision: String(clientRevision),
      });
      try {
        const response = await backendJson<RemoteLearnConversationMutationResponse>(
          `/api/learn/conversations?${params.toString()}`,
          { method: 'DELETE', timeoutMs: CONVERSATION_MUTATION_TIMEOUT_MS },
        );
        observeConversationRevision(courseId, sessionId, response.currentRevision, ownerScope);
        if (response.deleted !== undefined) {
          observeConversationDeleted(courseId, sessionId, response.deleted, ownerScope);
        }
        const deleted =
          response.storage === 'database' &&
          response.ok &&
          (response.accepted !== false || response.deleted === true);
        if (deleted) {
          const acceptedRevision = response.currentRevision ?? clientRevision;
          rememberConversationSnapshot(
            courseId,
            sessionId,
            {
              revision: acceptedRevision,
              title: '新对话',
              messages: [],
            },
            ownerScope,
          );
          observeConversationDeleted(courseId, sessionId, true, ownerScope);
          notifyConversationChanged(courseId, sessionId, acceptedRevision, false, ownerScope);
        }
        return deleted;
      } catch (error) {
        console.warn('[learn-conversation-api] failed to delete conversation', error);
        return false;
      }
    },
    ownerScope,
  );
}
