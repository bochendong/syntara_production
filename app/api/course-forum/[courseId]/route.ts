import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  forumAttachment,
  forumAuthor,
  parseCourseForumImages,
  requireCourseForumReadAccess,
} from '@/features/course-forum/server/course-forum-access';
import type { CourseForumStatusFilter } from '@/features/course-forum/domain/course-forum';
import { ensureCourseForumWelcomePost } from '@/features/course-forum/server/course-forum-welcome';

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
  role: true,
} as const;

const COMMENT_PAGE_SIZE = 10;

function bodyPreview(markdown: string) {
  const firstContentLine =
    markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/^[-:| ]+$/.test(line)) || '';
  return firstContentLine
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
    .replace(/\\begin\{([^}]+)\}[\s\S]*?\\end\{\1\}/g, ' [公式] ')
    .replace(/\$\$[\s\S]*?\$\$/g, ' [公式] ')
    .replace(/\$[^$\n]*\$/g, ' [公式] ')
    .replace(/\\[A-Za-z]+/g, ' ')
    .replace(/[|${}]/g, ' ')
    .replace(/[`*_>#\-[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 42);
}

function bodyPreviewMarkdown(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const previewLines: string[] = [];
  let inFence = false;
  let skippingTable = false;

  for (let index = 0; index < lines.length && previewLines.length < 3; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    const nextLine = lines[index + 1]?.trim() || '';

    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      if (!inFence) previewLines.push('[代码]');
      continue;
    }
    if (inFence || !trimmed) continue;

    const startsTable = trimmed.includes('|') && /^\|?[\s:-]+\|[\s|:-]+\|?$/u.test(nextLine);
    const isTableSeparator = /^\|?[\s:-]+\|[\s|:-]+\|?$/u.test(trimmed);
    const isTableRow = skippingTable && trimmed.includes('|');
    if (startsTable || isTableSeparator || isTableRow) {
      skippingTable = true;
      continue;
    }
    skippingTable = false;

    const withoutImages = trimmed.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim();
    if (withoutImages) previewLines.push(withoutImages);
  }

  return previewLines.join('\n').slice(0, 240);
}

function tablePreview(markdown: string) {
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  for (let index = 0; index < lines.length - 1; index += 1) {
    const header = lines[index];
    const separator = lines[index + 1];
    if (!header.includes('|') || !/^\|?[\s:-]+\|[\s|:-]+\|?$/u.test(separator)) continue;
    const cells = (line: string) =>
      line
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean)
        .slice(0, 3);
    const headers = cells(header);
    if (!headers.length) continue;
    const rows = lines
      .slice(index + 2)
      .filter((line) => line.includes('|'))
      .map(cells)
      .filter((row) => row.length)
      .slice(0, 2);
    return { headers, rows };
  }
  return null;
}

function statusFilter(value: string | null): CourseForumStatusFilter {
  return value === 'resolved' || value === 'unresolved' ? value : 'all';
}

export async function GET(request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const { courseId } = await context.params;
    const access = await requireCourseForumReadAccess(courseId);
    if (!access.ok) return access.response;
    await ensureCourseForumWelcomePost(access.course);

    const url = new URL(request.url);
    const filter = statusFilter(url.searchParams.get('status'));
    const search = url.searchParams.get('q')?.trim().slice(0, 100) || '';
    const requestedPostId = url.searchParams.get('postId')?.trim() || '';
    const where = {
      courseId,
      communityId: null,
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
    const [unresolvedCount, totalCount, coursePosts, publicCommunityPosts] =
      await prisma.$transaction([
        prisma.courseForumPost.count({
          where: { courseId, communityId: null, systemKey: null, resolvedAt: null },
        }),
        prisma.courseForumPost.count({ where: { courseId, communityId: null, systemKey: null } }),
        prisma.courseForumPost.findMany({
          where,
          orderBy: [{ resolvedAt: 'asc' }, { updatedAt: 'desc' }],
          take: 80,
          select: {
            id: true,
            title: true,
            bodyMarkdown: true,
            resolvedAt: true,
            pinnedAt: true,
            systemKey: true,
            createdAt: true,
            updatedAt: true,
            author: { select: authorSelect },
            attachments: { orderBy: { createdAt: 'asc' }, take: 2, select: attachmentSelect },
            community: {
              select: {
                id: true,
                slug: true,
                name: true,
                visibility: true,
              },
            },
            _count: { select: { answers: true, comments: true, attachments: true } },
          },
        }),
        prisma.courseForumPost.findMany({
          where:
            filter === 'all'
              ? {
                  courseId,
                  communityId: { not: null },
                  community: { visibility: 'public' },
                  ...(search
                    ? {
                        OR: [
                          { title: { contains: search, mode: 'insensitive' as const } },
                          { bodyMarkdown: { contains: search, mode: 'insensitive' as const } },
                        ],
                      }
                    : {}),
                }
              : { id: '__course_forum_no_public_community_posts__' },
          orderBy: { updatedAt: 'desc' },
          take: 80,
          select: {
            id: true,
            title: true,
            bodyMarkdown: true,
            resolvedAt: true,
            pinnedAt: true,
            systemKey: true,
            createdAt: true,
            updatedAt: true,
            author: { select: authorSelect },
            attachments: { orderBy: { createdAt: 'asc' }, take: 2, select: attachmentSelect },
            community: {
              select: {
                id: true,
                slug: true,
                name: true,
                visibility: true,
              },
            },
            _count: { select: { answers: true, comments: true, attachments: true } },
          },
        }),
      ]);

    const selectedPostId =
      requestedPostId || [...coursePosts, ...publicCommunityPosts][0]?.id || '';
    const selected = selectedPostId
      ? await prisma.courseForumPost.findFirst({
          where: {
            id: selectedPostId,
            courseId,
            OR: [
              { communityId: null },
              { community: { visibility: 'public' } },
              { community: { members: { some: { userId: access.userId } } } },
            ],
          },
          select: {
            id: true,
            title: true,
            bodyMarkdown: true,
            resolvedAt: true,
            pinnedAt: true,
            systemKey: true,
            createdAt: true,
            updatedAt: true,
            author: { select: authorSelect },
            community: {
              select: {
                id: true,
                slug: true,
                name: true,
                visibility: true,
              },
            },
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
              where: { parentId: null },
              orderBy: { createdAt: 'asc' },
              take: COMMENT_PAGE_SIZE + 1,
              select: {
                id: true,
                body: true,
                parentId: true,
                createdAt: true,
                updatedAt: true,
                author: { select: authorSelect },
                _count: { select: { replies: true } },
              },
            },
            _count: {
              select: {
                answers: true,
                comments: { where: { parentId: null } },
                attachments: true,
              },
            },
          },
        })
      : null;

    const selectedComments = selected?.comments.slice(0, COMMENT_PAGE_SIZE) || [];
    const selectedCommentsHasMore = Boolean(
      selected && selected.comments.length > COMMENT_PAGE_SIZE,
    );

    const mapSummary = (
      post: (typeof coursePosts)[number] | (typeof publicCommunityPosts)[number],
    ) => ({
      id: post.id,
      title: post.title,
      bodyPreview: bodyPreview(post.bodyMarkdown),
      bodyPreviewMarkdown: bodyPreviewMarkdown(post.bodyMarkdown),
      source: post.community ? ('community' as const) : ('course' as const),
      community: post.community,
      author: forumAuthor(post.author, access.course.ownerId),
      resolved: Boolean(post.resolvedAt),
      pinned: false,
      pinnedAt: null,
      isWelcome: Boolean(post.systemKey),
      answerCount: post._count.answers,
      commentCount: post._count.comments,
      attachmentCount: post._count.attachments,
      previewAttachments: post.attachments.map((item) => forumAttachment(courseId, item)),
      tablePreview: tablePreview(post.bodyMarkdown),
      createdAt: post.createdAt.toISOString(),
      updatedAt: post.updatedAt.toISOString(),
    });

    const mixedPosts = [...coursePosts.map(mapSummary), ...publicCommunityPosts.map(mapSummary)]
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      .slice(0, 80);

    const selectedSummary = selected
      ? {
          id: selected.id,
          title: selected.title,
          bodyPreview: bodyPreview(selected.bodyMarkdown),
          bodyPreviewMarkdown: bodyPreviewMarkdown(selected.bodyMarkdown),
          source: selected.community ? ('community' as const) : ('course' as const),
          community: selected.community,
          author: forumAuthor(selected.author, access.course.ownerId),
          resolved: Boolean(selected.resolvedAt),
          pinned: false,
          pinnedAt: null,
          isWelcome: Boolean(selected.systemKey),
          answerCount: selected._count.answers,
          commentCount: selected._count.comments,
          attachmentCount: selected._count.attachments,
          previewAttachments: selected.attachments
            .slice(0, 2)
            .map((item) => forumAttachment(courseId, item)),
          tablePreview: tablePreview(selected.bodyMarkdown),
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
        pinnedPosts: [],
        posts: mixedPosts,
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
                comments: selectedComments.map((comment) => ({
                  id: comment.id,
                  body: comment.body,
                  author: forumAuthor(comment.author, access.course.ownerId),
                  parentId: comment.parentId,
                  replyCount: comment._count.replies,
                  createdAt: comment.createdAt.toISOString(),
                  updatedAt: comment.updatedAt.toISOString(),
                })),
                commentsPage: {
                  hasMore: selectedCommentsHasMore,
                  nextOffset: selectedComments.length,
                  totalCount: selected._count.comments,
                },
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
    const access = await requireCourseForumReadAccess(courseId);
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
