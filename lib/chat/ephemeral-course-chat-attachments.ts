'use client';

import type { CourseChatImageAttachment } from '@/lib/chat/ask-course-orchestrator';
import { backendJson } from '@/lib/utils/backend-api';
import { learnChatAttachmentDataUrlToBlob } from '@/lib/utils/learn-chat-attachment-storage';

const MAX_CHAT_TEXT_ATTACHMENT_CHARS = 80_000;
const MAX_CHAT_TEXT_ATTACHMENTS_TOTAL_CHARS = 160_000;

type UploadedEphemeralFile = {
  fileId: string;
  cleanupToken: string;
  expiresInSeconds: number;
};

export type PreparedCourseChatAttachments = {
  attachments: CourseChatImageAttachment[];
  cleanupTokens: string[];
};

function isTextLikeAttachment(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase();
  return (
    normalized.startsWith('text/') ||
    normalized === 'application/json' ||
    normalized === 'application/xml'
  );
}

async function uploadPdf(
  attachment: CourseChatImageAttachment,
  signal?: AbortSignal,
): Promise<UploadedEphemeralFile> {
  if (!attachment.dataUrl) throw new Error(`${attachment.name} 的本地文件内容不可用。`);
  const blob = learnChatAttachmentDataUrlToBlob(attachment.dataUrl);
  const formData = new FormData();
  formData.append(
    'file',
    new File([blob], attachment.name || 'attachment.pdf', {
      type: attachment.mimeType || 'application/pdf',
    }),
  );
  return backendJson<UploadedEphemeralFile>('/api/chat/attachments', {
    method: 'POST',
    body: formData,
    signal,
    timeoutMs: 90_000,
  });
}

export async function prepareCourseChatAttachmentsForModel(
  attachments: CourseChatImageAttachment[],
  options: { signal?: AbortSignal } = {},
): Promise<PreparedCourseChatAttachments> {
  const prepared: CourseChatImageAttachment[] = [];
  const cleanupTokens: string[] = [];
  let remainingTextChars = MAX_CHAT_TEXT_ATTACHMENTS_TOTAL_CHARS;
  try {
    for (const attachment of attachments) {
      const mimeType = attachment.mimeType.toLowerCase();
      if (mimeType.startsWith('image/')) {
        if (!attachment.dataUrl) throw new Error(`${attachment.name} 的图片内容不可用。`);
        prepared.push(attachment);
        continue;
      }
      if (mimeType === 'application/pdf') {
        const uploaded = await uploadPdf(attachment, options.signal);
        cleanupTokens.push(uploaded.cleanupToken);
        prepared.push({ ...attachment, dataUrl: undefined, modelUrl: uploaded.fileId });
        continue;
      }
      if (isTextLikeAttachment(mimeType)) {
        if (!attachment.dataUrl) throw new Error(`${attachment.name} 的文本内容不可用。`);
        if (remainingTextChars <= 0) {
          throw new Error('聊天文本附件内容过多，请减少文件数量或缩短内容后重试。');
        }
        const text = await learnChatAttachmentDataUrlToBlob(attachment.dataUrl).text();
        const allowedChars = Math.min(MAX_CHAT_TEXT_ATTACHMENT_CHARS, remainingTextChars);
        const textContent =
          text.length <= allowedChars
            ? text
            : `${text.slice(0, allowedChars)}\n\n[附件内容过长，已截断]`;
        remainingTextChars -= Math.min(text.length, allowedChars);
        prepared.push({
          ...attachment,
          dataUrl: undefined,
          textContent,
        });
        continue;
      }
      throw new Error(`${attachment.name} 暂不支持作为聊天临时附件。`);
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
