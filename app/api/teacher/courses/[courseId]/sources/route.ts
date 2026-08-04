import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { toPrismaJson } from '@/lib/server/prisma-json';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const categorySchema = z.enum([
  'school_teacher_notes',
  'crash_course_teacher_notes',
  'problem_bank',
]);

export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ownerId: teacher.userId },
      select: { id: true },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing source file' }, { status: 400 });
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: '源文件必须小于 50MB 且不能为空' }, { status: 413 });
    }
    const parsedCategory = categorySchema.safeParse(formData.get('sourceCategory'));
    if (!parsedCategory.success) {
      return NextResponse.json({ error: '源文件分类无效' }, { status: 400 });
    }
    const buffer = Buffer.from(await file.arrayBuffer());
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
        fileMime: file.type || 'application/octet-stream',
        fileData: buffer,
        fileSize: file.size,
        sourceCategory: parsedCategory.data,
        ingestStatus: 'uploaded',
        indexStatus: 'pending',
        metadataJson: toPrismaJson({ sourceCategory: parsedCategory.data, size: file.size }),
      },
      update: {
        title: file.name,
        fileMime: file.type || 'application/octet-stream',
        fileData: buffer,
        fileSize: file.size,
        sourceCategory: parsedCategory.data,
        removedAt: null,
        ingestStatus: 'uploaded',
        indexStatus: 'pending',
        errorReason: null,
        metadataJson: toPrismaJson({ sourceCategory: parsedCategory.data, size: file.size }),
      },
    });
    return NextResponse.json({ ok: true, sourceId: source.id }, { status: 201 });
  });
}
