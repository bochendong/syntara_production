import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  forumAuthor,
  requireCourseForumAccess,
} from '@/features/course-forum/server/course-forum-access';

const REPLY_PAGE_SIZE = 5;

function pageNumber(value: string | null, fallback: number, max: number, min = 0) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ courseId: string; postId: string; commentId: string }> },
) {
  return safeRoute(async () => {
    const { courseId, postId, commentId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;

    const parent = await prisma.courseForumComment.findFirst({
      where: { id: commentId, postId, post: { courseId }, parentId: null },
      select: { id: true, _count: { select: { replies: true } } },
    });
    if (!parent) return NextResponse.json({ error: '评论不存在' }, { status: 404 });

    const url = new URL(request.url);
    const offset = pageNumber(url.searchParams.get('offset'), 0, 100_000);
    const limit = pageNumber(url.searchParams.get('limit'), REPLY_PAGE_SIZE, REPLY_PAGE_SIZE, 1);
    const rows = await prisma.courseForumComment.findMany({
      where: { postId, parentId: commentId },
      orderBy: { createdAt: 'asc' },
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        body: true,
        parentId: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true, email: true, image: true, role: true } },
        _count: { select: { replies: true } },
      },
    });
    const replies = rows.slice(0, limit);

    return NextResponse.json(
      {
        replies: replies.map((reply) => ({
          id: reply.id,
          body: reply.body,
          parentId: reply.parentId,
          replyCount: reply._count.replies,
          author: forumAuthor(reply.author, access.course.ownerId),
          createdAt: reply.createdAt.toISOString(),
          updatedAt: reply.updatedAt.toISOString(),
        })),
        hasMore: rows.length > limit,
        nextOffset: offset + replies.length,
        totalCount: parent._count.replies,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
