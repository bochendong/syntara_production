import { Prisma } from '@prisma/client';
import { NextResponse } from 'next/server';

import { COURSE_SOURCE_BROWSER_UPLOAD_PART_BYTES } from '@/lib/uploads/course-source-policy';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';

export const runtime = 'nodejs';

function jsonRecord(value: Prisma.JsonValue | null): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function uploadedPartCount(value: Prisma.JsonValue | null): number {
  const count = jsonRecord(value).uploadedPartCount;
  return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : 0;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ courseId: string; sourceId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher({ refreshSpeedupAccess: false });
    if ('response' in teacher) return teacher.response;
    const { courseId, sourceId } = await context.params;
    const partIndex = Number(request.headers.get('x-part-index'));
    if (!Number.isInteger(partIndex) || partIndex < 0) {
      return NextResponse.json({ error: '文件分片序号无效。' }, { status: 400 });
    }
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > COURSE_SOURCE_BROWSER_UPLOAD_PART_BYTES) {
      return NextResponse.json({ error: '文件分片过大。' }, { status: 413 });
    }

    const [course, source] = await Promise.all([
      prisma.course.findFirst({
        where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
        select: { id: true },
      }),
      prisma.courseSource.findFirst({
        where: { id: sourceId, courseId, ownerId: teacher.userId, kind: 'teacher_upload' },
        select: { id: true, fileSize: true, ingestStatus: true, metadataJson: true },
      }),
    ]);
    if (!course || !source) {
      return NextResponse.json({ error: '课程或上传任务不存在。' }, { status: 404 });
    }
    if (source.ingestStatus !== 'uploading') {
      return NextResponse.json({ error: '该文件上传已经结束。' }, { status: 409 });
    }
    const partCount = Math.ceil(source.fileSize / COURSE_SOURCE_BROWSER_UPLOAD_PART_BYTES);
    if (partIndex >= partCount) {
      return NextResponse.json({ error: '文件分片序号超出范围。' }, { status: 400 });
    }
    const currentPartCount = uploadedPartCount(source.metadataJson);
    if (currentPartCount > partIndex) {
      return NextResponse.json({ ok: true, duplicate: true, partIndex });
    }
    if (currentPartCount !== partIndex) {
      return NextResponse.json({ error: '文件分片顺序不正确，请重新上传。' }, { status: 409 });
    }

    const chunk = Buffer.from(await request.arrayBuffer());
    const expectedLength = Math.min(
      COURSE_SOURCE_BROWSER_UPLOAD_PART_BYTES,
      source.fileSize - partIndex * COURSE_SOURCE_BROWSER_UPLOAD_PART_BYTES,
    );
    if (chunk.byteLength !== expectedLength) {
      return NextResponse.json(
        { error: `文件分片大小不完整（应为 ${expectedLength} bytes）。` },
        { status: 400 },
      );
    }

    const rows = await prisma.$queryRaw<
      Array<{ uploadedBytes: number; uploadedPartCount: number }>
    >(Prisma.sql`
      UPDATE "CourseSource"
      SET
        "fileData" = COALESCE("fileData", ${Buffer.alloc(0)}) || ${chunk},
        "metadataJson" = jsonb_set(
          jsonb_set(
            COALESCE("metadataJson", '{}'::jsonb),
            '{uploadedBytes}',
            to_jsonb((COALESCE(octet_length("fileData"), 0) + ${chunk.byteLength})::integer),
            true
          ),
          '{uploadedPartCount}',
          to_jsonb(${partIndex + 1}::integer),
          true
        ),
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = ${sourceId}
        AND "courseId" = ${courseId}
        AND "ownerId" = ${teacher.userId}
        AND "ingestStatus" = 'uploading'
        AND COALESCE(("metadataJson"->>'uploadedPartCount')::integer, 0) = ${partIndex}
      RETURNING
        COALESCE(octet_length("fileData"), 0)::integer AS "uploadedBytes",
        COALESCE(("metadataJson"->>'uploadedPartCount')::integer, 0) AS "uploadedPartCount"
    `);
    if (!rows[0]) {
      return NextResponse.json({ error: '文件分片状态已变化，请重新上传。' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, partIndex, ...rows[0] });
  });
}
