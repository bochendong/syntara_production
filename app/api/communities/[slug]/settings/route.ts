import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireCommunityManager, publicMemberRole } from '@/lib/server/community-admin';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

const updateCommunitySettingsSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  welcomeText: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(600).nullable().optional(),
  visibility: z.enum(['public', 'private']).optional(),
});

function memberName(user: { name: string | null; email: string | null }) {
  return user.name?.trim() || user.email?.split('@')[0] || '社区成员';
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug } = await context.params;
    const access = await requireCommunityManager(slug, auth.userId);
    if (!access.ok) return access.response;

    const community = await prisma.community.findUnique({
      where: { slug },
      select: {
        id: true,
        slug: true,
        name: true,
        welcomeText: true,
        description: true,
        bannerUrl: true,
        avatarUrl: true,
        visibility: true,
        ownerId: true,
        members: {
          orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
          select: {
            userId: true,
            role: true,
            joinedAt: true,
            user: { select: { id: true, name: true, email: true, image: true } },
          },
        },
      },
    });
    if (!community) return NextResponse.json({ error: 'Community 不存在' }, { status: 404 });

    return NextResponse.json(
      {
        community: {
          id: community.id,
          slug: community.slug,
          name: community.name,
          welcomeText: community.welcomeText || '',
          description: community.description || '',
          bannerUrl: community.bannerUrl || '',
          avatarUrl: community.avatarUrl || '',
          visibility: community.visibility === 'private' ? 'private' : 'public',
          viewerRole: publicMemberRole(access.role, community.ownerId === auth.userId),
        },
        members: community.members.map((member) => ({
          userId: member.userId,
          name: memberName(member.user),
          email: member.user.email || '',
          image: member.user.image || '',
          role: publicMemberRole(member.role, member.userId === community.ownerId),
          locked: member.userId === community.ownerId,
          joinedAt: member.joinedAt.toISOString(),
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ slug: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug } = await context.params;
    const access = await requireCommunityManager(slug, auth.userId);
    if (!access.ok) return access.response;

    const payload = updateCommunitySettingsSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json({ error: '设置内容格式不正确' }, { status: 400 });
    }

    const updated = await prisma.community.update({
      where: { id: access.community.id },
      data: {
        ...(payload.data.name !== undefined ? { name: payload.data.name } : {}),
        ...(payload.data.welcomeText !== undefined
          ? { welcomeText: payload.data.welcomeText?.trim() || null }
          : {}),
        ...(payload.data.description !== undefined
          ? { description: payload.data.description?.trim() || null }
          : {}),
        ...(payload.data.visibility !== undefined ? { visibility: payload.data.visibility } : {}),
      },
      select: { id: true, slug: true, name: true, welcomeText: true, description: true, visibility: true },
    });

    return NextResponse.json(
      {
        community: {
          ...updated,
          welcomeText: updated.welcomeText || '',
          description: updated.description || '',
        },
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
