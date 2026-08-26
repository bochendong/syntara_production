import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug } = await context.params;
    const body = (await request.json().catch(() => null)) as { invited?: unknown } | null;
    const invited = body?.invited === true;
    const community = await prisma.community.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        visibility: true,
        ownerId: true,
        members: {
          where: { userId: auth.userId },
          select: { id: true },
          take: 1,
        },
      },
    });

    if (!community) {
      return NextResponse.json({ error: 'Community 不存在' }, { status: 404 });
    }

    const existingMember = community.members[0] ?? null;
    const alreadyAllowed = Boolean(existingMember) || community.ownerId === auth.userId;

    if (community.visibility === 'private' && !alreadyAllowed) {
      if (!invited) {
        return NextResponse.json({ error: 'Private community 需要邀请才能加入' }, { status: 403 });
      }
      const inviteCount = await prisma.directMessage.count({
        where: {
          body: { contains: `/communities/${community.slug}` },
          senderId: { not: auth.userId },
          thread: {
            OR: [{ userAId: auth.userId }, { userBId: auth.userId }],
          },
        },
      });
      if (!inviteCount) {
        return NextResponse.json({ error: '没有找到这条 community 邀请' }, { status: 403 });
      }
    }

    if (!existingMember) {
      await prisma.communityMember.create({
        data: { communityId: community.id, userId: auth.userId, role: 'member' },
      });
    }

    return NextResponse.json(
      {
        ok: true,
        community: {
          id: community.id,
          slug: community.slug,
          name: community.name,
          href: `/communities/${community.slug}`,
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

export async function DELETE(_request: Request, context: { params: Promise<{ slug: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug } = await context.params;
    const community = await prisma.community.findUnique({
      where: { slug },
      select: {
        id: true,
        ownerId: true,
        members: {
          where: { userId: auth.userId },
          select: { id: true, role: true },
          take: 1,
        },
      },
    });

    if (!community) {
      return NextResponse.json({ error: 'Community 不存在' }, { status: 404 });
    }

    const membership = community.members[0] ?? null;
    if (!membership) {
      return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
    }
    if (community.ownerId === auth.userId || membership.role === 'owner') {
      return NextResponse.json({ error: '管理者不能直接退出自己的 community' }, { status: 400 });
    }

    await prisma.communityMember.delete({ where: { id: membership.id } });

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } });
  });
}
