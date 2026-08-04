'use client';

import {
  deleteChatAttachmentBlob,
  deleteChatAttachmentBlobsByScope,
  getChatAttachmentBlobRecord,
  pruneChatAttachmentBlobs,
  storeChatAttachmentBlob,
  type StoredChatAttachmentBlob,
} from '@/lib/utils/chat-attachment-blobs';

export type LearnChatAttachmentReference = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width?: number;
  height?: number;
};

export type LearnChatAttachmentSessionScope = {
  ownerId: string;
  courseId: string;
  sessionId: string;
};

export type LearnChatAttachmentContext = LearnChatAttachmentSessionScope & {
  messageId: string;
};

export type LearnChatAttachmentView = LearnChatAttachmentReference & {
  /** Runtime-only URL. Revoke it when the message leaves the UI. */
  objectUrl?: string;
};

export type LoadedLearnChatAttachment = {
  attachment: LearnChatAttachmentReference;
  blob: Blob;
  objectUrl: string;
  context: LearnChatAttachmentContext;
  createdAt: number;
  updatedAt: number;
};

export type PruneLearnChatAttachmentsOptions = {
  ownerId: string;
  courseId?: string;
  sessionId?: string;
  /** Delete records whose last update is strictly older than this timestamp. */
  olderThan: number;
  /** Attachment ids still referenced by current conversation snapshots. */
  keepIds?: Iterable<string>;
};

let persistenceRequest: Promise<void> | null = null;

