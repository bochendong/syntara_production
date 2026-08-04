import { NextRequest, NextResponse } from 'next/server';

import { requireUserId } from '@/lib/server/api-auth';
import {
  issueEphemeralChatFileToken,
  verifyEphemeralChatFileToken,
} from '@/lib/server/ephemeral-chat-file-token';
import { safeRoute } from '@/lib/server/json-error-response';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';

const MAX_EPHEMERAL_CHAT_FILE_BYTES = 4 * 1024 * 1024;
const SUPPORTED_CHAT_FILE_TYPES = new Set(['application/pdf']);

function filesEndpoint(baseUrl: string | undefined, fileId?: string): string {
  const root = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return fileId ? `${root}/files/${encodeURIComponent(fileId)}` : `${root}/files`;
}

function safeFilename(value: string): string {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .trim();
  return (normalized || 'attachment.pdf').slice(-180);
}

async function uploadToOpenAI(args: { file: File; apiKey: string; baseUrl?: string }) {
  const body = new FormData();
  body.append('purpose', 'user_data');
  body.append('file', args.file, args.file.name);
  // Current Files API supports creation-anchored expiration. Explicit deletion
  // remains the primary cleanup path; this protects against a closed tab.
  body.append('expires_after[anchor]', 'created_at');
  body.append('expires_after[seconds]', String(60 * 60));
  return fetch(filesEndpoint(args.baseUrl), {
    method: 'POST',
    headers: { Authorization: `Bearer ${args.apiKey}` },
    body,
    cache: 'no-store',
  });
}

async function deleteFromOpenAI(args: { fileId: string; apiKey: string; baseUrl?: string }) {
  const response = await fetch(filesEndpoint(args.baseUrl, args.fileId), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${args.apiKey}` },
    cache: 'no-store',
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`OpenAI 临时附件删除失败（HTTP ${response.status}）。`);
  }
}

export async function POST(request: NextRequest) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const formData = await request.formData();
    const candidate = formData.get('file');
    if (!(candidate instanceof File)) {
      return NextResponse.json({ error: '请选择聊天附件。' }, { status: 400 });
    }
    const mimeType = candidate.type.toLowerCase();
    if (!SUPPORTED_CHAT_FILE_TYPES.has(mimeType)) {
      return NextResponse.json({ error: '当前临时文件通道仅支持 PDF。' }, { status: 415 });
    }
    if (candidate.size <= 0 || candidate.size > MAX_EPHEMERAL_CHAT_FILE_BYTES) {
      return NextResponse.json({ error: '单个聊天 PDF 需要小于 4 MB。' }, { status: 413 });
    }

    const config = await getSystemLLMRuntimeConfig();
    if (!config.apiKey) {
      return NextResponse.json({ error: '系统 OpenAI API Key 尚未配置。' }, { status: 503 });
    }
    const prefixedFile = new File(
      [candidate],
      `syntara-chat-${Date.now()}-${safeFilename(candidate.name)}`,
      { type: mimeType },
    );
    const upload = await uploadToOpenAI({
      file: prefixedFile,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
    const payload = (await upload.json().catch(() => null)) as {
      id?: unknown;
      error?: { message?: unknown };
    } | null;
    if (!upload.ok || typeof payload?.id !== 'string') {
      const detail =
        typeof payload?.error?.message === 'string' ? `：${payload.error.message}` : '';
      throw new Error(`OpenAI 临时附件上传失败（HTTP ${upload.status}）${detail}`);
    }
    const cleanupToken = issueEphemeralChatFileToken({
      userId: auth.userId,
      fileId: payload.id,
    });
    if (!cleanupToken) {
      await deleteFromOpenAI({
        fileId: payload.id,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      }).catch(() => undefined);
      throw new Error('临时附件清理凭证无法签发。');
    }
    return NextResponse.json({
      fileId: payload.id,
      cleanupToken,
      expiresInSeconds: 60 * 60,
    });
  });
}

export async function DELETE(request: NextRequest) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const body = (await request.json().catch(() => null)) as { cleanupToken?: unknown } | null;
    const cleanupToken = typeof body?.cleanupToken === 'string' ? body.cleanupToken : '';
    const verified = verifyEphemeralChatFileToken({ token: cleanupToken, userId: auth.userId });
    if (!verified) {
      return NextResponse.json({ error: '临时附件清理凭证无效或已过期。' }, { status: 400 });
    }
    const config = await getSystemLLMRuntimeConfig();
    if (!config.apiKey) {
      return NextResponse.json({ error: '系统 OpenAI API Key 尚未配置。' }, { status: 503 });
    }
    await deleteFromOpenAI({
      fileId: verified.fileId,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
    return NextResponse.json({ deleted: true });
  });
}
