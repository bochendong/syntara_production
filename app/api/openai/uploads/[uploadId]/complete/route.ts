import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { issueEphemeralChatFileToken } from '@/lib/server/ephemeral-chat-file-token';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  issueOpenAIFileCapability,
  verifyOpenAIUploadCapability,
} from '@/lib/server/openai-upload-capability';
import {
  completeOpenAIUserUpload,
  OPENAI_BROWSER_UPLOAD_PART_BYTES,
} from '@/lib/server/openai-user-files';

export const runtime = 'nodejs';

const completeSchema = z.object({
  uploadToken: z.string().trim().min(1),
  partIds: z
    .array(
      z
        .string()
        .trim()
        .regex(/^part_[A-Za-z0-9_-]+$/),
    )
    .min(1)
    .max(20),
});

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ uploadId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { uploadId } = await context.params;
    const payload = completeSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json({ error: '完成上传参数无效。' }, { status: 400 });
    }
    const capability = verifyOpenAIUploadCapability({
      token: payload.data.uploadToken,
      userId: auth.userId,
      uploadId,
    });
    if (!capability) {
      return NextResponse.json({ error: '上传凭证无效或已过期。' }, { status: 403 });
    }
    const expectedPartCount = Math.ceil(capability.bytes / OPENAI_BROWSER_UPLOAD_PART_BYTES);
    if (payload.data.partIds.length !== expectedPartCount) {
      return NextResponse.json({ error: '上传分片数量不完整。' }, { status: 400 });
    }
    if (new Set(payload.data.partIds).size !== payload.data.partIds.length) {
      return NextResponse.json({ error: '上传分片列表包含重复项。' }, { status: 400 });
    }
    const fileId = await completeOpenAIUserUpload({
      uploadId,
      partIds: payload.data.partIds,
    });
    const fileToken = issueOpenAIFileCapability({
      userId: auth.userId,
      fileId,
      fileName: capability.fileName,
      mimeType: capability.mimeType,
      bytes: capability.bytes,
      intent: capability.intent,
    });
    if (!fileToken) {
      return NextResponse.json({ error: '无法签发文件凭证。' }, { status: 500 });
    }
    const cleanupToken =
      capability.intent === 'chat_attachment'
        ? issueEphemeralChatFileToken({ userId: auth.userId, fileId })
        : null;
    return NextResponse.json({
      fileId,
      fileToken,
      cleanupToken,
      fileName: capability.fileName,
      mimeType: capability.mimeType,
      bytes: capability.bytes,
    });
  });
}
