import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  courseForumDisplayName,
  forumAuthor,
  isSameForumIdentity,
  requireCourseForumReadAccess,
} from '@/features/course-forum/server/course-forum-access';

const TERM_LABEL = { winter: 'Winter', summer: 'Summer', fall: 'Fall' } as const;

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
  request: Request,
  context: { params: Promise<{ courseId: string; userId: string }> },
) {
  return safeRoute(async () => {
    const { courseId, userId } = await context.params;
    const communitySlug = new URL(request.url).searchParams.get('communitySlug')?.trim() || '';
    const access = await requireCourseForumReadAccess(courseId);

    if (!access.ok) return NextResponse.json({ error: '成员不存在' }, { status: 404 });

    const [user, enrollment, postCount, answerCount, commentCount, recentPosts, communityMember] =
      await Promise.all([
        prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, name: true, email: true, image: true, role: true },
        }),
        prisma.courseEnrollment.findUnique({
          where: { userId_courseId: { userId, courseId } },
          select: { joinedAt: true },
        }),
        prisma.courseForumPost.count({ where: { courseId, authorId: userId, systemKey: null } }),
        prisma.courseForumAnswer.count({ where: { authorId: userId, post: { courseId } } }),
        prisma.courseForumComment.count({ where: { authorId: userId, post: { courseId } } }),
        prisma.courseForumPost.findMany({
          where: { courseId, authorId: userId, systemKey: null },
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
        communitySlug
          ? prisma.communityMember.findFirst({
              where: {
                userId,
                community: {
                  slug: communitySlug,
                  courseId,
                  OR: [
                    { visibility: 'public' },
                    { members: { some: { userId: access.userId } } },
                    { ownerId: access.userId },
                  ],
                },
              },
              select: { joinedAt: true },
            })
          : Promise.resolve(null),
      ]);

    if (!user) return NextResponse.json({ error: '成员不存在' }, { status: 404 });

    const isTeacher = user.id === access.course.ownerId;
    if (
      !isTeacher &&
      !enrollment &&
      !communityMember &&
      postCount + answerCount + commentCount === 0
    ) {
      return NextResponse.json({ error: '成员不存在' }, { status: 404 });
    }

    const author = forumAuthor(user, access.course.ownerId);
    const joinedText = isTeacher
      ? '课程老师'
      : enrollment
        ? `${enrollment.joinedAt.toLocaleDateString('zh-CN')} 加入课程`
        : communityMember
          ? `${communityMember.joinedAt.toLocaleDateString('zh-CN')} 加入 community`
          : '课程论坛成员';
    const term = access.course.academicTerm
      ? TERM_LABEL[access.course.academicTerm as keyof typeof TERM_LABEL]
      : null;
    const courseHeading = [
      access.course.courseCode?.trim() || access.course.name,
      access.course.academicYear,
      term,
    ]
      .filter(Boolean)
      .join(' · ');

    return NextResponse.json(
      {
        courseId,
        viewerId: access.userId,
        userId,
        canMessage: !isSameForumIdentity(access.user, user),
        author,
        displayName: courseForumDisplayName(user),
        joinedText,
        courseHeading,
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
