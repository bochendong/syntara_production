import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  courseForumDisplayName,
  forumAuthor,
  isSameForumIdentity,
} from '@/features/course-forum/server/course-forum-access';

function preview(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
    .replace(/[#>*_`$()[\]{}-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string; userId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug, userId } = await context.params;
    const community = await prisma.community.findFirst({
      where: {
        slug,
        OR: [
          { visibility: 'public' },
          { ownerId: auth.userId },
          { members: { some: { userId: auth.userId } } },
        ],
      },
      select: {
        id: true,
        name: true,
        ownerId: true,
        members: {
          where: { userId },
          select: { joinedAt: true },
          take: 1,
        },
      },
    });
    if (!community) return NextResponse.json({ error: '成员不存在' }, { status: 404 });

    const [viewer, user, postCount, answerCount, commentCount, recentPosts] = await Promise.all([
      prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, name: true, email: true, image: true, role: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, image: true, role: true },
      }),
      prisma.courseForumPost.count({
        where: { communityId: community.id, authorId: userId, systemKey: null },
      }),
      prisma.courseForumAnswer.count({
        where: { authorId: userId, post: { communityId: community.id } },
      }),
      prisma.courseForumComment.count({
        where: { authorId: userId, post: { communityId: community.id } },
      }),
      prisma.courseForumPost.findMany({
        where: { communityId: community.id, authorId: userId, systemKey: null },
        orderBy: { createdAt: 'desc' },
        take: 8,
        select: {
          id: true,
          title: true,
          bodyMarkdown: true,
          resolvedAt: true,
          createdAt: true,
          _count: { select: { answers: true, comments: true } },
        },
      }),
    ]);

    const membership = community.members[0] || null;
    if (!viewer || !user || (!membership && postCount + answerCount + commentCount === 0)) {
      return NextResponse.json({ error: '成员不存在' }, { status: 404 });
    }

    return NextResponse.json(
      {
        viewerId: auth.userId,
        userId,
        canMessage: !isSameForumIdentity(viewer, user),
        author: forumAuthor(user, ''),
        displayName: courseForumDisplayName(user),
        joinedText: membership
          ? `${membership.joinedAt.toLocaleDateString('zh-CN')} 加入 community`
          : 'community 成员',
        communityHeading: `c/${community.name}`,
        counts: {
          posts: postCount,
          answers: answerCount,
          comments: commentCount,
        },
        recentPosts: recentPosts.map((post) => ({
          id: post.id,
          title: post.title,
          bodyPreview: preview(post.bodyMarkdown) || '没有正文预览',
          resolved: Boolean(post.resolvedAt),
          createdAt: post.createdAt.toISOString(),
          answerCount: post._count.answers,
          commentCount: post._count.comments,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
