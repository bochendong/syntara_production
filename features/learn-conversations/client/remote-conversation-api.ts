import { backendJson } from '@/lib/utils/backend-api';
import type { ChatContextCompression, LearningAction } from '@/lib/types/chat';

// Browser transport and optimistic concurrency state for course conversations.
// Keep this boundary independent from the /learn page controller so other
// course-chat surfaces can reuse the same revision and tombstone protocol.

export type RemoteLearnChatSession = {
  id: string;
  conversationId?: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  currentRevision?: number;
  messageCount?: number;
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
  contextCompression?: ChatContextCompression;
  attachments?: Array<{
    id?: string;
    name?: string;
    mimeType?: string;
    size?: number;
    width?: number;
    height?: number;
  }>;
};

export type RemoteLearnMessageWindow = {
  hasMore: boolean;
  isComplete: boolean;
};

export type RemoteLearnMessagePage = {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
};

export type RemoteLearnConversationSummary = {
  text: string;
  throughSequence: string;
  version: number;
  updatedAt: number | null;
};

export type RemoteLearnConversationResponse = {
  storage: 'database' | 'unavailable';
  session: RemoteLearnChatSession | null;
  messages: RemoteLearnMessage[];
  deletedMessageIds?: string[];
  messageWindow?: RemoteLearnMessageWindow;
  messagePage?: RemoteLearnMessagePage;
  summary?: RemoteLearnConversationSummary | null;
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
  contextCompression?: ChatContextCompression;
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
  appliedMessageIds?: string[];
  appliedDeletedMessageIds?: string[];
  serverDeletedMessageIds?: string[];
  session?: RemoteLearnChatSession | null;
};

export type RemoteLearnConversationBaseSnapshot = {
  revision: number;
  title: string;
  messages: RemoteLearnMessagePayload[];
  messageWindow?: RemoteLearnMessageWindow;
};

type PendingConversationDelta = {
  messages: Map<string, RemoteLearnMessagePayload>;
  deletedMessageIds: Set<string>;
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
const conversationLocalMessageBaselines = new Map<string, RemoteLearnMessagePayload[]>();
const conversationPendingDeltas = new Map<string, PendingConversationDelta>();
const conversationServerDeletedMessageIds = new Map<string, Set<string>>();
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
  const hasMore =
    snapshot.messageWindow?.hasMore === true || snapshot.messages.length > MAX_SYNCED_MESSAGES;
  const isComplete = snapshot.messageWindow?.isComplete !== false && !hasMore;
  conversationServerRevisions.set(
    key,
    Math.max(conversationServerRevisions.get(key) ?? 0, snapshot.revision),
  );
  conversationBaseSnapshots.set(key, {
    ...snapshot,
    messages: snapshot.messages.slice(-MAX_SYNCED_MESSAGES),
    messageWindow: {
      hasMore,
      isComplete,
    },
  });
}

