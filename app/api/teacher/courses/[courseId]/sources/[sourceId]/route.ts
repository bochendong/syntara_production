import { NextResponse } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { hasTeacherCourseAccess } from '@/lib/server/external-course-access';

const updateSchema = z.object({ action: z.enum(['remove', 'restore']) });

async function ownedSource(userId: string, courseId: string, sourceId: string) {
  return prisma.courseSource.findFirst({
    where: { id: sourceId, courseId, ownerId: userId },
    select: { id: true, ingestStatus: true },
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ courseId: string; sourceId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, sourceId } = await context.params;
    if (!(await hasTeacherCourseAccess(prisma, teacher.userId, courseId))) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    if (!(await ownedSource(teacher.userId, courseId, sourceId))) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }
    const payload = updateSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
    await prisma.courseSource.update({
      where: { id: sourceId },
      data: { removedAt: payload.data.action === 'remove' ? new Date() : null },
    });
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ courseId: string; sourceId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, sourceId } = await context.params;
    if (!(await hasTeacherCourseAccess(prisma, teacher.userId, courseId))) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const source = await ownedSource(teacher.userId, courseId, sourceId);
    if (!source) {
      return NextResponse.json({ error: 'Source not found' }, { status: 404 });
    }
    if (
      new URL(request.url).searchParams.get('uploadCleanup') === '1' &&
      source.ingestStatus !== 'uploading'
    ) {
      return NextResponse.json(
        { error: '文件已完成上传或已进入处理，不再执行上传清理。' },
        { status: 409 },
      );
    }
    await prisma.$transaction([
      prisma.asset.deleteMany({ where: { path: `/course-source-previews/${sourceId}.pdf` } }),
      prisma.courseSource.delete({ where: { id: sourceId } }),
    ]);
    return NextResponse.json({ ok: true });
  });
}
