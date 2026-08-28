import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { forumAuthor } from '@/features/course-forum/server/course-forum-access';
import { safeRoute } from '@/lib/server/json-error-response';

const commentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

function pageNumber(value: string | null, fallback: number, max: number, min = 0) {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

async function findReadableCommunityPost(slug: string, postId: string, userId: string) {
  return prisma.courseForumPost.findFirst({
    where: {
      id: postId,
      community: {
        slug,
        OR: [{ visibility: 'public' }, { ownerId: userId }, { members: { some: { userId } } }],
      },
    },
    select: {
      id: true,
      community: { select: { ownerId: true } },
      _count: { select: { comments: { where: { parentId: null } } } },
    },
  });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; postId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug, postId } = await context.params;
    const post = await findReadableCommunityPost(slug, postId, auth.userId);
    if (!post) return NextResponse.json({ error: '帖子不存在' }, { status: 404 });

    const url = new URL(request.url);
    const offset = pageNumber(url.searchParams.get('offset'), 0, 100_000);
    const limit = pageNumber(url.searchParams.get('limit'), 10, 10, 1);
    const rows = await prisma.courseForumComment.findMany({
      where: { postId, parentId: null },
      orderBy: [{ qualityAnswerAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
      skip: offset,
      take: limit + 1,
      select: {
        id: true,
        body: true,
        parentId: true,
        qualityAnswerAt: true,
        createdAt: true,
        updatedAt: true,
        author: { select: { id: true, name: true, email: true, image: true, role: true } },
        _count: { select: { replies: true } },
      },
    });
    const comments = rows.slice(0, limit);
    return NextResponse.json(
      {
        comments: comments.map((comment) => ({
          id: comment.id,
          body: comment.body,
          author: forumAuthor(comment.author, ''),
          parentId: comment.parentId,
          replyCount: comment._count.replies,
          qualityAnswer: Boolean(comment.qualityAnswerAt),
          qualityAnswerAt: comment.qualityAnswerAt?.toISOString() || null,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.updatedAt.toISOString(),
        })),
        hasMore: rows.length > limit,
        nextOffset: offset + comments.length,
        totalCount: post._count.comments,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string; postId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug, postId } = await context.params;
    const payload = commentSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json({ error: '评论需为 1-2000 个字符' }, { status: 400 });
    }
    const post = await findReadableCommunityPost(slug, postId, auth.userId);
    if (!post) return NextResponse.json({ error: '帖子不存在' }, { status: 404 });

    const comment = await prisma.courseForumComment.create({
      data: {
        postId,
        authorId: auth.userId,
        body: payload.data.body,
      },
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
