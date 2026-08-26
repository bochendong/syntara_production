import { ForumHomeClient } from '@/app/forum/forum-home-client';
import { forumAuthor } from '@/features/course-forum/server/course-forum-access';
import { requireUserId } from '@/lib/server/api-auth';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

const postSelect = {
  id: true,
  title: true,
  bodyMarkdown: true,
  createdAt: true,
  updatedAt: true,
  author: { select: { id: true, name: true, email: true, image: true, role: true } },
  community: {
    select: { id: true, slug: true, name: true, visibility: true },
  },
  attachments: {
    orderBy: { createdAt: 'asc' },
    take: 2,
    select: { id: true, fileName: true },
  },
  comments: {
    orderBy: { createdAt: 'asc' },
    take: 50,
    select: {
      id: true,
      body: true,
      createdAt: true,
      author: { select: { id: true, name: true, email: true, image: true, role: true } },
    },
  },
  _count: { select: { answers: true, comments: true, attachments: true } },
} as const;

const publicCommunitySelect = {
  id: true,
  slug: true,
  name: true,
  description: true,
  avatarUrl: true,
  bannerUrl: true,
  members: {
    select: { userId: true },
  },
  _count: { select: { members: true, forumPosts: true } },
} as const;

function previewMarkdown(markdown: string) {
  const lines: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !trimmed) continue;
    lines.push(trimmed.replace(/!\[[^\]]*\]\([^)]*\)/g, '').trim());
    if (lines.length >= 3) break;
  }
  return lines.filter(Boolean).join('\n').slice(0, 240) || '暂无正文预览';
}

function attachmentUrl(attachmentId: string) {
  return `/api/forum/attachments/${encodeURIComponent(attachmentId)}`;
}

function forumRole(value: string | undefined) {
  return value === 'admin' || value === 'teacher' || value === 'student' ? value : undefined;
}

function forumRoleLabel(value: string | undefined) {
  return value === '管理员' || value === '老师' || value === '学生' ? value : undefined;
}

function safeReturnTo(value: string | string[] | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate) return null;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return null;
  if (candidate.includes('\n') || candidate.includes('\r')) return null;
  return candidate;
}

export default async function ForumHomePage({
  searchParams,
}: {
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const auth = await requireUserId({ ensureFallbackUser: false });
  if (auth.response) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-center">
        <div>
          <h1 className="text-2xl font-semibold">请先登录</h1>
          <p className="mt-2 text-sm text-slate-500">登录后可以进入论坛。</p>
        </div>
      </main>
    );
  }

  const [viewer, memberships, publicCommunities, posts] = await Promise.all([
    prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, name: true, email: true, image: true, role: true },
    }),
    prisma.communityMember.findMany({
      where: { userId: auth.userId },
      orderBy: { joinedAt: 'desc' },
      select: {
        community: {
          select: {
            id: true,
            slug: true,
            name: true,
            avatarUrl: true,
            _count: { select: { members: true, forumPosts: true } },
          },
        },
      },
    }),
    prisma.community.findMany({
      where: { visibility: 'public' },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: 80,
      select: publicCommunitySelect,
    }),
    prisma.courseForumPost.findMany({
      where: {
        systemKey: null,
        OR: [{ communityId: null }, { community: { visibility: 'public' } }],
      },
      orderBy: [{ pinnedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 80,
      select: postSelect,
    }),
  ]);

  const viewerName = viewer?.name?.trim() || viewer?.email?.split('@')[0] || '论坛成员';
  const query = searchParams ? await searchParams : {};
  const backHref =
    safeReturnTo(query.returnTo) || (viewer?.role === 'TEACHER' ? '/teacher' : '/learn');

  return (
    <ForumHomeClient
      backHref={backHref}
      viewer={{
        id: auth.userId,
        name: viewerName,
        image: viewer?.image || null,
        role: viewer?.role || null,
      }}
      communities={memberships.map(({ community }) => ({
        id: community.id,
        slug: community.slug,
        name: community.name,
        avatarUrl: community.avatarUrl,
        memberCount: community._count.members,
        postCount: community._count.forumPosts,
      }))}
      publicCommunities={publicCommunities.map((community) => ({
        id: community.id,
        slug: community.slug,
        name: community.name,
        description: community.description,
        avatarUrl: community.avatarUrl,
        bannerUrl: community.bannerUrl,
        memberCount: community._count.members,
        postCount: community._count.forumPosts,
        isJoined: community.members.some((member) => member.userId === auth.userId),
      }))}
      posts={posts.map((post) => {
        const author = forumAuthor(post.author, '');
        return {
          id: post.id,
          title: post.title,
          bodyMarkdown: post.bodyMarkdown,
          bodyPreviewMarkdown: previewMarkdown(post.bodyMarkdown),
          author: {
            id: author.id,
            name: author.name,
            image: author.image,
            forumRole: forumRole(author.forumRole),
            forumRoleLabel: forumRoleLabel(author.forumRoleLabel),
          },
          community: post.community
            ? { slug: post.community.slug, name: post.community.name }
            : null,
          course: null,
          attachments: post.attachments.map((attachment) => ({
            id: attachment.id,
            fileName: attachment.fileName,
            url: attachmentUrl(attachment.id),
          })),
          comments: post.comments.map((comment) => {
            const commentAuthor = forumAuthor(comment.author, '');
            return {
              id: comment.id,
              body: comment.body,
              createdAt: comment.createdAt.toISOString(),
              author: {
                id: commentAuthor.id,
                name: commentAuthor.name,
                image: commentAuthor.image,
                forumRole: forumRole(commentAuthor.forumRole),
                forumRoleLabel: forumRoleLabel(commentAuthor.forumRoleLabel),
              },
            };
          }),
          commentCount: post._count.comments,
          attachmentCount: post._count.attachments,
          createdAt: post.createdAt.toISOString(),
        };
      })}
    />
  );
}
