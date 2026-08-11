import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  parseCourseForumImages,
  requireCourseForumAccess,
} from '@/features/course-forum/server/course-forum-access';

export async function POST(
  request: Request,
  context: { params: Promise<{ courseId: string; postId: string }> },
) {
  return safeRoute(async () => {
    const { courseId, postId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;
    const post = await prisma.courseForumPost.findFirst({
      where: { id: postId, courseId },
      select: { id: true },
    });
    if (!post) return NextResponse.json({ error: '帖子不存在' }, { status: 404 });

    const formData = await request.formData();
    const bodyMarkdown = String(formData.get('bodyMarkdown') || '').trim();
    if (!bodyMarkdown || bodyMarkdown.length > 30_000) {
      return NextResponse.json({ error: '解答需为 1–30000 个字符' }, { status: 400 });
    }
    const images = await parseCourseForumImages(formData);
    const answer = await prisma.courseForumAnswer.create({
      data: {
        postId,
        authorId: access.userId,
        bodyMarkdown,
        attachments: images.length
          ? { create: images.map((image) => ({ ...image, uploaderId: access.userId })) }
          : undefined,
      },
      select: { id: true },
    });
    await prisma.courseForumPost.update({
      where: { id: postId },
      data: { updatedAt: new Date() },
      select: { id: true },
    });
    return NextResponse.json({ answerId: answer.id }, { status: 201 });
  });
}
