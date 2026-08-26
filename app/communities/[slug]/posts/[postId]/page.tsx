import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MessageCircle, Paperclip, Pin } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { normalizeForumMarkdownForDisplay } from '@/lib/course-forum/markdown';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';

export const dynamic = 'force-dynamic';

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || '成员';
}

function displayName(user: { name: string | null; email: string | null }) {
  return user.name?.trim() || user.email?.split('@')[0] || '社区成员';
}

function relativeTime(value: Date) {
  const elapsed = Date.now() - value.getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return '刚刚';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return value.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function attachmentUrl(slug: string, attachmentId: string) {
  return `/api/communities/${encodeURIComponent(slug)}/attachments/${encodeURIComponent(attachmentId)}`;
}

export default async function CommunityPostPage({
  params,
}: {
  params: Promise<{ slug: string; postId: string }>;
}) {
  const { slug, postId } = await params;
  const auth = await requireUserId({ ensureFallbackUser: false });
  if (auth.response) notFound();

  const community = await prisma.community.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      name: true,
      visibility: true,
      ownerId: true,
      avatarUrl: true,
      members: {
        where: { userId: auth.userId },
        select: { role: true },
        take: 1,
      },
    },
  });
  if (!community) notFound();

  const isJoined = Boolean(community.members[0]) || community.ownerId === auth.userId;
  if (community.visibility === 'private' && !isJoined) notFound();

  const post = await prisma.courseForumPost.findFirst({
    where: { id: postId, communityId: community.id },
    select: {
      id: true,
      title: true,
      bodyMarkdown: true,
      pinnedAt: true,
      createdAt: true,
      updatedAt: true,
      author: { select: { id: true, name: true, email: true, image: true } },
      attachments: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, fileName: true, byteSize: true },
      },
      answers: {
        orderBy: [{ acceptedAt: 'desc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          bodyMarkdown: true,
          acceptedAt: true,
          createdAt: true,
          author: { select: { id: true, name: true, email: true, image: true } },
          attachments: {
            orderBy: { createdAt: 'asc' },
            select: { id: true, fileName: true, byteSize: true },
          },
        },
      },
      comments: {
        where: { parentId: null },
        orderBy: { createdAt: 'asc' },
        take: 30,
        select: {
          id: true,
          body: true,
          createdAt: true,
          author: { select: { id: true, name: true, email: true, image: true } },
        },
      },
    },
  });
  if (!post) notFound();

  const authorName = displayName(post.author);

  return (
    <main className="min-h-dvh bg-slate-50 p-3 text-slate-950 dark:bg-slate-950 dark:text-white sm:p-4">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-slate-950">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-white/10 sm:px-7">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="rounded-xl">
              <Link
                href={`/communities/${encodeURIComponent(community.slug)}`}
                aria-label="返回 community"
              >
                <ArrowLeft className="size-5" />
              </Link>
            </Button>
            <Avatar className="size-10">
              {community.avatarUrl ? (
                <AvatarImage src={community.avatarUrl} alt={community.name} />
              ) : null}
              <AvatarFallback className="bg-violet-100 font-semibold text-violet-700">
                {initials(community.name)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold">c/{community.name}</h1>
              <p className="text-xs text-slate-400">Community post</p>
            </div>
          </div>
          <Button asChild variant="outline" className="rounded-xl">
            <Link href={`/communities/${encodeURIComponent(community.slug)}`}>回到 Community</Link>
          </Button>
        </header>

        <div className="px-5 py-6 sm:px-8">
          <article>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-start gap-2">
                  {post.pinnedAt ? (
                    <Badge className="mt-1 bg-violet-600 text-white hover:bg-violet-600">
                      <Pin className="size-3 fill-current" />
                      置顶
                    </Badge>
                  ) : null}
                  <h2 className="min-w-0 flex-1 text-3xl font-semibold tracking-tight">
                    {post.title}
                  </h2>
                </div>
                <div className="mt-3 flex items-center gap-2.5 text-sm text-slate-500 dark:text-slate-400">
                  <Avatar size="sm">
                    {post.author.image ? (
                      <AvatarImage src={post.author.image} alt={authorName} />
                    ) : null}
                    <AvatarFallback className="text-[10px]">{initials(authorName)}</AvatarFallback>
                  </Avatar>
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {authorName}
                  </span>
                  <span>·</span>
                  <span>{relativeTime(post.createdAt)}</span>
                </div>
              </div>
            </div>

            <div className="mt-5">
              <MessageResponse
                mode="static"
                className="text-[15px] leading-7 text-slate-700 dark:text-slate-200"
              >
                {normalizeForumMarkdownForDisplay(post.bodyMarkdown)}
              </MessageResponse>
              {post.attachments.length ? (
                <div className="mt-4 flex flex-wrap gap-2.5">
                  {post.attachments.map((attachment) => {
                    const url = attachmentUrl(community.slug, attachment.id);
                    return (
                      <a
                        key={attachment.id}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="group w-[168px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5"
                      >
                        <span className="block aspect-[4/3] overflow-hidden bg-slate-100 dark:bg-slate-900">
                          <img
                            src={url}
                            alt={attachment.fileName}
                            className="size-full object-cover transition group-hover:scale-[1.02]"
                          />
                        </span>
                        <span className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                          <Paperclip className="size-3 shrink-0" />
                          <span className="truncate">{attachment.fileName}</span>
                        </span>
                      </a>
                    );
                  })}
                </div>
              ) : null}
            </div>
          </article>

          <section className="mt-8 rounded-[24px] border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.035]">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-lg font-semibold">解答</h3>
              <Badge variant="outline">{post.answers.length} 个</Badge>
            </div>
            <div className="mt-4 space-y-3">
              {post.answers.length ? (
                post.answers.map((answer) => {
                  const name = displayName(answer.author);
                  return (
                    <article
                      key={answer.id}
                      className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-slate-950"
                    >
                      <div className="mb-3 flex items-center gap-2 text-sm">
                        <Avatar size="sm">
                          {answer.author.image ? (
                            <AvatarImage src={answer.author.image} alt={name} />
                          ) : null}
                          <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
                        </Avatar>
                        <span className="font-medium">{name}</span>
                        {answer.acceptedAt ? (
                          <Badge className="bg-emerald-600 text-white">已采纳</Badge>
                        ) : null}
                      </div>
                      <MessageResponse
                        mode="static"
                        className="text-sm leading-6 text-slate-700 dark:text-slate-200"
                      >
                        {normalizeForumMarkdownForDisplay(answer.bodyMarkdown)}
                      </MessageResponse>
                    </article>
                  );
                })
              ) : (
                <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 dark:border-white/10 dark:bg-slate-950">
                  暂无解答
                </p>
              )}
            </div>
          </section>

          <section className="mt-6 rounded-[24px] border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.035]">
            <div className="flex items-center justify-between gap-3">
              <h3 className="inline-flex items-center gap-2 text-lg font-semibold">
                <MessageCircle className="size-4" />
                评论
              </h3>
              <Badge variant="outline">{post.comments.length} 条</Badge>
            </div>
            <div className="mt-4 divide-y divide-slate-200 overflow-hidden rounded-2xl border border-slate-200 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-slate-950">
              {post.comments.length ? (
                post.comments.map((comment) => {
                  const name = displayName(comment.author);
                  return (
                    <div key={comment.id} className="flex items-start gap-3 px-4 py-3.5">
                      <Avatar size="sm">
                        {comment.author.image ? (
                          <AvatarImage src={comment.author.image} alt={name} />
                        ) : null}
                        <AvatarFallback className="text-[10px]">{initials(name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                          <span className="font-medium text-slate-700 dark:text-slate-200">
                            {name}
                          </span>
                          <span>{relativeTime(comment.createdAt)}</span>
                        </div>
                        <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
                          {comment.body}
                        </p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="py-6 text-center text-sm text-slate-400">暂无评论</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
