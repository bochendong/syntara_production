'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { MessageCircle, Paperclip, ThumbsUp } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { CourseForumPostSummary } from '@/features/course-forum/domain/course-forum';
import { normalizeForumMarkdownForDisplay } from '@/lib/course-forum/markdown';
import { cn } from '@/lib/utils';

function initials(name: string) {
  const compact = name.trim();
  return compact.slice(0, 2).toUpperCase() || '同学';
}

function relativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return '刚刚';
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function roleBadgeClass(role: CourseForumPostSummary['author']['forumRole']) {
  if (role === 'admin') return 'bg-amber-50 text-amber-700 hover:bg-amber-50 dark:bg-amber-400/10 dark:text-amber-200';
  if (role === 'teacher') return 'bg-sky-50 text-sky-700 hover:bg-sky-50 dark:bg-sky-400/10 dark:text-sky-200';
  return 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-400/10 dark:text-emerald-200';
}

export function ForumPostFeedCard({
  post,
  selected,
  onOpen,
  openHref,
  profileHref,
  onProfileOpen,
  pinnedVariant = false,
  topRightAction,
}: {
  post: CourseForumPostSummary;
  selected: boolean;
  onOpen?: () => void;
  openHref?: string;
  profileHref?: string;
  onProfileOpen?: () => void;
  pinnedVariant?: boolean;
  topRightAction?: ReactNode;
}) {
  const hasVisualPreview = Boolean(post.tablePreview || post.previewAttachments?.length);
  const authorBlock = (
    <>
      <Avatar size="sm" className="size-8">
        {post.author.image ? <AvatarImage src={post.author.image} alt={post.author.name} /> : null}
        <AvatarFallback className="bg-violet-50 text-[10px] font-semibold text-violet-700">
          {initials(post.author.name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
            {post.author.name}
          </span>
          {post.author.forumRoleLabel ? (
            <Badge className={cn('h-4 px-1.5 text-[10px]', roleBadgeClass(post.author.forumRole))}>
              {post.author.forumRoleLabel}
            </Badge>
          ) : null}
        </div>
        <span className="text-xs text-slate-400">{relativeTime(post.createdAt)}</span>
      </div>
    </>
  );

  return (
    <div
      className={cn(
        'flex w-full flex-col bg-white px-4 py-5 text-left transition dark:bg-slate-950',
        hasVisualPreview ? 'h-[286px]' : 'h-[210px]',
        selected &&
          'bg-violet-50/70 ring-1 ring-inset ring-violet-200 dark:bg-violet-400/[0.08] dark:ring-violet-400/20',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        {profileHref ? (
          <Link
            href={profileHref}
            className="flex min-w-0 items-center gap-2.5 rounded-xl outline-none transition hover:text-violet-700 focus-visible:ring-2 focus-visible:ring-violet-300 dark:hover:text-violet-200"
            aria-label={`查看 ${post.author.name} 的介绍页面`}
          >
            {authorBlock}
          </Link>
        ) : onProfileOpen ? (
          <button
            type="button"
            className="flex min-w-0 items-center gap-2.5 rounded-xl text-left outline-none transition hover:text-violet-700 focus-visible:ring-2 focus-visible:ring-violet-300 dark:hover:text-violet-200"
            onClick={(event) => {
              event.stopPropagation();
              onProfileOpen();
            }}
            aria-label={`查看 ${post.author.name} 的介绍页面`}
          >
            {authorBlock}
          </button>
        ) : (
          <div className="flex min-w-0 items-center gap-2.5">{authorBlock}</div>
        )}
        {topRightAction ? <div className="shrink-0">{topRightAction}</div> : null}
      </div>

      {openHref ? (
        <Link
          href={openHref}
          scroll={false}
          className="mt-3 block min-h-0 flex-1 rounded-xl text-left transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none dark:hover:bg-white/[0.035]"
        >
          <ForumPostFeedCardBody post={post} pinnedVariant={pinnedVariant} />
        </Link>
      ) : (
        <button
          type="button"
          onClick={onOpen}
          className="mt-3 block min-h-0 flex-1 rounded-xl text-left transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none dark:hover:bg-white/[0.035]"
        >
          <ForumPostFeedCardBody post={post} pinnedVariant={pinnedVariant} />
        </button>
      )}
    </div>
  );
}

function ForumPostFeedCardBody({
  post,
  pinnedVariant,
}: {
  post: CourseForumPostSummary;
  pinnedVariant: boolean;
}) {
  const activityCount = post.answerCount + post.commentCount;
  const communityName = post.source === 'community' ? post.community?.name : null;
  const previewMarkdown = normalizeForumMarkdownForDisplay(
    post.bodyPreviewMarkdown || post.bodyPreview || '暂无正文预览',
  );
  const hasVisualPreview = Boolean(post.tablePreview || post.previewAttachments?.length);
  return (
    <div className="flex h-full flex-col">
      <h2 className="line-clamp-1 text-lg font-bold leading-7 tracking-tight text-slate-950 dark:text-slate-50">
        {post.title}
      </h2>
      <MessageResponse
        className={cn(
          'mt-2 h-auto w-full overflow-hidden text-sm leading-6 text-slate-600 dark:text-slate-300',
          '[&_a]:text-slate-600 [&_a]:no-underline dark:[&_a]:text-slate-300',
          '[&_.katex-display]:my-0 [&_.katex-display]:inline-block [&_p]:m-0',
          hasVisualPreview ? 'line-clamp-1 max-h-6' : 'line-clamp-3 max-h-[72px]',
        )}
      >
        {previewMarkdown}
      </MessageResponse>

      {hasVisualPreview ? (
        <div className="mt-3 h-24 overflow-hidden">
          {post.tablePreview ? (
            <div className="h-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-slate-900/60">
              <table className="w-full table-fixed text-left text-[11px] text-slate-600 dark:text-slate-300">
                <thead className="bg-white/80 text-slate-500 dark:bg-white/5 dark:text-slate-400">
                  <tr>
                    {post.tablePreview.headers.map((header, index) => (
                      <th
                        key={`${header}-${index}`}
                        className="truncate border-b border-slate-200 px-2 py-1.5 font-semibold dark:border-white/10"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {post.tablePreview.rows.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {post.tablePreview?.headers.map((_, cellIndex) => (
                        <td
                          key={cellIndex}
                          className="truncate border-b border-slate-100 px-2 py-1.5 last:border-b-0 dark:border-white/5"
                        >
                          {row[cellIndex] || ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="grid h-full grid-cols-2 gap-2">
              {(post.previewAttachments || []).slice(0, 2).map((attachment) => (
                <div
                  key={attachment.id}
                  className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-slate-900"
                >
                  <img
                    src={attachment.url}
                    alt={attachment.fileName}
                    className="size-full object-cover"
                    loading="lazy"
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {communityName ? (
          <Badge className="h-6 rounded-md bg-sky-50 px-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 dark:bg-sky-400/10 dark:text-sky-200">
            c/{communityName}
          </Badge>
        ) : null}
        {post.attachmentCount ? (
          <div className="inline-flex items-center gap-1.5 rounded-md bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-500 dark:bg-white/10 dark:text-slate-300">
            <Paperclip className="size-3.5" />
            {post.attachmentCount} 个附件
          </div>
        ) : null}
      </div>

      <div className="mt-auto flex items-center justify-end gap-3 pt-3">
        <div className="flex items-center gap-4 text-sm font-semibold text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <MessageCircle className="size-4" />
            {activityCount}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ThumbsUp className="size-4" />0
          </span>
        </div>
      </div>
    </div>
  );
}
