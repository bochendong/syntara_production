import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forumAuthor } from '@/features/course-forum/server/course-forum-access';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

function visibleForumPostAccess(viewerId: string) {
  return [
    { communityId: null },
    { community: { visibility: 'public' } },
    { community: { ownerId: viewerId } },
    { community: { members: { some: { userId: viewerId } } } },
  ];
}

export async function POST(request: Request, context: { params: Promise<{ postId: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { postId } = await context.params;
    const payload = createCommentSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json({ error: '评论需为 1-2000 个字符' }, { status: 400 });
    }

    const post = await prisma.courseForumPost.findFirst({
      where: {
        id: postId,
        systemKey: null,
        OR: visibleForumPostAccess(auth.userId),
      },
      select: { id: true },
    });
    if (!post) return NextResponse.json({ error: '帖子不存在' }, { status: 404 });

    const comment = await prisma.courseForumComment.create({
      data: { postId, authorId: auth.userId, body: payload.data.body },
      select: {
        id: true,
        body: true,
        createdAt: true,
        author: { select: { id: true, name: true, email: true, image: true, role: true } },
      },
    });

    return NextResponse.json(
      {
        comment: {
          id: comment.id,
          body: comment.body,
          parentId: null,
          replyCount: 0,
          qualityAnswer: false,
          qualityAnswerAt: null,
          createdAt: comment.createdAt.toISOString(),
          updatedAt: comment.createdAt.toISOString(),
          author: forumAuthor(comment.author, ''),
        },
      },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
