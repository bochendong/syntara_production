import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';

export const dynamic = 'force-dynamic';

const createCommunitySchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/i),
  description: z.string().trim().max(600).optional(),
  privacy: z.enum(['public', 'private']).default('public'),
  avatarUrl: z.string().trim().max(2000).optional(),
  bannerUrl: z.string().trim().max(2000).optional(),
});

const TEMPLATE_COMMUNITIES = [
  {
    slug: 'ask-syntara',
    name: 'Ask Syntara',
    description: '课程之外的开放讨论区，可以提问、分享学习经验和认识同学。',
    welcomeText: '欢迎来到 Ask Syntara',
    bannerUrl: '/avatars/user-avators/user-avatar-1.png',
    avatarUrl: '/avatars/user-avators/user-avatar-2.png',
    postTitle: '欢迎来到 Ask Syntara',
    postBody: '这里是 community 功能的第一版骨架。后面可以继续接入发帖、评论、加入申请和推荐流。',
  },
  {
    slug: 'study-lounge',
    name: 'Study Lounge',
    description: '轻量学习休息室，用来找学习搭子、分享复习计划和讨论非课程绑定的问题。',
    welcomeText: '欢迎来到 Study Lounge',
    bannerUrl: '/avatars/user-avators/user-avatar-3.png',
    avatarUrl: '/avatars/user-avators/user-avatar-4.png',
    postTitle: 'Study Lounge 模板社区',
    postBody: '这是第二个模板 community。后续可以接入匹配、私信、活动和学习小组功能。',
  },
] as const;

async function ensureTemplateCommunities(userId: string) {
  const templateOwner =
    (await prisma.user.findFirst({
      where: { role: 'ADMIN', isActive: true },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    })) ??
    (await prisma.user.findFirst({
      where: { id: userId },
      select: { id: true },
    }));
  const ownerId = templateOwner?.id ?? userId;

  for (const template of TEMPLATE_COMMUNITIES) {
    const community = await prisma.community.upsert({
      where: { slug: template.slug },
      create: {
        slug: template.slug,
        name: template.name,
        description: template.description,
        welcomeText: template.welcomeText,
        ownerId,
        bannerUrl: template.bannerUrl,
        avatarUrl: template.avatarUrl,
        members: {
          create: { userId: ownerId, role: 'owner' },
        },
      },
      update: {
        welcomeText: template.welcomeText,
      },
      select: { id: true, ownerId: true },
    });

    const templatePostKey = `community-template:${template.slug}`;
    const templatePost = await prisma.courseForumPost.findFirst({
      where: { communityId: community.id, systemKey: templatePostKey },
      select: { id: true },
    });
    if (templatePost) {
      await prisma.courseForumPost.update({
        where: { id: templatePost.id },
        data: {
          title: template.postTitle,
          bodyMarkdown: template.postBody,
        },
        select: { id: true },
      });
    } else {
      await prisma.courseForumPost.create({
        data: {
          communityId: community.id,
          authorId: community.ownerId,
          title: template.postTitle,
          bodyMarkdown: template.postBody,
          systemKey: templatePostKey,
        },
        select: { id: true },
      });
    }

    await prisma.communityMember.upsert({
      where: { communityId_userId: { communityId: community.id, userId: community.ownerId } },
      create: { communityId: community.id, userId: community.ownerId, role: 'owner' },
      update: { role: 'owner' },
    });
  }
}

function communityListItem(row: {
  community: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    avatarUrl: string | null;
    bannerUrl: string | null;
    _count: { members: number; posts: number; forumPosts: number };
  };
  role: string;
  joinedAt: Date;
}) {
  return {
    id: row.community.id,
    slug: row.community.slug,
    name: row.community.name,
    description: row.community.description,
    avatarUrl: row.community.avatarUrl,
    bannerUrl: row.community.bannerUrl,
    role: row.role,
    joinedAt: row.joinedAt.toISOString(),
    memberCount: row.community._count.members,
    postCount: row.community._count.forumPosts + row.community._count.posts,
  };
}

export async function GET() {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    await ensureTemplateCommunities(auth.userId);

    const memberships = await prisma.communityMember.findMany({
      where: { userId: auth.userId },
      orderBy: { joinedAt: 'desc' },
      select: {
        role: true,
        joinedAt: true,
        community: {
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            avatarUrl: true,
            bannerUrl: true,
            _count: { select: { members: true, posts: true, forumPosts: true } },
          },
        },
      },
    });

    return NextResponse.json(
      { communities: memberships.map(communityListItem) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

export async function POST(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const payload = createCommunitySchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json({ error: 'Invalid community payload' }, { status: 400 });
    }

    const slug = payload.data.slug.toLowerCase();
    const community = await prisma.community.create({
      data: {
        slug,
        name: payload.data.name,
        description: payload.data.description || null,
        visibility: payload.data.privacy,
        avatarUrl: payload.data.avatarUrl || null,
        bannerUrl: payload.data.bannerUrl || null,
        ownerId: auth.userId,
        members: { create: { userId: auth.userId, role: 'owner' } },
      },
      select: {
        id: true,
        slug: true,
        name: true,
        description: true,
        avatarUrl: true,
        bannerUrl: true,
        _count: { select: { members: true, posts: true, forumPosts: true } },
      },
    });

    return NextResponse.json(
      {
        community: {
          ...community,
          role: 'owner',
          joinedAt: new Date().toISOString(),
          memberCount: community._count.members,
          postCount: community._count.forumPosts + community._count.posts,
        },
      },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
