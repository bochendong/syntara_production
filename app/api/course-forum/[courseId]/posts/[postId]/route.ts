import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireCourseForumAccess } from '@/features/course-forum/server/course-forum-access';

const updatePostSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bodyMarkdown: z.string().trim().min(1).max(30_000),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ courseId: string; postId: string }> },
) {
  return safeRoute(async () => {
    const { courseId, postId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;

    const payload = updatePostSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: '标题需为 1–200 个字符，帖子正文需为 1–30000 个字符' },
        { status: 400 },
      );
    }

    const post = await prisma.courseForumPost.findFirst({
      where: { id: postId, courseId },
      select: { id: true, authorId: true, systemKey: true },
    });
    if (!post) return NextResponse.json({ error: '帖子不存在' }, { status: 404 });
    if (post.systemKey) {
      return NextResponse.json({ error: '论坛指南不能编辑' }, { status: 403 });
    }
    if (post.authorId !== access.userId) {
      return NextResponse.json({ error: '只能编辑自己发布的帖子' }, { status: 403 });
    }

    await prisma.courseForumPost.update({
      where: { id: post.id },
      data: {
        title: payload.data.title,
        bodyMarkdown: payload.data.bodyMarkdown,
      },
      select: { id: true },
    });
    return NextResponse.json({ ok: true, postId: post.id });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ courseId: string; postId: string }> },
) {
  return safeRoute(async () => {
    const { courseId, postId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;

    const post = await prisma.courseForumPost.findFirst({
      where: { id: postId, courseId },
      select: { id: true, authorId: true, systemKey: true },
    });
    if (!post) return NextResponse.json({ error: '帖子不存在' }, { status: 404 });
    if (post.systemKey) {
      return NextResponse.json({ error: '论坛指南不能删除' }, { status: 403 });
    }
    if (post.authorId !== access.userId && !access.isTeacher) {
      return NextResponse.json({ error: '只能删除自己发布的帖子' }, { status: 403 });
    }

    await prisma.courseForumPost.delete({ where: { id: post.id } });
    return NextResponse.json({ ok: true });
  });
}
