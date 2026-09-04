import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';

const createChapterSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).optional().default(''),
});

function toClientChapter(chapter: {
  id: string;
  name: string;
  description: string | null;
  position: number;
  _count: { problems: number };
}) {
  return {
    id: chapter.id,
    name: chapter.name,
    description: chapter.description ?? '',
    position: chapter.position,
    problemCount: chapter._count.problems,
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId } = await context.params;
    const accessRole = await findCourseAccessRole(prisma, auth.userId, courseId);
    if (!accessRole) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const chapters = await prisma.courseProblemChapter.findMany({
      where: { courseId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        _count: { select: { problems: { where: { status: { not: 'archived' } } } } },
      },
    });
    return NextResponse.json({
      chapters: chapters.map(toClientChapter),
      canManage: accessRole === 'owner',
    });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId } = await context.params;
    const accessRole = await findCourseAccessRole(prisma, auth.userId, courseId);
    if (accessRole !== 'owner')
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const payload = createChapterSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: '章节名称不能为空，描述最多 2000 字。', details: payload.error.flatten() },
        { status: 400 },
      );
    }
    const duplicate = await prisma.courseProblemChapter.findFirst({
      where: { courseId, name: payload.data.name },
      select: { id: true },
    });
    if (duplicate) return NextResponse.json({ error: '已经存在同名章节。' }, { status: 409 });

    const last = await prisma.courseProblemChapter.findFirst({
      where: { courseId },
      orderBy: [{ position: 'desc' }, { createdAt: 'desc' }],
      select: { position: true },
    });
    const chapter = await prisma.courseProblemChapter.create({
      data: {
        courseId,
        name: payload.data.name,
        description: payload.data.description || null,
        position: (last?.position ?? -1) + 1,
      },
      include: {
        _count: { select: { problems: { where: { status: { not: 'archived' } } } } },
      },
    });
    return NextResponse.json({ chapter: toClientChapter(chapter) }, { status: 201 });
  });
}
