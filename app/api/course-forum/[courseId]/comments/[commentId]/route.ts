import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireCourseForumAccess } from '@/features/course-forum/server/course-forum-access';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ courseId: string; commentId: string }> },
) {
  return safeRoute(async () => {
    const { courseId, commentId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;
    if (!access.isTeacher) {
      return NextResponse.json({ error: '只有任课老师可以删除评论' }, { status: 403 });
    }
    const comment = await prisma.courseForumComment.findFirst({
      where: { id: commentId, post: { courseId } },
      select: { id: true, postId: true },
    });
    if (!comment) return NextResponse.json({ error: '评论不存在' }, { status: 404 });
    await prisma.$transaction([
      prisma.courseForumComment.delete({ where: { id: commentId } }),
      prisma.courseForumPost.update({
        where: { id: comment.postId },
        data: { updatedAt: new Date() },
      }),
    ]);
    return NextResponse.json({ ok: true });
  });
}
