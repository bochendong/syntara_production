import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { toPrismaJson } from '@/lib/server/prisma-json';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import {
  COURSE_SOURCE_MAX_FILE_BYTES,
  COURSE_SOURCE_BROWSER_UPLOAD_PART_BYTES,
  courseSourceFileValidationError,
  normalizedCourseSourceMimeType,
} from '@/lib/uploads/course-source-policy';

export const runtime = 'nodejs';
export const maxDuration = 300;

const categorySchema = z.enum([
  'school_teacher_notes',
  'crash_course_teacher_notes',
  'problem_bank',
]);

const databaseUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  mimeType: z.string().trim().max(160).default('application/octet-stream'),
  bytes: z.number().int().positive().max(COURSE_SOURCE_MAX_FILE_BYTES),
  sourceCategory: categorySchema,
});

function safeFilename(value: string): string {
  return (
    value
      .normalize('NFKC')
      .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
      .trim() || 'upload.bin'
  ).slice(-240);
}

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
    if (contentType.includes('application/json')) {
      const uploadPayload = databaseUploadSchema.safeParse(await request.json().catch(() => null));
      if (!uploadPayload.success) {
        return NextResponse.json({ error: '源文件上传参数无效' }, { status: 400 });
      }
      const fileName = safeFilename(uploadPayload.data.fileName);
      const fileLike = {
        name: fileName,
        size: uploadPayload.data.bytes,
        type: uploadPayload.data.mimeType,
      };
      const validationError = courseSourceFileValidationError(fileLike);
      if (validationError) {
        return NextResponse.json(
          { error: validationError },
          {
            status: uploadPayload.data.bytes > COURSE_SOURCE_MAX_FILE_BYTES ? 413 : 415,
          },
        );
      }
      const normalizedMimeType = normalizedCourseSourceMimeType(fileLike);
      const source = await prisma.courseSource.create({
        data: {
          ownerId: teacher.userId,
          courseId,
          sourceHash: `pending-upload:${randomUUID()}`,
          title: fileName,
          kind: 'teacher_upload',
          fileMime: normalizedMimeType,
          fileData: Buffer.alloc(0),
          fileSize: uploadPayload.data.bytes,
          sourceCategory: uploadPayload.data.sourceCategory,
          ingestStatus: 'uploading',
          indexStatus: 'pending',
          metadataJson: toPrismaJson({
            sourceCategory: uploadPayload.data.sourceCategory,
            size: uploadPayload.data.bytes,
            uploadedBytes: 0,
            uploadedPartCount: 0,
          }),
        },
        select: { id: true },
      });
      return NextResponse.json(
        {
          ok: true,
          sourceId: source.id,
          partSizeBytes: COURSE_SOURCE_BROWSER_UPLOAD_PART_BYTES,
          partCount: Math.ceil(uploadPayload.data.bytes / COURSE_SOURCE_BROWSER_UPLOAD_PART_BYTES),
        },
        { status: 201 },
      );
    }

    const formData = await request.formData();
    const candidate = formData.get('file');
    if (!(candidate instanceof File)) {
      return NextResponse.json({ error: 'Missing source file' }, { status: 400 });
    }
    const category = categorySchema.safeParse(formData.get('sourceCategory'));
    if (!category.success) {
      return NextResponse.json({ error: '源文件分类无效' }, { status: 400 });
    }
    const validationError = courseSourceFileValidationError(candidate);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        {
          status:
            candidate.size <= 0 ? 400 : candidate.size > COURSE_SOURCE_MAX_FILE_BYTES ? 413 : 415,
        },
      );
    }
    const buffer = Buffer.from(await candidate.arrayBuffer());
    const normalizedMimeType = normalizedCourseSourceMimeType(candidate);
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
        title: candidate.name,
        kind: 'teacher_upload',
        fileMime: normalizedMimeType,
        fileData: buffer,
        fileSize: candidate.size,
        sourceCategory: category.data,
        ingestStatus: 'uploaded',
        indexStatus: 'pending',
        metadataJson: toPrismaJson({
          sourceCategory: category.data,
          size: candidate.size,
          openaiFileIds: [],
        }),
      },
      update: {
        title: candidate.name,
        fileMime: normalizedMimeType,
        fileData: buffer,
        fileSize: candidate.size,
        sourceCategory: category.data,
        openaiFileId: null,
        removedAt: null,
        ingestStatus: 'uploaded',
        indexStatus: 'pending',
        errorReason: null,
        metadataJson: toPrismaJson({
          sourceCategory: category.data,
          size: candidate.size,
          openaiFileIds: [],
        }),
      },
    });
    return NextResponse.json({ ok: true, sourceId: source.id }, { status: 201 });
  });
}
