import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { requireCommunityManager } from '@/lib/server/community-admin';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

const updateMemberSchema = z.object({
  role: z.enum(['admin', 'member']),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string; userId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug, userId } = await context.params;
    const access = await requireCommunityManager(slug, auth.userId);
    if (!access.ok) return access.response;

    if (userId === access.community.ownerId) {
      return NextResponse.json({ error: '不能修改创建者身份' }, { status: 400 });
    }

    const payload = updateMemberSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) return NextResponse.json({ error: '成员身份格式不正确' }, { status: 400 });

    const member = await prisma.communityMember.update({
      where: { communityId_userId: { communityId: access.community.id, userId } },
      data: { role: payload.data.role },
      select: { userId: true, role: true },
    });

    return NextResponse.json({ member }, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ slug: string; userId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug, userId } = await context.params;
    const access = await requireCommunityManager(slug, auth.userId);
    if (!access.ok) return access.response;

    if (userId === access.community.ownerId) {
      return NextResponse.json({ error: '不能删除创建者' }, { status: 400 });
    }

    await prisma.communityMember.delete({
      where: { communityId_userId: { communityId: access.community.id, userId } },
    });

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
