import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Award, MessageCircle, Paperclip } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { forumAuthor } from '@/features/course-forum/server/course-forum-access';
import { normalizeForumMarkdownForDisplay } from '@/lib/course-forum/markdown';
import { requireUserId } from '@/lib/server/api-auth';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || '同学';
}

function attachmentUrl(attachmentId: string) {
  return `/api/forum/attachments/${encodeURIComponent(attachmentId)}`;
}

function roleBadgeClass(role: string | undefined) {
  if (role === 'admin') return 'bg-amber-50 text-amber-700 hover:bg-amber-50';
  if (role === 'teacher') return 'bg-sky-50 text-sky-700 hover:bg-sky-50';
  return 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50';
}

function visibleForumPostAccess(viewerId: string) {
  return [
    { communityId: null },
    { community: { visibility: 'public' } },
    { community: { ownerId: viewerId } },
    { community: { members: { some: { userId: viewerId } } } },
  ];
}

export default async function ForumPostPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const auth = await requireUserId({ ensureFallbackUser: false });
  if (auth.response) notFound();

  const post = await prisma.courseForumPost.findFirst({
    where: {
      id: postId,
      OR: visibleForumPostAccess(auth.userId),
    },
    select: {
      id: true,
      title: true,
      bodyMarkdown: true,
      createdAt: true,
      author: { select: { id: true, name: true, email: true, image: true, role: true } },
      community: {
        select: { id: true, slug: true, name: true, visibility: true, ownerId: true },
      },
      attachments: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, fileName: true, byteSize: true },
      },
      comments: {
        where: { parentId: null },
        orderBy: [{ qualityAnswerAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: 30,
        select: {
          id: true,
          body: true,
          qualityAnswerAt: true,
          createdAt: true,
          author: { select: { id: true, name: true, email: true, image: true, role: true } },
        },
      },
    },
  });

  if (!post) notFound();
  const author = forumAuthor(post.author, '');

  return (
    <main className="min-h-dvh bg-slate-50 p-4 text-slate-950 dark:bg-slate-950 dark:text-white sm:p-6">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-4 dark:border-white/10">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="rounded-full">
              <Link href="/forum" aria-label="返回论坛">
                <ArrowLeft className="size-5" />
              </Link>
            </Button>
            <div>
              <p className="text-xs text-slate-400">Forum post</p>
              <h1 className="text-lg font-semibold">论坛</h1>
            </div>
          </div>
        </header>

        <article className="px-5 py-6 sm:px-8">
          <div className="flex items-center gap-2.5">
            <Avatar className="size-9">
              {author.image ? <AvatarImage src={author.image} alt={author.name} /> : null}
              <AvatarFallback className="bg-violet-50 text-[10px] font-semibold text-violet-700">
                {initials(author.name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{author.name}</span>
                <Badge variant="outline">{author.forumRoleLabel}</Badge>
              </div>
              {post.community ? (
                <Link
                  href={`/communities/${encodeURIComponent(post.community.slug)}`}
                  className="text-xs font-semibold text-sky-600 hover:text-sky-700"
                >
                  c/{post.community.name}
                </Link>
              ) : null}
            </div>
          </div>

          <h2 className="mt-5 text-3xl font-bold tracking-tight">{post.title}</h2>
          <MessageResponse className="mt-5 text-[15px] leading-7 text-slate-700 dark:text-slate-200">
            {normalizeForumMarkdownForDisplay(post.bodyMarkdown)}
          </MessageResponse>

          {post.attachments.length ? (
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {post.attachments.map((attachment) => {
                const url = attachmentUrl(attachment.id);
                return (
                  <a
                    key={attachment.id}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/5"
                  >
                    <img
                      src={url}
                      alt={attachment.fileName}
                      className="max-h-80 w-full object-contain"
                    />
                    <span className="flex items-center gap-1.5 px-3 py-2 text-xs text-slate-500">
                      <Paperclip className="size-3.5" />
                      {attachment.fileName}
                    </span>
                  </a>
                );
              })}
            </div>
          ) : null}
        </article>

        <section className="border-t border-slate-200 bg-slate-50 px-5 py-5 dark:border-white/10 dark:bg-white/[0.035] sm:px-8">
          <h3 className="inline-flex items-center gap-2 text-lg font-semibold">
            <MessageCircle className="size-4" />
            评论
          </h3>
          <div className="mt-4 space-y-3">
            {post.comments.length ? (
              post.comments.map((comment) => {
                const commentAuthor = forumAuthor(comment.author, '');
                return (
                  <article
                    key={comment.id}
                    className="relative rounded-2xl border border-slate-200 bg-white p-4 pb-10 dark:border-white/10 dark:bg-slate-950"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{commentAuthor.name}</p>
                      {commentAuthor.forumRoleLabel ? (
                        <Badge
                          className={`h-4 px-1.5 text-[10px] ${roleBadgeClass(commentAuthor.forumRole)}`}
                        >
                          {commentAuthor.forumRoleLabel}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                      {comment.body}
                    </p>
                    {comment.qualityAnswerAt ? (
                      <div className="absolute right-4 bottom-3 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20">
                        <Award className="size-3" />
                        优质解答
                      </div>
                    ) : null}
                  </article>
                );
              })
            ) : (
              <p className="rounded-2xl border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-400 dark:border-white/10 dark:bg-slate-950">
                暂无评论
              </p>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
