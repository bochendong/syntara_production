import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  forumAttachment,
  forumAuthor,
  parseCourseForumImages,
  requireCourseForumAccess,
} from '@/features/course-forum/server/course-forum-access';
import type { CourseForumStatusFilter } from '@/features/course-forum/domain/course-forum';

export const dynamic = 'force-dynamic';

const attachmentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  byteSize: true,
} as const;

const authorSelect = {
  id: true,
  name: true,
  email: true,
  image: true,
} as const;

function bodyPreview(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
    .replace(/\\begin\{([^}]+)\}[\s\S]*?\\end\{\1\}/g, ' [公式] ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' [公式] ')
    .replace(/\$[^$\n]*\$/g, ' [公式] ')
    .replace(/\\[A-Za-z]+/g, ' ')
    .replace(/[${}]/g, ' ')
    .replace(/[`*_>#\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140);
}

function statusFilter(value: string | null): CourseForumStatusFilter {
  return value === 'resolved' || value === 'unresolved' ? value : 'all';
}

export async function GET(request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const { courseId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;

    const url = new URL(request.url);
    const filter = statusFilter(url.searchParams.get('status'));
    const search = url.searchParams.get('q')?.trim().slice(0, 100) || '';
    const requestedPostId = url.searchParams.get('postId')?.trim() || '';
    const where = {
      courseId,
      ...(filter === 'resolved'
        ? { resolvedAt: { not: null } }
        : filter === 'unresolved'
          ? { resolvedAt: null }
          : {}),
      ...(search
        ? {
            OR: [
              { title: { contains: search, mode: 'insensitive' as const } },
              { bodyMarkdown: { contains: search, mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };

    const [unresolvedCount, totalCount, posts] = await prisma.$transaction([
      prisma.courseForumPost.count({ where: { courseId, resolvedAt: null } }),
      prisma.courseForumPost.count({ where: { courseId } }),
      prisma.courseForumPost.findMany({
        where,
        orderBy: [{ resolvedAt: 'asc' }, { updatedAt: 'desc' }],
        take: 80,
        select: {
          id: true,
          title: true,
          bodyMarkdown: true,
          resolvedAt: true,
          createdAt: true,
          updatedAt: true,
          author: { select: authorSelect },
          _count: { select: { answers: true, comments: true, attachments: true } },
        },
      }),
    ]);

    const selectedPostId =
      (requestedPostId && posts.some((post) => post.id === requestedPostId)
        ? requestedPostId
        : posts[0]?.id) || '';
    const selected = selectedPostId
      ? await prisma.courseForumPost.findFirst({
          where: { id: selectedPostId, courseId },
          select: {
            id: true,
            title: true,
            bodyMarkdown: true,
            resolvedAt: true,
            createdAt: true,
            updatedAt: true,
            author: { select: authorSelect },
            attachments: { orderBy: { createdAt: 'asc' }, select: attachmentSelect },
            answers: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                bodyMarkdown: true,
                acceptedAt: true,
                createdAt: true,
                updatedAt: true,
                author: { select: authorSelect },
                attachments: { orderBy: { createdAt: 'asc' }, select: attachmentSelect },
              },
            },
            comments: {
              orderBy: { createdAt: 'asc' },
              select: {
                id: true,
                body: true,
                createdAt: true,
                updatedAt: true,
                author: { select: authorSelect },
              },
            },
            _count: { select: { answers: true, comments: true, attachments: true } },
          },
        })
      : null;

    const mapSummary = (post: (typeof posts)[number]) => ({
      id: post.id,
      title: post.title,
      bodyPreview: bodyPreview(post.bodyMarkdown),
      author: forumAuthor(post.author, access.course.ownerId),
      resolved: Boolean(post.resolvedAt),
      answerCount: post._count.answers,
      commentCount: post._count.comments,
      attachmentCount: post._count.attachments,
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    });

    const selectedSummary = selected
      ? {
          id: selected.id,
          title: selected.title,
          bodyPreview: bodyPreview(selected.bodyMarkdown),
          author: forumAuthor(selected.author, access.course.ownerId),
          resolved: Boolean(selected.resolvedAt),
          answerCount: selected._count.answers,
          commentCount: selected._count.comments,
          attachmentCount: selected._count.attachments,
          createdAt: selected.createdAt.toISOString(),
          updatedAt: selected.updatedAt.toISOString(),
        }
      : null;

    return NextResponse.json(
      {
        course: {
          id: access.course.id,
          name: access.course.name,
          code: access.course.courseCode?.trim() || access.course.name,
          academicYear: access.course.academicYear,
          term: access.course.academicTerm,
        },
        viewer: {
          ...forumAuthor(access.user, access.course.ownerId),
          accessRole: access.accessRole,
        },
        unresolvedCount,
        totalCount,
        posts: posts.map(mapSummary),
        selectedPost:
          selected && selectedSummary
            ? {
                ...selectedSummary,
                bodyMarkdown: selected.bodyMarkdown,
                attachments: selected.attachments.map((item) => forumAttachment(courseId, item)),
                answers: selected.answers
                  .map((answer) => ({
                    id: answer.id,
                    bodyMarkdown: answer.bodyMarkdown,
                    author: forumAuthor(answer.author, access.course.ownerId),
                    accepted: Boolean(answer.acceptedAt),
                    acceptedAt: answer.acceptedAt?.toISOString() || null,
                    attachments: answer.attachments.map((item) => forumAttachment(courseId, item)),
                    createdAt: answer.createdAt.toISOString(),
                    updatedAt: answer.updatedAt.toISOString(),
                  }))
                  .sort((a, b) => Number(b.accepted) - Number(a.accepted)),
                comments: selected.comments.map((comment) => ({
                  id: comment.id,
                  body: comment.body,
                  author: forumAuthor(comment.author, access.course.ownerId),
                  createdAt: comment.createdAt.toISOString(),
                  updatedAt: comment.updatedAt.toISOString(),
                })),
              }
            : null,
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const { courseId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;
    const formData = await request.formData();
    const title = String(formData.get('title') || '').trim();
    const bodyMarkdown = String(formData.get('bodyMarkdown') || '').trim();
    if (!title || title.length > 200) {
      return NextResponse.json({ error: '标题需为 1–200 个字符' }, { status: 400 });
    }
    if (!bodyMarkdown || bodyMarkdown.length > 30_000) {
      return NextResponse.json({ error: '帖子正文需为 1–30000 个字符' }, { status: 400 });
    }
    const images = await parseCourseForumImages(formData);
    const post = await prisma.courseForumPost.create({
      data: {
        courseId,
        authorId: access.userId,
        title,
        bodyMarkdown,
        attachments: images.length
          ? {
              create: images.map((image) => ({ ...image, uploaderId: access.userId })),
            }
          : undefined,
      },
      select: { id: true },
    });
    return NextResponse.json({ postId: post.id }, { status: 201 });
  });
}
