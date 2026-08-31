import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  issueOpenAIUploadCapability,
  openAIUploadIntentSchema,
} from '@/lib/server/openai-upload-capability';
import {
  createOpenAIUserUpload,
  OPENAI_BROWSER_UPLOAD_PART_BYTES,
} from '@/lib/server/openai-user-files';
import {
  COURSE_SOURCE_MAX_FILE_BYTES,
  courseSourceFileValidationError,
  normalizedCourseSourceMimeType,
} from '@/lib/uploads/course-source-policy';

export const runtime = 'nodejs';

const createSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().max(160).default('application/octet-stream'),
  bytes: z.number().int().positive().max(COURSE_SOURCE_MAX_FILE_BYTES),
  intent: openAIUploadIntentSchema,
});

function safeFilename(value: string): string {
  return (
    value
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
      .trim() || 'upload.bin'
  ).slice(-240);
}

export async function POST(request: NextRequest) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const payload = createSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json(
        { error: '上传文件信息无效。', details: payload.error.flatten() },
        { status: 400 },
      );
    }
    const fileName = safeFilename(payload.data.fileName);
    const declaredMimeType = payload.data.mimeType || 'application/octet-stream';
    const validationError = courseSourceFileValidationError({
      name: fileName,
      size: payload.data.bytes,
      type: declaredMimeType,
    } as File);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: payload.data.bytes > COURSE_SOURCE_MAX_FILE_BYTES ? 413 : 415 },
      );
    }
    const mimeType = normalizedCourseSourceMimeType({ name: fileName, type: declaredMimeType });
    const uploadId = await createOpenAIUserUpload({
      fileName,
      mimeType,
      bytes: payload.data.bytes,
    });
    const uploadToken = issueOpenAIUploadCapability({
      userId: auth.userId,
      uploadId,
      fileName,
      mimeType,
      bytes: payload.data.bytes,
      intent: payload.data.intent,
    });
    if (!uploadToken) {
      return NextResponse.json({ error: '无法签发上传凭证。' }, { status: 500 });
    }
    return NextResponse.json({
      uploadId,
      uploadToken,
      partSizeBytes: OPENAI_BROWSER_UPLOAD_PART_BYTES,
      partCount: Math.ceil(payload.data.bytes / OPENAI_BROWSER_UPLOAD_PART_BYTES),
    });
  });
}
