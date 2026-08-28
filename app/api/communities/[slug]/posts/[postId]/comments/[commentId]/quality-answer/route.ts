import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { requireCommunityManager } from '@/lib/server/community-admin';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

const qualityAnswerSchema = z.object({
  qualityAnswer: z.boolean(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string; postId: string; commentId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug, postId, commentId } = await context.params;
    const access = await requireCommunityManager(slug, auth.userId);
    if (!access.ok) return access.response;

    const payload = qualityAnswerSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json({ error: 'qualityAnswer 必须是布尔值' }, { status: 400 });
    }

    const now = new Date();
    const updated = await prisma.courseForumComment.updateMany({
      where: {
        id: commentId,
        postId,
        parentId: null,
        post: { communityId: access.community.id },
      },
      data: payload.data.qualityAnswer
        ? { qualityAnswerAt: now, qualityAnswerById: auth.userId }
        : { qualityAnswerAt: null, qualityAnswerById: null },
    });

    if (updated.count === 0) {
      return NextResponse.json({ error: '评论不存在' }, { status: 404 });
    }

    await prisma.courseForumPost.update({
      where: { id: postId },
      data: { updatedAt: now },
      select: { id: true },
    });

    return NextResponse.json(
      {
        commentId,
        qualityAnswer: payload.data.qualityAnswer,
        qualityAnswerAt: payload.data.qualityAnswer ? now.toISOString() : null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
