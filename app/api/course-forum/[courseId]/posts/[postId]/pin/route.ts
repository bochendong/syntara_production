import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireCourseForumAccess } from '@/features/course-forum/server/course-forum-access';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ courseId: string; postId: string }> },
) {
  return safeRoute(async () => {
    const { courseId, postId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;
    if (!access.isTeacher) {
      return NextResponse.json({ error: '只有任课老师可以置顶或取消置顶帖子' }, { status: 403 });
    }

    const payload = (await request.json().catch(() => null)) as { pinned?: unknown } | null;
    if (typeof payload?.pinned !== 'boolean') {
      return NextResponse.json({ error: 'pinned 必须是布尔值' }, { status: 400 });
    }

    const now = new Date();
    const result = await prisma.courseForumPost.updateMany({
      where: { id: postId, courseId },
      data: payload.pinned
        ? { pinnedAt: now, pinnedById: access.userId }
        : { pinnedAt: null, pinnedById: null },
    });
    if (!result.count) {
      return NextResponse.json({ error: '帖子不存在' }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      pinned: payload.pinned,
      pinnedAt: payload.pinned ? now.toISOString() : null,
    });
  });
}
