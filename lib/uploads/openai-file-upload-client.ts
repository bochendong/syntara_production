'use client';

import { backendFetch, backendJson } from '@/lib/utils/backend-api';
import type { OpenAIUploadIntent } from '@/lib/server/openai-upload-capability';

type UploadSession = {
  uploadId: string;
  uploadToken: string;
  partSizeBytes: number;
  partCount: number;
};

export type StagedOpenAIFile = {
  fileId: string;
  fileToken: string;
  cleanupToken: string | null;
  fileName: string;
  mimeType: string;
  bytes: number;
};

export async function uploadFileToOpenAI(args: {
  file: File;
  intent: OpenAIUploadIntent;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
}): Promise<StagedOpenAIFile> {
  const session = await backendJson<UploadSession>('/api/openai/uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: args.file.name,
      mimeType: args.file.type || 'application/octet-stream',
      bytes: args.file.size,
      intent: args.intent,
    }),
    signal: args.signal,
    timeoutMs: 30_000,
  });

  const partIds: string[] = [];
  try {
    for (let partIndex = 0; partIndex < session.partCount; partIndex += 1) {
      const start = partIndex * session.partSizeBytes;
      const end = Math.min(args.file.size, start + session.partSizeBytes);
      const response = await backendFetch(
        `/api/openai/uploads/${encodeURIComponent(session.uploadId)}/parts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'x-upload-token': session.uploadToken,
            'x-part-index': String(partIndex),
          },
          body: args.file.slice(start, end),
          signal: args.signal,
          timeoutMs: 150_000,
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        partId?: string;
        error?: string;
      } | null;
      if (!response.ok || !payload?.partId) {
        throw new Error(payload?.error || `文件分片 ${partIndex + 1} 上传失败。`);
      }
      partIds.push(payload.partId);
      args.onProgress?.(Math.round(((partIndex + 1) / (session.partCount + 1)) * 100));
    }
    const completed = await backendJson<StagedOpenAIFile>(
      `/api/openai/uploads/${encodeURIComponent(session.uploadId)}/complete`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadToken: session.uploadToken, partIds }),
        signal: args.signal,
        timeoutMs: 150_000,
      },
    );
    args.onProgress?.(100);
    return completed;
  } catch (error) {
    await backendFetch(`/api/openai/uploads/${encodeURIComponent(session.uploadId)}`, {
      method: 'DELETE',
      headers: { 'x-upload-token': session.uploadToken },
      timeoutMs: 20_000,
    }).catch(() => undefined);
    throw error;
  }
}
