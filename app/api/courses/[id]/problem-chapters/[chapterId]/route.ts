import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';

const updateChapterSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .refine((value) => value.name !== undefined || value.description !== undefined);

async function requireOwner(userId: string, courseId: string, chapterId: string) {
  const accessRole = await findCourseAccessRole(prisma, userId, courseId);
  if (accessRole !== 'owner') return null;
  return prisma.courseProblemChapter.findFirst({ where: { id: chapterId, courseId } });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; chapterId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId, chapterId } = await context.params;
    if (!(await requireOwner(auth.userId, courseId, chapterId)))
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });

    const payload = updateChapterSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: '章节名称不能为空，描述最多 2000 字。', details: payload.error.flatten() },
        { status: 400 },
      );
    }
    if (payload.data.name) {
      const duplicate = await prisma.courseProblemChapter.findFirst({
        where: { courseId, name: payload.data.name, id: { not: chapterId } },
        select: { id: true },
      });
      if (duplicate) return NextResponse.json({ error: '已经存在同名章节。' }, { status: 409 });
    }
    const chapter = await prisma.courseProblemChapter.update({
      where: { id: chapterId },
      data: {
        ...(payload.data.name !== undefined ? { name: payload.data.name } : {}),
        ...(payload.data.description !== undefined
          ? { description: payload.data.description || null }
          : {}),
      },
      include: {
        _count: { select: { problems: { where: { status: { not: 'archived' } } } } },
      },
    });
    return NextResponse.json({
      chapter: {
        id: chapter.id,
        name: chapter.name,
        description: chapter.description ?? '',
        position: chapter.position,
        problemCount: chapter._count.problems,
      },
    });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; chapterId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId, chapterId } = await context.params;
    if (!(await requireOwner(auth.userId, courseId, chapterId)))
      return NextResponse.json({ error: 'Chapter not found' }, { status: 404 });
    await prisma.courseProblemChapter.delete({ where: { id: chapterId } });
    return NextResponse.json({ ok: true });
  });
}
