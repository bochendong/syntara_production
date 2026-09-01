import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { toPrismaJson } from '@/lib/server/prisma-json';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import {
  COURSE_SOURCE_MAX_FILE_BYTES,
  courseSourceFileValidationError,
  normalizedCourseSourceMimeType,
} from '@/lib/uploads/course-source-policy';
import { verifyOpenAIFileCapability } from '@/lib/server/openai-upload-capability';
import { downloadOpenAIUserFile } from '@/lib/server/openai-user-files';

export const runtime = 'nodejs';
export const maxDuration = 300;

const categorySchema = z.enum([
  'school_teacher_notes',
  'crash_course_teacher_notes',
  'problem_bank',
]);

const stagedSourceSchema = z.object({
  stagedFileToken: z.string().trim().min(1),
  sourceCategory: categorySchema,
});

export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
      select: { id: true },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const contentType = request.headers.get('content-type') || '';
    let file: File;
    let sourceCategory: z.infer<typeof categorySchema>;
    let stagedOpenAIFileId: string | null = null;
    if (contentType.includes('application/json')) {
      const stagedPayload = stagedSourceSchema.safeParse(await request.json().catch(() => null));
      if (!stagedPayload.success) {
        return NextResponse.json({ error: '源文件上传参数无效' }, { status: 400 });
      }
      const capability = verifyOpenAIFileCapability({
        token: stagedPayload.data.stagedFileToken,
        userId: teacher.userId,
        intents: ['teacher_source', 'problem_bank_source'],
      });
      if (!capability) {
        return NextResponse.json({ error: '文件凭证无效或已过期。' }, { status: 403 });
      }
      const expectedIntent =
        stagedPayload.data.sourceCategory === 'problem_bank'
          ? 'problem_bank_source'
          : 'teacher_source';
      if (capability.intent !== expectedIntent) {
        return NextResponse.json({ error: '文件上传用途与资料分类不一致。' }, { status: 409 });
      }
      let buffer: Buffer;
      try {
        buffer = await downloadOpenAIUserFile(capability.fileId);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'OpenAI 文件读取失败。';
        return NextResponse.json(
          { error: message, retryable: true },
          { status: 502, headers: { 'Retry-After': '2' } },
        );
      }
      if (buffer.byteLength !== capability.bytes) {
        return NextResponse.json({ error: 'OpenAI 文件大小与上传凭证不一致。' }, { status: 409 });
      }
      file = new File([new Uint8Array(buffer)], capability.fileName, {
        type: capability.mimeType,
      });
      sourceCategory = stagedPayload.data.sourceCategory;
      stagedOpenAIFileId = capability.fileId;
    } else {
      const formData = await request.formData();
      const candidate = formData.get('file');
      if (!(candidate instanceof File)) {
        return NextResponse.json({ error: 'Missing source file' }, { status: 400 });
      }
      file = candidate;
      const category = categorySchema.safeParse(formData.get('sourceCategory'));
      if (!category.success) {
        return NextResponse.json({ error: '源文件分类无效' }, { status: 400 });
      }
      sourceCategory = category.data;
    }
    const validationError = courseSourceFileValidationError(file);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: file.size <= 0 ? 400 : file.size > COURSE_SOURCE_MAX_FILE_BYTES ? 413 : 415 },
      );
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    const normalizedMimeType = normalizedCourseSourceMimeType(file);
    const sourceHash = createHash('sha256').update(buffer).digest('hex');
    const existing = await prisma.courseSource.findUnique({
      where: { courseId_sourceHash: { courseId, sourceHash } },
      select: { id: true, ownerId: true },
    });
    if (existing && existing.ownerId !== teacher.userId) {
      return NextResponse.json({ error: 'Source belongs to another user' }, { status: 403 });
    }
    const source = await prisma.courseSource.upsert({
      where: { courseId_sourceHash: { courseId, sourceHash } },
      create: {
        ownerId: teacher.userId,
        courseId,
        sourceHash,
        title: file.name,
        kind: 'teacher_upload',
        fileMime: normalizedMimeType,
        fileData: buffer,
        fileSize: file.size,
        sourceCategory,
        openaiFileId: stagedOpenAIFileId,
        ingestStatus: 'uploaded',
        indexStatus: 'pending',
        metadataJson: toPrismaJson({
          sourceCategory,
          size: file.size,
          openaiFileIds: stagedOpenAIFileId ? [stagedOpenAIFileId] : [],
        }),
      },
      update: {
        title: file.name,
        fileMime: normalizedMimeType,
        fileData: buffer,
        fileSize: file.size,
        sourceCategory,
        openaiFileId: stagedOpenAIFileId,
        removedAt: null,
        ingestStatus: 'uploaded',
        indexStatus: 'pending',
        errorReason: null,
        metadataJson: toPrismaJson({
          sourceCategory,
          size: file.size,
          openaiFileIds: stagedOpenAIFileId ? [stagedOpenAIFileId] : [],
        }),
      },
    });
    return NextResponse.json({ ok: true, sourceId: source.id }, { status: 201 });
  });
}
