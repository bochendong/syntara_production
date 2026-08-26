import { notFound } from 'next/navigation';
import {
  CommunityPostFeedClient,
  type CommunityPostFeedItem,
} from '@/components/communities/community-post-feed-client';
import { CommunityBackButton } from '@/components/communities/community-back-button';
import { CommunityCreatePostButton } from '@/components/communities/community-create-post-button';
import { CommunityJoinButton } from '@/components/communities/community-join-button';
import { CommunitySettingsButton } from '@/components/communities/community-settings-button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { CourseForumPostSummary } from '@/features/course-forum/domain/course-forum';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

function initials(name: string) {
  const compact = name.trim();
  return compact.slice(0, 2).toUpperCase() || '社群';
}

function preview(markdown: string) {
  const firstContentLine =
    markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !/^[-:| ]+$/.test(line)) || '';
  return firstContentLine
    .replace(/```[\s\S]*?```/g, ' [代码] ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' [图片] ')
    .replace(/[|#>*_`$()[\]{}-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 42);
}

function previewMarkdown(markdown: string) {
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

type CommunityPagePost = {
  id: string;
  title: string;
  bodyMarkdown: string;
  resolvedAt: Date | null;
  pinnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  author: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    role: string | null;
  };
  attachments: Array<{ id: string; fileName: string }>;
  answers: Array<{
    id: string;
    bodyMarkdown: string;
    acceptedAt: Date | null;
    createdAt: Date;
    author: {
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
      role: string | null;
    };
  }>;
  comments: Array<{
    id: string;
    body: string;
    parentId: string | null;
    createdAt: Date;
    updatedAt: Date;
    author: {
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
      role: string | null;
    };
    _count: { replies: number };
  }>;
  _count: { answers: number; comments: number; attachments: number };
};

function toForumSummary(
  post: CommunityPagePost,
  community: { id: string; slug: string; name: string; visibility: string },
): CourseForumPostSummary {
  const authorName = post.author.name?.trim() || post.author.email?.split('@')[0] || '社区成员';
  return {
    id: post.id,
    title: post.title,
    bodyPreview: preview(post.bodyMarkdown),
    bodyPreviewMarkdown: previewMarkdown(post.bodyMarkdown),
    source: 'community',
    community: {
      id: community.id,
      slug: community.slug,
      name: community.name,
      visibility: community.visibility,
    },
    author: {
      id: post.author.id,
      name: authorName,
      image: post.author.image,
      isTeacher: post.author.role === 'TEACHER' || post.author.role === 'ADMIN',
      forumRole:
        post.author.role === 'ADMIN'
          ? 'admin'
          : post.author.role === 'TEACHER'
            ? 'teacher'
            : 'student',
      forumRoleLabel:
        post.author.role === 'ADMIN' ? '管理员' : post.author.role === 'TEACHER' ? '老师' : '学生',
    },
    resolved: Boolean(post.resolvedAt),
    pinned: Boolean(post.pinnedAt),
    pinnedAt: post.pinnedAt ? post.pinnedAt.toISOString() : null,
    isWelcome: false,
    answerCount: post._count.answers,
    commentCount: post._count.comments,
    attachmentCount: post._count.attachments,
    previewAttachments: post.attachments.slice(0, 2).map((attachment) => {
      const url = `/api/communities/${encodeURIComponent(community.slug)}/attachments/${encodeURIComponent(attachment.id)}`;
      return {
        id: attachment.id,
        fileName: attachment.fileName,
        url,
        downloadUrl: `${url}?download=1`,
      };
    }),
    tablePreview: tablePreview(post.bodyMarkdown),
    createdAt: post.createdAt.toISOString(),
    updatedAt: post.updatedAt.toISOString(),
  };
}

function membershipLabel(role: string | null | undefined, isOwner: boolean) {
  if (isOwner || role === 'owner' || role === 'admin' || role === 'manager') return '管理者';
  if (role) return '成员';
  return '未加入';
}

function isManager(role: string | null | undefined, isOwner: boolean) {
  return isOwner || role === 'owner' || role === 'admin' || role === 'manager';
}

function roleBadgeValue(role: string | null): CourseForumPostSummary['author']['forumRole'] {
  if (role === 'ADMIN') return 'admin';
  if (role === 'TEACHER') return 'teacher';
  return 'student';
}

function roleBadgeLabel(role: string | null): CourseForumPostSummary['author']['forumRoleLabel'] {
  if (role === 'ADMIN') return '管理员';
  if (role === 'TEACHER') return '老师';
  return '学生';
}

function serializePost(
  post: CommunityPagePost,
  community: { id: string; slug: string; name: string; visibility: string },
): CommunityPostFeedItem {
  const summary = toForumSummary(post, community);
  const person = (user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    role: string | null;
  }) => ({
    id: user.id,
    name: user.name?.trim() || user.email?.split('@')[0] || '社区成员',
    image: user.image,
    forumRole: roleBadgeValue(user.role),
    forumRoleLabel: roleBadgeLabel(user.role),
  });
  return {
    summary,
    bodyMarkdown: post.bodyMarkdown,
    author: person(post.author),
    attachments: post.attachments,
    answers: post.answers.map((answer) => ({
      id: answer.id,
      bodyMarkdown: answer.bodyMarkdown,
      accepted: Boolean(answer.acceptedAt),
      createdAt: answer.createdAt.toISOString(),
      author: person(answer.author),
    })),
    comments: post.comments.map((comment) => ({
      id: comment.id,
      body: comment.body,
      parentId: comment.parentId,
      replyCount: comment._count.replies,
      createdAt: comment.createdAt.toISOString(),
      updatedAt: comment.updatedAt.toISOString(),
      author: person(comment.author),
    })),
  };
}

export default async function CommunityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const auth = await requireUserId({ ensureFallbackUser: false });
  if (auth.response) notFound();

  const community = await prisma.community.findUnique({
    where: { slug },
    select: {
      id: true,
      ownerId: true,
      slug: true,
      name: true,
      welcomeText: true,
      description: true,
      avatarUrl: true,
      bannerUrl: true,
      visibility: true,
      createdAt: true,
      members: {
        where: { userId: auth.userId },
        select: { role: true, joinedAt: true },
        take: 1,
      },
      _count: { select: { members: true, posts: true, forumPosts: true } },
    },
  });

  if (!community) notFound();

  const membership = community.members[0] || null;
  const isJoined = Boolean(membership);
  const viewerIsOwner = community.ownerId === auth.userId;
  const viewerIsManager = isManager(membership?.role, viewerIsOwner);
  const viewerMembershipLabel = membershipLabel(membership?.role, viewerIsOwner);

  if (community.visibility === 'private' && !isJoined && !viewerIsOwner) {
    notFound();
  }

  const posts = await prisma.courseForumPost.findMany({
    where: { communityId: community.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: {
      id: true,
      title: true,
      bodyMarkdown: true,
      resolvedAt: true,
      pinnedAt: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true, email: true, image: true, role: true } },
      attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, fileName: true } },
      answers: {
        orderBy: [{ acceptedAt: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          bodyMarkdown: true,
          acceptedAt: true,
          createdAt: true,
          author: { select: { id: true, name: true, email: true, image: true, role: true } },
        },
      },
      comments: {
        where: { parentId: null },
        orderBy: { createdAt: 'asc' },
        take: 30,
        select: {
          id: true,
          body: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, email: true, image: true, role: true } },
          _count: { select: { replies: true } },
        },
      },
      _count: { select: { answers: true, comments: true, attachments: true } },
    },
  });
  const pinnedPosts = await prisma.courseForumPost.findMany({
    where: { communityId: community.id, pinnedAt: { not: null } },
    orderBy: [{ pinnedAt: 'desc' }, { createdAt: 'desc' }],
    take: 12,
    select: {
      id: true,
      title: true,
      bodyMarkdown: true,
      resolvedAt: true,
      pinnedAt: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true, email: true, image: true, role: true } },
      attachments: { orderBy: { createdAt: 'asc' }, select: { id: true, fileName: true } },
      answers: {
        orderBy: [{ acceptedAt: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          bodyMarkdown: true,
          acceptedAt: true,
          createdAt: true,
          author: { select: { id: true, name: true, email: true, image: true, role: true } },
        },
      },
      comments: {
        where: { parentId: null },
        orderBy: { createdAt: 'asc' },
        take: 30,
        select: {
          id: true,
          body: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          author: { select: { id: true, name: true, email: true, image: true, role: true } },
          _count: { select: { replies: true } },
        },
      },
      _count: { select: { answers: true, comments: true, attachments: true } },
    },
  });
  const serializedPosts = posts.map((post) => serializePost(post, community));
  const serializedPinnedPosts = pinnedPosts.map((post) => serializePost(post, community));

  return (
    <main className="min-h-dvh bg-slate-50 p-3 text-slate-950 dark:bg-slate-950 dark:text-white sm:p-4">
      <div className="mx-auto min-h-[calc(100dvh-24px)] max-w-7xl overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-slate-950 sm:min-h-[calc(100dvh-32px)]">
        <section className="relative">
          <CommunityBackButton />
          <div className="h-56 bg-sky-100 dark:bg-sky-950 sm:h-72">
            {community.bannerUrl ? (
              <img src={community.bannerUrl} alt="" className="size-full object-cover opacity-85" />
            ) : (
              <div className="size-full bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.35),transparent_28%),radial-gradient(circle_at_72%_22%,rgba(124,58,237,0.28),transparent_30%),linear-gradient(135deg,#dbeafe,#f5f3ff)] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.28),transparent_28%),radial-gradient(circle_at_72%_22%,rgba(124,58,237,0.32),transparent_30%),linear-gradient(135deg,#0f172a,#111827)]" />
            )}
          </div>

          <div className="px-5 pb-5 sm:px-8">
            <div className="relative flex flex-col gap-4 pt-7 sm:min-h-28 sm:flex-row sm:justify-between sm:pt-8">
              <div className="min-w-0">
                <div className="absolute -top-12 left-0 sm:-top-14">
                  {viewerIsManager ? (
                    <CommunitySettingsButton
                      communitySlug={community.slug}
                      triggerLabel="打开 Community 设置"
                      triggerClassName="shrink-0 rounded-full outline-none ring-violet-400 transition hover:scale-[1.02] hover:ring-4 focus-visible:ring-4"
                    >
                      <Avatar className="size-20 border-4 border-white bg-white shadow-lg dark:border-slate-950 dark:bg-slate-950 sm:size-24">
                        {community.avatarUrl ? (
                          <AvatarImage src={community.avatarUrl} alt={community.name} />
                        ) : null}
                        <AvatarFallback className="bg-violet-100 text-2xl font-semibold text-violet-700">
                          {initials(community.name)}
                        </AvatarFallback>
                      </Avatar>
                    </CommunitySettingsButton>
                  ) : (
                    <Avatar className="size-20 border-4 border-white bg-white shadow-lg dark:border-slate-950 dark:bg-slate-950 sm:size-24">
                      {community.avatarUrl ? (
                        <AvatarImage src={community.avatarUrl} alt={community.name} />
                      ) : null}
                      <AvatarFallback className="bg-violet-100 text-2xl font-semibold text-violet-700">
                        {initials(community.name)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                </div>
                <div
                  className="min-w-0 pb-1"
                  style={{ marginLeft: '7rem', transform: 'translateY(-1.5rem)' }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-3xl font-bold tracking-tight sm:text-4xl">
                      c/{community.name}
                    </h1>
                    <Badge variant="outline" className="bg-white/80 dark:bg-white/5">
                      {community.visibility === 'public' ? 'Public' : community.visibility}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                    /communities/{community.slug}
                  </p>
                  <p className="mt-1 text-sm font-semibold text-violet-700 dark:text-violet-300">
                    {viewerMembershipLabel}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1 sm:pt-0">
                {viewerIsManager ? (
                  <CommunitySettingsButton communitySlug={community.slug} />
                ) : null}
                <CommunityCreatePostButton communitySlug={community.slug} disabled={!isJoined} />
                <CommunityJoinButton
                  communitySlug={community.slug}
                  isJoined={isJoined}
                  visibility={community.visibility}
                />
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-5 px-5 pb-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_320px]">
          <CommunityPostFeedClient
            communitySlug={community.slug}
            communityInfo={{
              name: community.name,
              welcomeText: community.welcomeText,
              description: community.description,
              memberCount: community._count.members,
            }}
            posts={serializedPosts}
            pinnedPosts={serializedPinnedPosts}
            viewerIsManager={viewerIsManager}
          />
        </div>
      </div>
    </main>
  );
}
