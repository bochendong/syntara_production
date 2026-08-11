import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireCourseForumAccess } from '@/features/course-forum/server/course-forum-access';

const commentSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export async function POST(
  request: Request,
  context: { params: Promise<{ courseId: string; postId: string }> },
) {
  return safeRoute(async () => {
    const { courseId, postId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;
    const payload = commentSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: '评论需为 1–2000 个字符' }, { status: 400 });
    }
    const post = await prisma.courseForumPost.findFirst({
      where: { id: postId, courseId },
      select: { id: true },
    });
    if (!post) return NextResponse.json({ error: '帖子不存在' }, { status: 404 });
    const comment = await prisma.courseForumComment.create({
      data: { postId, authorId: access.userId, body: payload.data.body },
      select: { id: true },
    });
    await prisma.courseForumPost.update({
      where: { id: postId },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
    return NextResponse.json({ commentId: comment.id }, { status: 201 });
  });
}
