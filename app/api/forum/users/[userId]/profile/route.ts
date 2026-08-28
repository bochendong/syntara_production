import { NextResponse } from 'next/server';
import {
  courseForumDisplayName,
  forumAuthor,
  isSameForumIdentity,
} from '@/features/course-forum/server/course-forum-access';
import type { Prisma } from '@/lib/server/generated-prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

function preview(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
    .replace(/[#>*_`$()[\]{}-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function visibleForumPostWhere(viewerId: string): Prisma.CourseForumPostWhereInput {
  return {
    systemKey: null,
    OR: [
      { communityId: null },
      { community: { visibility: 'public' } },
      { community: { ownerId: viewerId } },
      { community: { members: { some: { userId: viewerId } } } },
    ],
  };
}

export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { userId } = await context.params;
    const visibleWhere = visibleForumPostWhere(auth.userId);

    const [viewer, user, postCount, answerCount, commentCount, recentPosts] = await Promise.all([
      prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, name: true, email: true, image: true, role: true },
      }),
      prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, name: true, email: true, image: true, role: true, createdAt: true },
      }),
      prisma.courseForumPost.count({
        where: { ...visibleWhere, authorId: userId },
      }),
      prisma.courseForumAnswer.count({
        where: { authorId: userId, post: visibleWhere },
      }),
      prisma.courseForumComment.count({
        where: { authorId: userId, post: visibleWhere },
      }),
      prisma.courseForumPost.findMany({
        where: { ...visibleWhere, authorId: userId },
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

    if (!viewer || !user) {
      return NextResponse.json({ error: '成员不存在' }, { status: 404 });
    }

    return NextResponse.json(
      {
        viewerId: auth.userId,
        userId,
        canMessage: !isSameForumIdentity(viewer, user),
        author: forumAuthor(user, ''),
        displayName: courseForumDisplayName(user),
        joinedText: `${user.createdAt.toLocaleDateString('zh-CN')} 加入论坛`,
        forumHeading: 'Syntara Forum',
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
