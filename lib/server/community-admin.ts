import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';

export function isCommunityManager(args: {
  ownerId: string;
  viewerId: string;
  role?: string | null;
}) {
  return (
    args.ownerId === args.viewerId ||
    args.role === 'owner' ||
    args.role === 'admin' ||
    args.role === 'manager'
  );
}

export async function requireCommunityManager(slug: string, viewerId: string) {
  const community = await prisma.community.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      visibility: true,
      ownerId: true,
      members: {
        where: { userId: viewerId },
        select: { role: true },
        take: 1,
      },
    },
  });

  if (!community) {
    return { ok: false as const, response: NextResponse.json({ error: 'Community 不存在' }, { status: 404 }) };
  }

  const role = community.members[0]?.role || null;
  if (!isCommunityManager({ ownerId: community.ownerId, viewerId, role })) {
    return { ok: false as const, response: NextResponse.json({ error: '只有管理者可以执行此操作' }, { status: 403 }) };
  }

  return { ok: true as const, community, role };
}

export function publicMemberRole(role: string | null | undefined, isOwner: boolean) {
  return isOwner || role === 'owner' || role === 'admin' || role === 'manager' ? 'admin' : 'member';
}