function mergeConversationSnapshotPages(
  current: RemoteLearnMessagePayload[],
  incoming: RemoteLearnMessagePayload[],
): { messages: RemoteLearnMessagePayload[]; truncated: boolean } {
  const byId = new Map<string, RemoteLearnMessagePayload>();
  for (const message of current) byId.set(message.id, message);
  for (const message of incoming) byId.set(message.id, message);
  const combined = Array.from(byId.values()).sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  return {
    messages: combined.slice(-MAX_SYNCED_MESSAGES),
    truncated: combined.length > MAX_SYNCED_MESSAGES,
  };
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

function observeServerDeletedMessageIds(
  courseId: string,
  sessionId: string,
  messageIds: readonly string[] | undefined,
  ownerScope?: string,
) {
  if (!messageIds?.length) return;
  const key = conversationKey(courseId, sessionId, ownerScope);
  const known = conversationServerDeletedMessageIds.get(key) ?? new Set<string>();
  for (const messageId of messageIds) {
    if (messageId) known.add(messageId);
  }
  conversationServerDeletedMessageIds.set(key, known);

  const pending = conversationPendingDeltas.get(key);
  if (pending) {
    for (const messageId of known) {
      pending.messages.delete(messageId);
      pending.deletedMessageIds.delete(messageId);
    }
    if (pending.messages.size === 0 && pending.deletedMessageIds.size === 0) {
      conversationPendingDeltas.delete(key);
    }
  }

  const baseline = conversationLocalMessageBaselines.get(key);
  if (baseline) {
    conversationLocalMessageBaselines.set(
      key,
      baseline.filter((message) => !known.has(message.id)),
    );
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

function rememberLocalMessageBaseline(key: string, messages: RemoteLearnMessagePayload[]): void {
  conversationLocalMessageBaselines.set(
    key,
    Array.from(new Map(messages.map((message) => [message.id, message])).values()),
  );
}

function registerPendingConversationDelta(
  key: string,
  dirtyMessages: RemoteLearnMessagePayload[],
  deletedMessageIds: string[],
): void {
  const pending = conversationPendingDeltas.get(key) ?? {
    messages: new Map<string, RemoteLearnMessagePayload>(),
    deletedMessageIds: new Set<string>(),
  };
  const serverDeletedMessageIds = conversationServerDeletedMessageIds.get(key) ?? new Set<string>();

  // A detail response is intentionally only a partial window. Never infer
  // writes by diffing the visible/local cache against that window: an older
  // cached message is unknown, not newly created. Callers must explicitly
  // identify messages changed by a local user action.
  for (const message of dirtyMessages) {
    if (serverDeletedMessageIds.has(message.id)) continue;
    pending.deletedMessageIds.delete(message.id);
    pending.messages.set(message.id, message);
  }
  for (const messageId of deletedMessageIds) {
    if (serverDeletedMessageIds.has(messageId)) continue;
    pending.messages.delete(messageId);
    pending.deletedMessageIds.add(messageId);
  }

  if (pending.messages.size > 0 || pending.deletedMessageIds.size > 0) {
    conversationPendingDeltas.set(key, pending);
  }
}

function snapshotPendingConversationDelta(key: string): {
  messages: RemoteLearnMessagePayload[];
  deletedMessageIds: string[];
} {
  const pending = conversationPendingDeltas.get(key);
  return {
    messages: pending ? Array.from(pending.messages.values()) : [],
    deletedMessageIds: pending ? Array.from(pending.deletedMessageIds) : [],
  };
}

function acknowledgePendingConversationDelta(
  key: string,
  accepted: {
    messages: RemoteLearnMessagePayload[];
    deletedMessageIds: string[];
  },
): void {
  const pending = conversationPendingDeltas.get(key);
  if (!pending) return;

  for (const message of accepted.messages) {
    if (jsonValueEqual(pending.messages.get(message.id), message)) {
      pending.messages.delete(message.id);
    }
  }
  for (const messageId of accepted.deletedMessageIds) {
    pending.deletedMessageIds.delete(messageId);
  }

  if (pending.messages.size === 0 && pending.deletedMessageIds.size === 0) {
    conversationPendingDeltas.delete(key);
  }
}

function applyConversationMessagePatch(
  base: RemoteLearnConversationBaseSnapshot,
  patch: {
    messages: RemoteLearnMessagePayload[];
    deletedMessageIds: string[];
  },
  revision: number,
  title: string,
): RemoteLearnConversationBaseSnapshot {
  const byId = new Map(base.messages.map((message) => [message.id, message]));
  for (const messageId of patch.deletedMessageIds) byId.delete(messageId);
  for (const message of patch.messages) byId.set(message.id, message);
  const knownMessages = Array.from(byId.values()).sort(
    (left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id),
  );
  const hasMore =
    base.messageWindow?.hasMore === true || knownMessages.length > MAX_SYNCED_MESSAGES;
  const isComplete = base.messageWindow?.isComplete !== false && !hasMore;
  return {
    revision,
    title,
    messages: knownMessages.slice(-MAX_SYNCED_MESSAGES),
    messageWindow: {
      hasMore,
      isComplete,
    },
  };
}

function conversationPatchBatches(patch: {
  messages: RemoteLearnMessagePayload[];
  deletedMessageIds: string[];
}): Array<{
  messages: RemoteLearnMessagePayload[];
  deletedMessageIds: string[];
}> {
  const batchCount = Math.max(
    1,
    Math.ceil(patch.messages.length / MAX_SYNCED_MESSAGES),
    Math.ceil(patch.deletedMessageIds.length / MAX_SYNCED_MESSAGES),
  );
  return Array.from({ length: batchCount }, (_, index) => ({
    messages: patch.messages.slice(index * MAX_SYNCED_MESSAGES, (index + 1) * MAX_SYNCED_MESSAGES),
    deletedMessageIds: patch.deletedMessageIds.slice(
      index * MAX_SYNCED_MESSAGES,
      (index + 1) * MAX_SYNCED_MESSAGES,
    ),
  }));
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
  deleted = false,
  deletedMessageIds: readonly string[] = [],
) {
  if (typeof window === 'undefined') return;
  const detail = {
    courseId,
    sessionId,
    revision,
    ownerScope,
    deleted,
    deletedMessageIds: Array.from(new Set(deletedMessageIds)),
  };
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

function paramsFor(
  courseId: string,
  sessionId?: string,
  options: { messageLimit?: number; before?: string | null } = {},
) {
  const params = new URLSearchParams({ courseId });
  if (sessionId) params.set('sessionId', sessionId);
  if (options.messageLimit !== undefined) {
    params.set('messageLimit', String(options.messageLimit));
  }
  if (options.before) params.set('before', options.before);
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
  options: {
    signal?: AbortSignal;
    preserveLocalBaseline?: boolean;
    messageLimit?: number;
    before?: string | null;
  } = {},
): Promise<RemoteLearnConversationResponse> {
  const response = await backendJson<RemoteLearnConversationResponse>(
    `/api/learn/conversations?${paramsFor(courseId, sessionId, options)}`,
    { signal: options.signal, timeoutMs: CONVERSATION_LOAD_TIMEOUT_MS },
  );
  const messageWindow = response.messageWindow ?? {
    hasMore: false,
    isComplete: true,
  };
  const normalizedResponse = {
    ...response,
    messageWindow,
  };
  const revision = response.currentRevision ?? response.session?.currentRevision ?? 0;
  observeConversationRevision(courseId, sessionId, revision, ownerScope);
  observeConversationDeleted(
    courseId,
    sessionId,
    response.session === null && revision > 0,
    ownerScope,
  );
  observeServerDeletedMessageIds(courseId, sessionId, response.deletedMessageIds, ownerScope);
  if (response.storage === 'database') {
    const key = conversationKey(courseId, sessionId, ownerScope);
    const currentSnapshot = conversationBaseSnapshots.get(key);
    const paginatedSnapshot =
      options.before && currentSnapshot?.revision === revision
        ? mergeConversationSnapshotPages(currentSnapshot.messages, response.messages)
        : { messages: response.messages, truncated: false };
    const snapshotMessageWindow = options.before
      ? {
          hasMore: messageWindow.hasMore || paginatedSnapshot.truncated,
          isComplete: messageWindow.isComplete && !paginatedSnapshot.truncated,
        }
      : messageWindow;
    rememberConversationSnapshot(
      courseId,
      sessionId,
      {
        revision,
        title: response.session?.title ?? '新对话',
        messages: paginatedSnapshot.messages,
        messageWindow: snapshotMessageWindow,
      },
      ownerScope,
    );
    if (!options.preserveLocalBaseline) {
      rememberLocalMessageBaseline(
        conversationKey(courseId, sessionId, ownerScope),
        response.messages,
      );
    }
  }
  return normalizedResponse;
}

export async function syncRemoteLearnConversation(args: {
  courseId: string;
  sessionId: string;
  title: string;
  messages: RemoteLearnMessagePayload[];
  dirtyMessages?: RemoteLearnMessagePayload[];
  deletedMessageIds?: string[];
  ownerScope?: string;
}): Promise<boolean> {
  const scopedKey = conversationKey(args.courseId, args.sessionId, args.ownerScope);
  const callBaseSnapshot = conversationBaseSnapshots.get(scopedKey) ?? {
    revision: 0,
    title: '新对话',
    messages: [],
    messageWindow: { hasMore: false, isComplete: true },
  };
  registerPendingConversationDelta(
    scopedKey,
    args.dirtyMessages ?? args.messages,
    args.deletedMessageIds || [],
  );

  return enqueueConversationMutation(
    args.courseId,
    args.sessionId,
    async () => {
      const key = scopedKey;
      if (deletedConversationKeys.has(key)) {
        conversationPendingDeltas.delete(key);
        rememberLocalMessageBaseline(key, []);
        conversationSyncErrors.delete(key);
        return true;
      }

      const executionBaseSnapshot = conversationBaseSnapshots.get(key) ?? {
        revision: 0,
        title: '新对话',
        messages: [],
        messageWindow: { hasMore: false, isComplete: true },
      };
      let reconciled = executionBaseSnapshot.revision !== callBaseSnapshot.revision;
      let desiredTitle = reconciled
        ? (mergeChangedJsonValue(
            callBaseSnapshot.title,
            executionBaseSnapshot.title,
            args.title,
          ) as string)
        : args.title;
      const submittedDelta = snapshotPendingConversationDelta(key);
      const batches = conversationPatchBatches(submittedDelta);
      const acceptedDelta = {
        messages: [] as RemoteLearnMessagePayload[],
        deletedMessageIds: [] as string[],
      };
      let acceptedRevision = executionBaseSnapshot.revision;

      const acceptDeletedConversation = (revision: number) => {
        rememberConversationSnapshot(
          args.courseId,
          args.sessionId,
          {
            revision,
            title: '新对话',
            messages: [],
            messageWindow: { hasMore: false, isComplete: true },
          },
          args.ownerScope,
        );
        rememberLocalMessageBaseline(key, []);
        conversationPendingDeltas.delete(key);
        observeConversationDeleted(args.courseId, args.sessionId, true, args.ownerScope);
        notifyConversationChanged(
          args.courseId,
          args.sessionId,
          revision,
          true,
          args.ownerScope,
          true,
        );
        conversationSyncErrors.delete(key);
      };

      for (const batch of batches) {
        let batchAccepted = false;
        const alreadyAppliedMessageIds = new Set<string>();
        const alreadyAppliedDeletedMessageIds = new Set<string>();

        for (let attempt = 0; attempt < MAX_CONVERSATION_SYNC_ATTEMPTS; attempt += 1) {
          if (deletedConversationKeys.has(key)) {
            conversationPendingDeltas.delete(key);
            rememberLocalMessageBaseline(key, []);
            conversationSyncErrors.delete(key);
            return true;
          }

          const baseSnapshot = conversationBaseSnapshots.get(key) ?? {
            revision: 0,
            title: '新对话',
            messages: [],
            messageWindow: { hasMore: false, isComplete: true },
          };
          const knownServerDeletedMessageIds =
            conversationServerDeletedMessageIds.get(key) ?? new Set<string>();
          const requestBatch = {
            messages: batch.messages.filter(
              (message) =>
                !knownServerDeletedMessageIds.has(message.id) &&
                !alreadyAppliedMessageIds.has(message.id),
            ),
            deletedMessageIds: batch.deletedMessageIds.filter(
              (messageId) =>
                !knownServerDeletedMessageIds.has(messageId) &&
                !alreadyAppliedDeletedMessageIds.has(messageId),
            ),
          };
          if (requestBatch.messages.length === 0 && requestBatch.deletedMessageIds.length === 0) {
            batchAccepted = true;
            break;
          }
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
                  title: desiredTitle,
                  syncMode: 'patch',
                  messages: requestBatch.messages,
                  deletedMessageIds: requestBatch.deletedMessageIds,
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
            observeServerDeletedMessageIds(
              args.courseId,
              args.sessionId,
              response.serverDeletedMessageIds,
              args.ownerScope,
            );
            if (response.storage !== 'database' || !response.ok) {
              conversationSyncErrors.set(key, '会话存储当前不可用，服务端没有接受本次同步。');
              return false;
            }

            if (response.accepted !== false) {
              acceptedRevision = response.currentRevision ?? clientRevision;
              const appliedMessageIds = new Set(
                response.appliedMessageIds ?? requestBatch.messages.map((message) => message.id),
              );
              const appliedDeletedMessageIds = new Set(
                response.appliedDeletedMessageIds ?? requestBatch.deletedMessageIds,
              );
              const serverDeletedMessageIds = response.serverDeletedMessageIds ?? [];
              if (serverDeletedMessageIds.length > 0) reconciled = true;
              const acceptedBatch = {
                messages: requestBatch.messages.filter((message) =>
                  appliedMessageIds.has(message.id),
                ),
                deletedMessageIds: [
                  ...requestBatch.deletedMessageIds.filter((messageId) =>
                    appliedDeletedMessageIds.has(messageId),
                  ),
                  ...serverDeletedMessageIds,
                ],
              };
              const acceptedBase = applyConversationMessagePatch(
                baseSnapshot,
                acceptedBatch,
                acceptedRevision,
                desiredTitle,
              );
              rememberConversationSnapshot(
                args.courseId,
                args.sessionId,
                acceptedBase,
                args.ownerScope,
              );
              acceptedDelta.messages.push(...acceptedBatch.messages);
              acceptedDelta.deletedMessageIds.push(...acceptedBatch.deletedMessageIds);
              batchAccepted = true;
              break;
            }

            if (response.deleted) {
              acceptDeletedConversation(response.currentRevision ?? baseSnapshot.revision);
              return true;
            }

            const remote = await loadRemoteLearnConversationOrThrow(
              args.courseId,
              args.sessionId,
              args.ownerScope,
              { preserveLocalBaseline: true },
            );
            const remoteRevision = remote.currentRevision ?? remote.session?.currentRevision ?? 0;
            if (remote.session === null && remoteRevision > 0) {
              acceptDeletedConversation(remoteRevision);
              return true;
            }
            if (remote.storage !== 'database') {
              conversationSyncErrors.set(key, '会话存储当前不可用，无法读取冲突后的最新版本。');
              return false;
            }

            // Another tab or device may have already committed this exact
            // patch before our optimistic revision arrived. Treat identical
            // remote messages and confirmed tombstones as an idempotent
            // success instead of writing them again and causing a revision
            // ping-pong between clients.
            const remoteById = new Map(remote.messages.map((message) => [message.id, message]));
            const remoteDeletedIds = new Set(remote.deletedMessageIds ?? []);
            for (const message of requestBatch.messages) {
              if (!jsonValueEqual(remoteById.get(message.id), message)) continue;
              alreadyAppliedMessageIds.add(message.id);
              acceptedDelta.messages.push(message);
            }
            for (const messageId of requestBatch.deletedMessageIds) {
              if (!remoteDeletedIds.has(messageId)) continue;
              alreadyAppliedDeletedMessageIds.add(messageId);
              acceptedDelta.deletedMessageIds.push(messageId);
            }
            if (
              alreadyAppliedMessageIds.size === batch.messages.length &&
              alreadyAppliedDeletedMessageIds.size === batch.deletedMessageIds.length
            ) {
              acceptedRevision = remoteRevision;
              batchAccepted = true;
              break;
            }

            // Only title retains three-way merge semantics. Message upserts and
            // tombstones remain immutable pending operations across this partial-window read.
            if (remote.session) {
              desiredTitle = mergeChangedJsonValue(
                baseSnapshot.title,
                remote.session.title,
                desiredTitle,
              ) as string;
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

        if (!batchAccepted) {
          console.warn('[learn-conversation-api] conversation sync conflicts exhausted retries', {
            courseId: args.courseId,
            sessionId: args.sessionId,
          });
          conversationSyncErrors.set(key, '会话版本连续发生冲突，三次合并重试均未被服务端接受。');
          return false;
        }
      }

      acknowledgePendingConversationDelta(key, acceptedDelta);
      notifyConversationChanged(
        args.courseId,
        args.sessionId,
        acceptedRevision,
        reconciled,
        args.ownerScope,
        false,
        acceptedDelta.deletedMessageIds,
      );
      conversationSyncErrors.delete(key);
      return true;
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
              messageWindow: { hasMore: false, isComplete: true },
            },
            ownerScope,
          );
          rememberLocalMessageBaseline(key, []);
          conversationPendingDeltas.delete(key);
          observeConversationDeleted(courseId, sessionId, true, ownerScope);
          notifyConversationChanged(courseId, sessionId, acceptedRevision, false, ownerScope, true);
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
