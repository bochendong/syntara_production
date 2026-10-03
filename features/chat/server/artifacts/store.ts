/**
 * Persistence for files the course chat assistant generates.
 *
 * Files live in the shared `Asset` table with
 *   path   = chat-artifacts/{courseId}/{userId}/{assetId}/{fileName}
 *   source = 'chat-artifact'
 * so ownership can be checked from the path without a schema change.
 */
import { createHash, randomUUID } from 'node:crypto';

import type { PrismaClient } from '@/lib/server/generated-prisma';
import type { ChatFileArtifact } from '@/lib/types/chat';

export const CHAT_ARTIFACT_SOURCE = 'chat-artifact';
export const CHAT_ARTIFACT_PATH_PREFIX = 'chat-artifacts';
export const CHAT_ARTIFACT_MAX_BYTES = 15 * 1024 * 1024;

export type ChatArtifactFileKind = ChatFileArtifact['fileKind'];

export type ChatArtifactDb = Pick<PrismaClient, 'asset' | 'course'>;

const EXTENSION_BY_MIME: Record<string, string> = {
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const ALLOWED_MIME_BY_KIND: Record<ChatArtifactFileKind, string[]> = {
  docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  pdf: ['application/pdf'],
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Make a download-safe file name: strips path separators, control and
 * reserved characters, keeps Chinese and other letters, and forces the
 * extension that matches the MIME type.
 */
export function sanitizeChatArtifactFileName(name: string, mimeType: string): string {
  const extension = EXTENSION_BY_MIME[mimeType] ?? 'bin';
  const withoutExtension = name
    .normalize('NFC')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[\x00-\x1f\x7f]/g, '')
    .replace(/[\\/:*?"<>|#%{}^~[\]`]+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[.\s-]+|[.\s]+$/g, '');
  const truncated = Array.from(withoutExtension).slice(0, 80).join('').trim();
  return `${truncated || 'syntara-file'}.${extension}`;
}

export function chatArtifactPath(
  courseId: string,
  userId: string,
  assetId: string,
  fileName: string,
): string {
  return `${CHAT_ARTIFACT_PATH_PREFIX}/${courseId}/${userId}/${assetId}/${fileName}`;
}

/** Parse `chat-artifacts/{courseId}/{userId}/{assetId}/{fileName}`. */
export function parseChatArtifactPath(
  path: string,
): { courseId: string; userId: string; assetId: string; fileName: string } | null {
  const parts = path.split('/');
  if (parts.length < 5 || parts[0] !== CHAT_ARTIFACT_PATH_PREFIX) return null;
  const [, courseId, userId, assetId, ...rest] = parts;
  const fileName = rest.join('/');
  if (!courseId || !userId || !assetId || !fileName) return null;
  return { courseId, userId, assetId, fileName };
}

export function chatArtifactUrls(
  courseId: string,
  assetId: string,
  fileKind: ChatArtifactFileKind,
): { url: string; previewUrl?: string } {
  const base = `/api/courses/${encodeURIComponent(courseId)}/chat-artifacts/${encodeURIComponent(assetId)}`;
  return {
    url: `${base}?download=1`,
    previewUrl: fileKind === 'docx' ? undefined : base,
  };
}

function titleFromFileName(fileName: string): string {
  return fileName.replace(/\.[A-Za-z0-9]{1,5}$/, '');
}

function toArtifact(args: {
  courseId: string;
  assetId: string;
  fileKind: ChatArtifactFileKind;
  title: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}): ChatFileArtifact {
  const urls = chatArtifactUrls(args.courseId, args.assetId, args.fileKind);
  return {
    kind: 'chat_file',
    id: args.assetId,
    fileKind: args.fileKind,
    title: args.title,
    fileName: args.fileName,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
    url: urls.url,
    ...(urls.previewUrl ? { previewUrl: urls.previewUrl } : {}),
    createdAt: args.createdAt.toISOString(),
  };
}

function fileKindForMime(mimeType: string): ChatArtifactFileKind | null {
  for (const [kind, mimes] of Object.entries(ALLOWED_MIME_BY_KIND)) {
    if (mimes.includes(mimeType)) return kind as ChatArtifactFileKind;
  }
  return null;
}

export async function saveChatArtifact(args: {
  db: ChatArtifactDb;
  courseId: string;
  userId: string;
  fileKind: ChatArtifactFileKind;
  title: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
}): Promise<ChatFileArtifact> {
  if (!SAFE_ID.test(args.courseId) || !SAFE_ID.test(args.userId)) {
    throw new Error('Invalid course or user id for chat artifact.');
  }
  if (!ALLOWED_MIME_BY_KIND[args.fileKind]?.includes(args.mimeType)) {
    throw new Error(`Unsupported chat artifact type: ${args.fileKind} / ${args.mimeType}`);
  }
  if (!args.buffer.byteLength) throw new Error('生成的文件为空。');
  if (args.buffer.byteLength > CHAT_ARTIFACT_MAX_BYTES) {
    throw new Error(
      `生成的文件过大（${(args.buffer.byteLength / 1024 / 1024).toFixed(1)} MB），上限为 15 MB。请缩短内容或减少图片后重试。`,
    );
  }
  const assetId = `ca${randomUUID().replace(/-/g, '')}`;
  const fileName = sanitizeChatArtifactFileName(args.fileName || args.title, args.mimeType);
  const title = args.title.trim().slice(0, 120) || titleFromFileName(fileName);
  const sha256 = createHash('sha256').update(args.buffer).digest('hex');
  const created = await args.db.asset.create({
    data: {
      id: assetId,
      path: chatArtifactPath(args.courseId, args.userId, assetId, fileName),
      mimeType: args.mimeType,
      sizeBytes: args.buffer.byteLength,
      sha256,
      source: CHAT_ARTIFACT_SOURCE,
      data: Uint8Array.from(args.buffer),
    },
    select: { id: true, createdAt: true },
  });
  return toArtifact({
    courseId: args.courseId,
    assetId: created.id,
    fileKind: args.fileKind,
    title,
    fileName,
    mimeType: args.mimeType,
    sizeBytes: args.buffer.byteLength,
    createdAt: created.createdAt,
  });
}

export type LoadedChatArtifact = { artifact: ChatFileArtifact; data: Buffer; ownerUserId: string };

/**
 * Load a chat artifact if the requester created it, or owns the course it was
 * created in. Returns null for anything else (including other courses).
 */
export async function loadChatArtifactForUser(args: {
  db: ChatArtifactDb;
  courseId: string;
  artifactId: string;
  userId: string;
}): Promise<LoadedChatArtifact | null> {
  if (!SAFE_ID.test(args.artifactId) || !SAFE_ID.test(args.courseId)) return null;
  const asset = await args.db.asset.findUnique({
    where: { id: args.artifactId },
    select: {
      id: true,
      path: true,
      mimeType: true,
      sizeBytes: true,
      source: true,
      data: true,
      createdAt: true,
    },
  });
  if (!asset || asset.source !== CHAT_ARTIFACT_SOURCE || !asset.data) return null;
  const parsed = parseChatArtifactPath(asset.path);
  if (!parsed || parsed.courseId !== args.courseId || parsed.assetId !== asset.id) return null;
  if (parsed.userId !== args.userId) {
    const course = await args.db.course.findUnique({
      where: { id: args.courseId },
      select: { ownerId: true },
    });
    if (!course || course.ownerId !== args.userId) return null;
  }
  const fileKind = fileKindForMime(asset.mimeType);
  if (!fileKind) return null;
  return {
    artifact: toArtifact({
      courseId: args.courseId,
      assetId: asset.id,
      fileKind,
      title: titleFromFileName(parsed.fileName),
      fileName: parsed.fileName,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      createdAt: asset.createdAt,
    }),
    data: Buffer.from(asset.data),
    ownerUserId: parsed.userId,
  };
}
