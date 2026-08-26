import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const query = new URL(request.url).searchParams.get('q')?.trim().slice(0, 100) || '';
    if (!query) {
      return NextResponse.json(
        { communities: [] },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }

    const communities = await prisma.community.findMany({
      where: {
        visibility: 'public',
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { slug: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 12,
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        avatarUrl: true,
        bannerUrl: true,
        members: {
          where: { userId: auth.userId },
          select: { id: true },
          take: 1,
        },
        _count: { select: { members: true, forumPosts: true } },
      },
    });

    return NextResponse.json(
      {
        communities: communities.map((community) => ({
          id: community.id,
          slug: community.slug,
          name: community.name,
          description: community.description,
          avatarUrl: community.avatarUrl,
          bannerUrl: community.bannerUrl,
          memberCount: community._count.members,
          postCount: community._count.forumPosts,
          isJoined: community.members.length > 0,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
