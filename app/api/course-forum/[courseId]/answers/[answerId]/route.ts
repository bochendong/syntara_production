import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireCourseForumAccess } from '@/features/course-forum/server/course-forum-access';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ courseId: string; answerId: string }> },
) {
  return safeRoute(async () => {
    const { courseId, answerId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;
    if (!access.isTeacher) {
      return NextResponse.json({ error: '只有任课老师可以删除解答' }, { status: 403 });
    }

    const answer = await prisma.courseForumAnswer.findFirst({
      where: { id: answerId, post: { courseId } },
      select: { id: true, postId: true, acceptedAt: true },
    });
    if (!answer) return NextResponse.json({ error: '解答不存在' }, { status: 404 });

    const now = new Date();
    await prisma.$transaction([
      prisma.courseForumAnswer.delete({ where: { id: answer.id } }),
      prisma.courseForumPost.update({
        where: { id: answer.postId },
        data: {
          ...(answer.acceptedAt ? { resolvedAt: null } : {}),
          updatedAt: now,
        },
        select: { id: true },
      }),
    ]);
    return NextResponse.json({ ok: true });
  });
}
