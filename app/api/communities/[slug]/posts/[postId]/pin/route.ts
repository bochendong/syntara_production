import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { requireCommunityManager } from '@/lib/server/community-admin';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string; postId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug, postId } = await context.params;
    const access = await requireCommunityManager(slug, auth.userId);
    if (!access.ok) return access.response;

    const payload = (await request.json().catch(() => null)) as { pinned?: unknown } | null;
    if (typeof payload?.pinned !== 'boolean') {
      return NextResponse.json({ error: 'pinned 必须是布尔值' }, { status: 400 });
    }

    const now = new Date();
    const updated = await prisma.courseForumPost.updateMany({
      where: { id: postId, communityId: access.community.id },
      data: payload.pinned
        ? { pinnedAt: now, pinnedById: auth.userId }
        : { pinnedAt: null, pinnedById: null },
    });

    if (updated.count === 0) {
      const legacyUpdated = await prisma.communityPost.updateMany({
        where: { id: postId, communityId: access.community.id },
        data: payload.pinned
          ? { pinnedAt: now, pinnedById: auth.userId }
          : { pinnedAt: null, pinnedById: null },
      });

      if (legacyUpdated.count === 0) {
        return NextResponse.json({ error: '帖子不存在' }, { status: 404 });
      }
    }

    return NextResponse.json(
      {
        postId,
        pinned: payload.pinned,
        pinnedAt: payload.pinned ? now.toISOString() : null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
