import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { requireCommunityManager } from '@/lib/server/community-admin';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug } = await context.params;
    const access = await requireCommunityManager(slug, auth.userId);
    if (!access.ok) return access.response;

    const url = new URL(request.url);
    const q = url.searchParams.get('q')?.trim().slice(0, 80) || '';
    if (q.length < 2) {
      return NextResponse.json({ users: [] }, { headers: { 'Cache-Control': 'private, no-store' } });
    }

    const users = await prisma.user.findMany({
      where: {
        id: { not: auth.userId },
        isActive: true,
        communityMemberships: { none: { communityId: access.community.id } },
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      orderBy: [{ name: 'asc' }, { email: 'asc' }],
      take: 12,
      select: { id: true, name: true, email: true, image: true },
    });

    return NextResponse.json(
      {
        users: users.map((user) => ({
          id: user.id,
          name: user.name?.trim() || user.email?.split('@')[0] || '用户',
          email: user.email || '',
          image: user.image || '',
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
