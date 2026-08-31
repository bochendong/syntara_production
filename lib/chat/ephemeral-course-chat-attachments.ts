'use client';

import type { CourseChatImageAttachment } from '@/lib/chat/ask-course-orchestrator';
import { backendJson } from '@/lib/utils/backend-api';
import { learnChatAttachmentDataUrlToBlob } from '@/lib/utils/learn-chat-attachment-storage';
import { uploadFileToOpenAI } from '@/lib/uploads/openai-file-upload-client';

export type PreparedCourseChatAttachments = {
  attachments: CourseChatImageAttachment[];
  cleanupTokens: string[];
};

async function uploadModelFile(
  attachment: CourseChatImageAttachment,
  signal?: AbortSignal,
): Promise<{ fileId: string; cleanupToken: string }> {
  const blob = attachment.browserFile
    ? attachment.browserFile
    : attachment.dataUrl
      ? learnChatAttachmentDataUrlToBlob(attachment.dataUrl)
      : null;
  if (!blob) throw new Error(`${attachment.name} 的本地文件内容不可用。`);
  const uploaded = await uploadFileToOpenAI({
    file:
      blob instanceof File
        ? blob
        : new File([blob], attachment.name || 'attachment', {
            type: attachment.mimeType || 'application/octet-stream',
          }),
    intent: 'chat_attachment',
    signal,
  });
  if (!uploaded.cleanupToken) throw new Error('聊天附件清理凭证签发失败。');
  return { fileId: uploaded.fileId, cleanupToken: uploaded.cleanupToken };
}

export async function prepareCourseChatAttachmentsForModel(
  attachments: CourseChatImageAttachment[],
  options: { signal?: AbortSignal } = {},
): Promise<PreparedCourseChatAttachments> {
  const prepared: CourseChatImageAttachment[] = [];
  const cleanupTokens: string[] = [];
  try {
    for (const attachment of attachments) {
      const mimeType = attachment.mimeType.toLowerCase();
      if (mimeType.startsWith('image/')) {
        if (!attachment.dataUrl) throw new Error(`${attachment.name} 的图片内容不可用。`);
        prepared.push(attachment);
        continue;
      }
      const uploaded = await uploadModelFile(attachment, options.signal);
      cleanupTokens.push(uploaded.cleanupToken);
      prepared.push({
        ...attachment,
        browserFile: undefined,
        dataUrl: undefined,
        modelUrl: uploaded.fileId,
      });
    }
    return { attachments: prepared, cleanupTokens };
  } catch (error) {
    await cleanupCourseChatAttachments(cleanupTokens);
    throw error;
  }
}

export async function cleanupCourseChatAttachments(cleanupTokens: string[]): Promise<void> {
  const uniqueTokens = Array.from(new Set(cleanupTokens.filter(Boolean)));
  if (!uniqueTokens.length) return;
  await Promise.allSettled(
    uniqueTokens.map((cleanupToken) =>
      backendJson<{ deleted: boolean }>('/api/chat/attachments', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleanupToken }),
        timeoutMs: 20_000,
      }),
    ),
  );
}