function requiredText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Missing learn chat attachment ${label}.`);
  return normalized;
}

function normalizePositiveDimension(value: number | undefined): number | undefined {
  return Number.isFinite(value) && value !== undefined && value > 0 ? Math.round(value) : undefined;
}

function normalizeContext(context: LearnChatAttachmentContext): LearnChatAttachmentContext {
  return {
    ownerId: requiredText(context.ownerId, 'owner id'),
    courseId: requiredText(context.courseId, 'course id'),
    sessionId: requiredText(context.sessionId, 'session id'),
    messageId: requiredText(context.messageId, 'message id'),
  };
}

function normalizeSessionScope(
  scope: LearnChatAttachmentSessionScope,
): LearnChatAttachmentSessionScope {
  return {
    ownerId: requiredText(scope.ownerId, 'owner id'),
    courseId: requiredText(scope.courseId, 'course id'),
    sessionId: requiredText(scope.sessionId, 'session id'),
  };
}

function normalizeReference(
  attachment: LearnChatAttachmentReference,
  blob?: Blob,
): LearnChatAttachmentReference {
  const mimeType = requiredText(attachment.mimeType || blob?.type || '', 'MIME type');
  const suppliedSize = attachment.size;
  const size =
    Number.isFinite(suppliedSize) && suppliedSize >= 0 ? suppliedSize : (blob?.size ?? 0);
  return {
    id: requiredText(attachment.id, 'id'),
    name: attachment.name.trim() || '附件',
    mimeType,
    size,
    width: normalizePositiveDimension(attachment.width),
    height: normalizePositiveDimension(attachment.height),
  };
}

function recordMatchesContext(
  record: StoredChatAttachmentBlob,
  context: LearnChatAttachmentContext,
): boolean {
  return (
    record.ownerId === context.ownerId &&
    record.courseId === context.courseId &&
    record.sessionId === context.sessionId &&
    record.messageId === context.messageId
  );
}

function recordMatchesOwnerCourse(
  record: StoredChatAttachmentBlob,
  context: LearnChatAttachmentContext,
): boolean {
  return record.ownerId === context.ownerId && record.courseId === context.courseId;
}

function referenceFromRecord(record: StoredChatAttachmentBlob): LearnChatAttachmentReference {
  return normalizeReference(
    {
      id: record.id,
      name: record.name || '附件',
      mimeType: record.mimeType || record.blob.type || 'application/octet-stream',
      size:
        Number.isFinite(record.size) && record.size !== undefined ? record.size : record.blob.size,
      width: record.width,
      height: record.height,
    },
    record.blob,
  );
}

function contextFromRecord(record: StoredChatAttachmentBlob): LearnChatAttachmentContext | null {
  if (!record.ownerId || !record.courseId || !record.sessionId || !record.messageId) return null;
  return {
    ownerId: record.ownerId,
    courseId: record.courseId,
    sessionId: record.sessionId,
    messageId: record.messageId,
  };
}

function requestPersistentBrowserStorage(): Promise<void> {
  if (persistenceRequest) return persistenceRequest;
  persistenceRequest = (async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return;
    try {
      await navigator.storage.persist();
    } catch {
      // Normal IndexedDB durability remains available when stronger persistence is denied.
    }
  })();
  return persistenceRequest;
}

function createAttachmentObjectUrl(blob: Blob): string {
  if (typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
    throw new Error('Object URLs are unavailable in this browser context.');
  }
  return URL.createObjectURL(blob);
}

/**
 * Convert the current /learn in-memory data URL into a Blob before persistence.
 * The returned Blob belongs in IndexedDB; the data URL must not enter conversation JSON.
 */
export function learnChatAttachmentDataUrlToBlob(dataUrl: string): Blob {
  const separator = dataUrl.indexOf(',');
  if (separator <= 0 || !dataUrl.startsWith('data:')) {
    throw new Error('Invalid learn chat attachment data URL.');
  }
  const header = dataUrl.slice(5, separator);
  const payload = dataUrl.slice(separator + 1);
  const headerParts = header.split(';');
  const mimeType = headerParts[0] || 'application/octet-stream';
  if (headerParts.includes('base64')) {
    if (typeof atob !== 'function') {
      throw new Error('Base64 decoding is unavailable in this browser context.');
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type: mimeType });
  }

  return new Blob([decodeURIComponent(payload)], { type: mimeType });
}

/**
 * Recreate a transport-only data URL when a restored attachment must be sent to a model again.
 * Callers must keep the result in memory and exclude it from conversation persistence payloads.
 */
export function learnChatAttachmentBlobToDataUrl(blob: Blob): Promise<string> {
  if (typeof Blob === 'undefined' || !(blob instanceof Blob) || blob.size <= 0) {
    return Promise.reject(new Error('Learn chat attachment must be a non-empty Blob.'));
  }
  if (typeof FileReader === 'undefined') {
    return Promise.reject(new Error('FileReader is unavailable in this browser context.'));
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('Failed to encode learn chat attachment.'));
    reader.onerror = () =>
      reject(reader.error || new Error('Failed to encode learn chat attachment.'));
    reader.onabort = () => reject(new Error('Learn chat attachment encoding was aborted.'));
    reader.readAsDataURL(blob);
  });
}

/**
 * Save binary attachment content under its remote-safe attachment id.
 * Only the returned reference should be included in PostgreSQL conversation JSON.
 */
export async function saveLearnChatAttachment(args: {
  context: LearnChatAttachmentContext;
  attachment: LearnChatAttachmentReference;
  blob: Blob;
}): Promise<LearnChatAttachmentReference> {
  if (typeof Blob === 'undefined' || !(args.blob instanceof Blob) || args.blob.size <= 0) {
    throw new Error('Learn chat attachment image is empty.');
  }
  const context = normalizeContext(args.context);
  const attachment = normalizeReference(args.attachment, args.blob);
  await requestPersistentBrowserStorage();
  await storeChatAttachmentBlob(attachment.id, args.blob, {
    ...context,
    name: attachment.name,
    mimeType: attachment.mimeType,
    size: attachment.size,
    width: attachment.width,
    height: attachment.height,
  });
  return attachment;
}

export async function saveLearnChatAttachmentDataUrl(args: {
  context: LearnChatAttachmentContext;
  attachment: LearnChatAttachmentReference;
  dataUrl: string;
}): Promise<LearnChatAttachmentReference> {
  return saveLearnChatAttachment({
    context: args.context,
    attachment: args.attachment,
    blob: learnChatAttachmentDataUrlToBlob(args.dataUrl),
  });
}

/**
 * Read one image only when its local ownership/course/session/message scope matches.
 */
export async function readLearnChatAttachment(args: {
  id: string;
  context: LearnChatAttachmentContext;
}): Promise<LoadedLearnChatAttachment | null> {
  const id = requiredText(args.id, 'id');
  const context = normalizeContext(args.context);
  const record = await getChatAttachmentBlobRecord(id);
  if (!record || !recordMatchesOwnerCourse(record, context)) return null;
  // Remote reconciliation can preserve the attachment reference while rebasing a
  // local session/message id. The random attachment id plus owner/course scope is
  // still sufficient to recover the same user's binary without crossing courses.
  const exactContextMatch = recordMatchesContext(record, context);
  const storedContext = contextFromRecord(record);
  if (!storedContext) return null;
  return {
    attachment: referenceFromRecord(record),
    blob: record.blob,
    objectUrl: createAttachmentObjectUrl(record.blob),
    context: exactContextMatch ? context : storedContext,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/**
 * Add runtime-only object URLs to remote-safe references after a conversation is restored.
 * Missing/evicted records remain visible as metadata without a broken synthetic URL.
 */
export async function hydrateLearnChatAttachments(args: {
  context: LearnChatAttachmentContext;
  attachments: LearnChatAttachmentReference[];
}): Promise<LearnChatAttachmentView[]> {
  const context = normalizeContext(args.context);
  return Promise.all(
    args.attachments.map(async (attachment) => {
      const reference = normalizeReference(attachment);
      const loaded = await readLearnChatAttachment({ id: reference.id, context });
      return loaded ? { ...reference, objectUrl: loaded.objectUrl } : reference;
    }),
  );
}

export function revokeLearnChatAttachmentUrls(
  attachments: Iterable<Pick<LearnChatAttachmentView, 'objectUrl'>>,
): void {
  if (typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  for (const attachment of attachments) {
    if (attachment.objectUrl) URL.revokeObjectURL(attachment.objectUrl);
  }
}

/**
 * Delete one attachment only if the caller owns the exact conversation message scope.
 */
export async function deleteLearnChatAttachment(args: {
  id: string;
  context: LearnChatAttachmentContext;
}): Promise<boolean> {
  const id = requiredText(args.id, 'id');
  const context = normalizeContext(args.context);
  const record = await getChatAttachmentBlobRecord(id);
  if (!record || !recordMatchesContext(record, context)) return false;
  await deleteChatAttachmentBlob(id);
  return true;
}

export async function clearLearnChatMessageAttachments(
  context: LearnChatAttachmentContext,
): Promise<number> {
  return deleteChatAttachmentBlobsByScope(normalizeContext(context));
}

export async function clearLearnChatSessionAttachments(
  scope: LearnChatAttachmentSessionScope,
): Promise<number> {
  return deleteChatAttachmentBlobsByScope(normalizeSessionScope(scope));
}

export async function pruneLearnChatAttachments(
  options: PruneLearnChatAttachmentsOptions,
): Promise<number> {
  const ownerId = requiredText(options.ownerId, 'owner id');
  if (!Number.isFinite(options.olderThan)) {
    throw new Error('Missing learn chat attachment cleanup cutoff.');
  }
  return pruneChatAttachmentBlobs({
    before: options.olderThan,
    ownerId,
    courseId: options.courseId?.trim() || undefined,
    sessionId: options.sessionId?.trim() || undefined,
    excludeIds: options.keepIds,
  });
}
