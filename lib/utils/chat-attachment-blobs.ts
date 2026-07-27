import type { ChatMessageMetadata } from '@/lib/types/chat';

const DB_NAME = 'synatra-chat-attachments';
const DB_VERSION = 2;
const STORE = 'blobs';
const OWNER_COURSE_SESSION_INDEX = 'ownerCourseSession';
const OWNER_COURSE_SESSION_MESSAGE_INDEX = 'ownerCourseSessionMessage';

export type ChatAttachmentBlobMetadata = {
  ownerId?: string;
  courseId?: string;
  sessionId?: string;
  messageId?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  width?: number;
  height?: number;
  createdAt?: number;
  updatedAt?: number;
};

export type StoredChatAttachmentBlob = ChatAttachmentBlobMetadata & {
  id: string;
  blob: Blob;
  createdAt: number;
  updatedAt: number;
};

export type ChatAttachmentBlobScope = {
  ownerId: string;
  courseId: string;
  sessionId: string;
  messageId?: string;
};

export type PruneChatAttachmentBlobsOptions = {
  before: number;
  ownerId?: string;
  courseId?: string;
  sessionId?: string;
  excludeIds?: Iterable<string>;
};

function requiredScopePart(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Missing chat attachment ${label}.`);
  return normalized;
}

function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error || new Error('Failed to access local chat attachment storage.'));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error || new Error('Failed to update local chat attachment storage.'));
    transaction.onabort = () =>
      reject(transaction.error || new Error('Local chat attachment transaction was aborted.'));
  });
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser context.'));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => {
      settled = true;
      reject(req.error || new Error('Failed to open local chat attachment storage.'));
    };
    req.onblocked = () => {
      settled = true;
      reject(new Error('Local chat attachment storage upgrade is blocked by another tab.'));
    };
    req.onsuccess = () => {
      const db = req.result;
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      const store = db.objectStoreNames.contains(STORE)
        ? req.transaction?.objectStore(STORE)
        : db.createObjectStore(STORE, { keyPath: 'id' });
      if (!store) return;
      if (!store.indexNames.contains(OWNER_COURSE_SESSION_INDEX)) {
        store.createIndex(OWNER_COURSE_SESSION_INDEX, ['ownerId', 'courseId', 'sessionId'], {
          unique: false,
        });
      }
      if (!store.indexNames.contains(OWNER_COURSE_SESSION_MESSAGE_INDEX)) {
        store.createIndex(
          OWNER_COURSE_SESSION_MESSAGE_INDEX,
          ['ownerId', 'courseId', 'sessionId', 'messageId'],
          { unique: false },
        );
      }
    };
  });
}

/** 发送消息时写入；与快照里的 attachment.id 对应 */
export async function storeChatAttachmentBlob(
  id: string,
  blob: Blob,
  metadata: ChatAttachmentBlobMetadata = {},
): Promise<void> {
  const attachmentId = id.trim();
  if (!attachmentId) throw new Error('Missing chat attachment id.');
  if (typeof Blob === 'undefined' || !(blob instanceof Blob)) {
    throw new Error('Chat attachment content must be a Blob.');
  }

  const now = Date.now();
  const record: StoredChatAttachmentBlob = {
    id: attachmentId,
    blob,
    ownerId: optionalText(metadata.ownerId),
    courseId: optionalText(metadata.courseId),
    sessionId: optionalText(metadata.sessionId),
    messageId: optionalText(metadata.messageId),
    name: optionalText(metadata.name),
    mimeType: optionalText(metadata.mimeType) || optionalText(blob.type),
    size:
      Number.isFinite(metadata.size) && metadata.size !== undefined && metadata.size >= 0
        ? metadata.size
        : blob.size,
    width:
      Number.isFinite(metadata.width) && metadata.width !== undefined && metadata.width > 0
        ? metadata.width
        : undefined,
    height:
      Number.isFinite(metadata.height) && metadata.height !== undefined && metadata.height > 0
        ? metadata.height
        : undefined,
    createdAt:
      Number.isFinite(metadata.createdAt) && metadata.createdAt !== undefined
        ? metadata.createdAt
        : now,
    updatedAt:
      Number.isFinite(metadata.updatedAt) && metadata.updatedAt !== undefined
        ? metadata.updatedAt
        : now,
  };

  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(STORE).put(record);
    await done;
  } finally {
    db.close();
  }
}

export async function getChatAttachmentBlobRecord(
  id: string,
): Promise<StoredChatAttachmentBlob | null> {
  const attachmentId = id.trim();
  if (!attachmentId) return null;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readonly');
    const row = await requestResult(
      tx.objectStore(STORE).get(attachmentId) as IDBRequest<StoredChatAttachmentBlob | undefined>,
    );
    return row ?? null;
  } finally {
    db.close();
  }
}

export async function getChatAttachmentBlob(id: string): Promise<Blob | null> {
  return (await getChatAttachmentBlobRecord(id))?.blob ?? null;
}

export async function deleteChatAttachmentBlob(id: string): Promise<void> {
  const attachmentId = id.trim();
  if (!attachmentId) return;
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const done = transactionDone(tx);
    tx.objectStore(STORE).delete(attachmentId);
    await done;
  } finally {
    db.close();
  }
}

export async function deleteChatAttachmentBlobs(ids: Iterable<string>): Promise<number> {
  const attachmentIds = Array.from(new Set(Array.from(ids, (id) => id.trim()).filter(Boolean)));
  if (!attachmentIds.length) return 0;

  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const done = transactionDone(tx);
    const store = tx.objectStore(STORE);
    attachmentIds.forEach((id) => store.delete(id));
    await done;
    return attachmentIds.length;
  } finally {
    db.close();
  }
}

export async function deleteChatAttachmentBlobsByScope(
  scope: ChatAttachmentBlobScope,
): Promise<number> {
  const ownerId = requiredScopePart(scope.ownerId, 'owner id');
  const courseId = requiredScopePart(scope.courseId, 'course id');
  const sessionId = requiredScopePart(scope.sessionId, 'session id');
  const messageId = optionalText(scope.messageId);
  const indexName = messageId ? OWNER_COURSE_SESSION_MESSAGE_INDEX : OWNER_COURSE_SESSION_INDEX;
  const key: IDBValidKey = messageId
    ? [ownerId, courseId, sessionId, messageId]
    : [ownerId, courseId, sessionId];

  const db = await openDb();
  try {
    return await new Promise<number>((resolve, reject) => {
      let deletedCount = 0;
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const request = store.index(indexName).openKeyCursor(IDBKeyRange.only(key));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        store.delete(cursor.primaryKey);
        deletedCount += 1;
        cursor.continue();
      };
      request.onerror = () => tx.abort();
      tx.oncomplete = () => resolve(deletedCount);
      tx.onerror = () =>
        reject(tx.error || new Error('Failed to clear local chat attachment storage.'));
      tx.onabort = () =>
        reject(tx.error || new Error('Local chat attachment cleanup was aborted.'));
    });
  } finally {
    db.close();
  }
}

export async function pruneChatAttachmentBlobs(
  options: PruneChatAttachmentBlobsOptions,
): Promise<number> {
  if (!Number.isFinite(options.before)) {
    throw new Error('Missing chat attachment cleanup cutoff.');
  }
  const ownerId = optionalText(options.ownerId);
  const courseId = optionalText(options.courseId);
  const sessionId = optionalText(options.sessionId);
  const excludeIds = new Set(
    options.excludeIds ? Array.from(options.excludeIds, (id) => id.trim()).filter(Boolean) : [],
  );
  let deletedCount = 0;

  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const done = transactionDone(tx);
    const request = tx.objectStore(STORE).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      const record = cursor.value as StoredChatAttachmentBlob;
      const updatedAt = Number.isFinite(record.updatedAt)
        ? record.updatedAt
        : Number.isFinite(record.createdAt)
          ? record.createdAt
          : Number.POSITIVE_INFINITY;
      const matchesScope =
        (!ownerId || record.ownerId === ownerId) &&
        (!courseId || record.courseId === courseId) &&
        (!sessionId || record.sessionId === sessionId);
      if (matchesScope && updatedAt < options.before && !excludeIds.has(record.id)) {
        cursor.delete();
        deletedCount += 1;
      }
      cursor.continue();
    };
    request.onerror = () => tx.abort();
    await done;
    return deletedCount;
  } finally {
    db.close();
  }
}

/** 从 IndexedDB 补回 objectUrl，供历史消息再次打开附件 */
export async function hydrateMetadataAttachments(
  attachments: ChatMessageMetadata['attachments'] | undefined,
): Promise<ChatMessageMetadata['attachments'] | undefined> {
  if (!attachments?.length) return attachments;
  const next = await Promise.all(
    attachments.map(async (a) => {
      if (a.objectUrl) return a;
      try {
        const blob = await getChatAttachmentBlob(a.id);
        return blob ? { ...a, objectUrl: URL.createObjectURL(blob) } : a;
      } catch {
        return a;
      }
    }),
  );
  return next;
}
