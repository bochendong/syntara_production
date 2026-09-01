import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { toPrismaJson } from '@/lib/server/prisma-json';
import { requireTeacher } from '@/lib/server/teacher-auth';

export const runtime = 'nodejs';
export const maxDuration = 60;

function jsonRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ courseId: string; sourceId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher({ refreshSpeedupAccess: false });
    if ('response' in teacher) return teacher.response;
    const { courseId, sourceId } = await context.params;
    const [course, source] = await Promise.all([
      prisma.course.findFirst({
        where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
        select: { id: true },
      }),
      prisma.courseSource.findFirst({
        where: { id: sourceId, courseId, ownerId: teacher.userId, kind: 'teacher_upload' },
      }),
    ]);
    if (!course || !source) {
      return NextResponse.json({ error: '课程或上传任务不存在。' }, { status: 404 });
    }
    if (source.ingestStatus !== 'uploading' || !source.fileData) {
      return NextResponse.json({ error: '文件上传状态无效。' }, { status: 409 });
    }
    const metadata = jsonRecord(source.metadataJson);
    const uploadedBytes = Buffer.from(source.fileData).byteLength;
    const declaredUploadedBytes = metadata.uploadedBytes;
    if (
      uploadedBytes !== source.fileSize ||
      (typeof declaredUploadedBytes === 'number' && declaredUploadedBytes !== source.fileSize)
    ) {
      return NextResponse.json(
        { error: `文件尚未上传完整（${uploadedBytes}/${source.fileSize} bytes）。` },
        { status: 409 },
      );
    }

    const sourceHash = createHash('sha256').update(Buffer.from(source.fileData)).digest('hex');
    const existing = await prisma.courseSource.findUnique({
      where: { courseId_sourceHash: { courseId, sourceHash } },
    });
    const finalized = await prisma.$transaction(async (tx) => {
      if (existing && existing.id !== source.id) {
        if (existing.ownerId !== teacher.userId) {
          throw new Error('Source belongs to another user');
        }
        const restored = await tx.courseSource.update({
          where: { id: existing.id },
          data: {
            title: source.title,
            fileMime: source.fileMime,
            fileData: source.fileData,
            fileSize: source.fileSize,
            sourceCategory: source.sourceCategory,
            openaiFileId: null,
            removedAt: null,
            ingestStatus: 'uploaded',
            indexStatus: 'pending',
            errorReason: null,
            metadataJson: toPrismaJson({
              sourceCategory: source.sourceCategory,
              size: source.fileSize,
              openaiFileIds: [],
            }),
          },
          select: { id: true },
        });
        await tx.courseSource.delete({ where: { id: source.id } });
        return { id: restored.id, deduplicated: true };
      }
      const completed = await tx.courseSource.update({
        where: { id: source.id },
        data: {
          sourceHash,
          ingestStatus: 'uploaded',
          indexStatus: 'pending',
          errorReason: null,
          metadataJson: toPrismaJson({
            sourceCategory: source.sourceCategory,
            size: source.fileSize,
            openaiFileIds: [],
          }),
        },
        select: { id: true },
      });
      return { id: completed.id, deduplicated: false };
    });

    return NextResponse.json({
      ok: true,
      sourceId: finalized.id,
      deduplicated: finalized.deduplicated,
      saved: true,
    });
  });
}
