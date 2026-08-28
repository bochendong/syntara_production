'use client';

import { useMemo, useState } from 'react';
import {
  Award,
  Download,
  Eye,
  FileImage,
  Loader2,
  MessageCircle,
  MessageSquareReply,
  PenLine,
  Pin,
  Send,
  Users,
  X,
} from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { CommunityCommentQualityAnswerButton } from '@/components/communities/community-comment-quality-answer-button';
import { CommunityPostPinButton } from '@/components/communities/community-post-pin-button';
import { StartDirectMessageButton } from '@/components/course-forum/direct-messages/start-direct-message-button';
import { ForumPostFeedCard } from '@/components/course-forum/forum-post-feed-card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { normalizeForumMarkdownForDisplay } from '@/lib/course-forum/markdown';
import type { CourseForumPostSummary } from '@/features/course-forum/domain/course-forum';
import { cn } from '@/lib/utils';
import { backendFetch } from '@/lib/utils/backend-api';

type CommunityPostAttachment = {
  id: string;
  fileName: string;
};

type CommunityPostPerson = {
  id: string;
  name: string;
  image: string | null;
  forumRole?: CourseForumPostSummary['author']['forumRole'];
  forumRoleLabel?: CourseForumPostSummary['author']['forumRoleLabel'];
};

type CommunityProfile = {
  viewerId: string;
  userId: string;
  canMessage: boolean;
  author: CourseForumPostSummary['author'];
  displayName: string;
  joinedText: string;
  communityHeading: string;
  counts: {
    posts: number;
    answers: number;
    comments: number;
  };
  recentPosts: Array<{
    id: string;
    title: string;
    bodyPreview: string;
    resolved: boolean;
    createdAt: string;
    answerCount: number;
    commentCount: number;
  }>;
};

export type CommunityPostFeedItem = {
  summary: CourseForumPostSummary;
  bodyMarkdown: string;
  author: CommunityPostPerson;
  attachments: CommunityPostAttachment[];
  answers: Array<{
    id: string;
    bodyMarkdown: string;
    accepted: boolean;
    createdAt: string;
    author: CommunityPostPerson;
  }>;
  comments: Array<{
    id: string;
    body: string;
    parentId: string | null;
    replyCount: number;
    qualityAnswer: boolean;
    qualityAnswerAt: string | null;
    createdAt: string;
    updatedAt: string;
    author: CommunityPostPerson;
  }>;
};

const MAX_COMMENT_LENGTH = 2000;

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || '成员';
}

function authorRoleBadgeClass(role: CourseForumPostSummary['author']['forumRole']) {
  if (role === 'admin')
    return 'bg-amber-50 text-amber-700 hover:bg-amber-50 dark:bg-amber-400/10 dark:text-amber-200';
  if (role === 'teacher')
    return 'bg-sky-50 text-sky-700 hover:bg-sky-50 dark:bg-sky-400/10 dark:text-sky-200';
  return 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-400/10 dark:text-emerald-200';
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

function attachmentUrl(communitySlug: string, attachmentId: string) {
  return `/api/communities/${encodeURIComponent(communitySlug)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function AuthorLine({
  author,
  time,
  label,
  onProfileOpen,
}: {
  author: CourseForumPostSummary['author'];
  time: string;
  label?: '提问者' | '评论者';
  onProfileOpen?: () => void;
}) {
  const prominent = Boolean(label);
  const avatar = (
    <Avatar size={prominent ? 'default' : 'sm'} className={prominent ? 'size-10' : 'size-7'}>
      {author.image ? <AvatarImage src={author.image} alt={author.name} /> : null}
      <AvatarFallback
        className={cn(
          'bg-violet-50 font-semibold text-violet-700',
          prominent ? 'text-xs' : 'text-[10px]',
        )}
      >
        {initials(author.name)}
      </AvatarFallback>
    </Avatar>
  );
  const name = (
    <span
      className={cn(
        'truncate text-slate-700 dark:text-slate-200',
        prominent ? 'font-semibold' : 'font-medium',
        onProfileOpen &&
          'transition hover:text-violet-700 hover:underline dark:hover:text-violet-200',
      )}
    >
      {author.name}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {onProfileOpen ? (
        <button
          type="button"
          className="shrink-0 rounded-full outline-none ring-violet-400 transition hover:ring-2 focus-visible:ring-2"
          onClick={onProfileOpen}
          aria-label={`查看 ${author.name} 的介绍页面`}
        >
          {avatar}
        </button>
      ) : (
        avatar
      )}
      <div className={cn('min-w-0', prominent ? 'text-sm' : 'text-xs')}>
        <div className="flex flex-wrap items-center gap-1.5">
          {label ? <span className="text-[11px] font-medium text-slate-400">{label}</span> : null}
          {onProfileOpen ? (
            <button type="button" className="min-w-0 text-left" onClick={onProfileOpen}>
              {name}
            </button>
          ) : (
            name
          )}
          {author.forumRoleLabel ? (
            <Badge className={cn('h-4 px-1.5 text-[10px]', authorRoleBadgeClass(author.forumRole))}>
              {author.forumRoleLabel}
            </Badge>
          ) : null}
        </div>
        <span className="text-slate-400">{relativeTime(time)}</span>
      </div>
    </div>
  );
}

function ForumMarkdown({ children }: { children: string }) {
  return (
    <MessageResponse
      mode="static"
      className="text-[15px] leading-7 text-slate-700 dark:text-slate-200 [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-950 [&_pre]:text-slate-100 dark:[&_pre]:border-white/10"
    >
      {normalizeForumMarkdownForDisplay(children)}
    </MessageResponse>
  );
}

function ForumAttachmentGallery({
  communitySlug,
  items,
}: {
  communitySlug: string;
  items: CommunityPostAttachment[];
}) {
  const [preview, setPreview] = useState<CommunityPostAttachment | null>(null);
  if (!items.length) return null;
  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2.5">
        {items.map((item) => {
          const url = attachmentUrl(communitySlug, item.id);
          return (
            <div
              key={item.id}
              className="group w-[148px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:w-[168px] dark:border-white/10 dark:bg-white/5"
            >
              <button
                type="button"
                className="block aspect-[4/3] w-full overflow-hidden bg-slate-100 text-left dark:bg-slate-900"
                onClick={() => setPreview(item)}
                aria-label={`放大查看 ${item.fileName}`}
              >
                <img
                  src={url}
                  alt={item.fileName}
                  className="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
                />
              </button>
              <div className="flex items-center gap-1.5 px-2 py-1.5">
                <FileImage className="size-3 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600 dark:text-slate-300">
                  {item.fileName}
                </span>
                <button
                  type="button"
                  onClick={() => setPreview(item)}
                  className="text-slate-400 transition hover:text-violet-600"
                  aria-label={`放大查看 ${item.fileName}`}
                >
                  <Eye className="size-3" />
                </button>
                <a
                  href={url}
                  download={item.fileName}
                  className="text-slate-400 transition hover:text-violet-600"
                  aria-label={`保存图片 ${item.fileName}`}
                >
                  <Download className="size-3" />
                </a>
              </div>
            </div>
          );
        })}
      </div>
      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="flex max-h-[92dvh] w-[min(94vw,1100px)] max-w-none flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-14 dark:border-white/10">
            <DialogTitle className="truncate">{preview?.fileName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4 dark:bg-slate-950">
            {preview ? (
              <img
                src={attachmentUrl(communitySlug, preview.id)}
                alt={preview.fileName}
                className="mx-auto h-auto max-w-full rounded-xl bg-white shadow-sm"
              />
            ) : null}
          </div>
          <DialogFooter className="border-t border-slate-200 px-5 py-3 dark:border-white/10">
            {preview ? (
              <Button asChild>
                <a href={attachmentUrl(communitySlug, preview.id)} download={preview.fileName}>
                  <Download className="mr-1.5 size-4" />
                  保存图片
                </a>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CommunityPostFeedClient({
  communitySlug,
  communityInfo,
  posts,
  pinnedPosts,
  viewerIsManager,
}: {
  communitySlug: string;
  communityInfo: {
    name: string;
    welcomeText: string | null;
    description: string | null;
    memberCount: number;
  };
  posts: CommunityPostFeedItem[];
  pinnedPosts: CommunityPostFeedItem[];
  viewerIsManager: boolean;
}) {
  const [sortMode, setSortMode] = useState<'best' | 'latest'>('latest');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [commentBody, setCommentBody] = useState('');
  const [savingComment, setSavingComment] = useState(false);
  const [commentsByPostId, setCommentsByPostId] = useState(() => {
    const map = new Map<string, CommunityPostFeedItem['comments']>();
    [...posts, ...pinnedPosts].forEach((post) => map.set(post.summary.id, post.comments));
    return map;
  });
  const postsById = useMemo(() => {
    const map = new Map<string, CommunityPostFeedItem>();
    [...posts, ...pinnedPosts].forEach((post) => map.set(post.summary.id, post));
    return map;
  }, [pinnedPosts, posts]);
  const selected = selectedId ? postsById.get(selectedId) || null : null;
  const selectedComments = selected
    ? commentsByPostId.get(selected.summary.id) || selected.comments
    : [];

  const updateCommentQualityAnswer = (
    postId: string,
    commentId: string,
    value: { qualityAnswer: boolean; qualityAnswerAt: string | null },
  ) => {
    setCommentsByPostId((current) => {
      const next = new Map(current);
      const comments = next.get(postId) || postsById.get(postId)?.comments || [];
      next.set(
        postId,
        comments
          .map((comment) =>
            comment.id === commentId
              ? {
                  ...comment,
                  qualityAnswer: value.qualityAnswer,
                  qualityAnswerAt: value.qualityAnswerAt,
                }
              : comment,
          )
          .sort((a, b) => {
            if (a.qualityAnswer !== b.qualityAnswer) return a.qualityAnswer ? -1 : 1;
            return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
          }),
      );
      return next;
    });
  };
  const visiblePosts = useMemo(() => {
    const items = [...posts];
    if (sortMode === 'latest') {
      return items.sort(
        (a, b) => new Date(b.summary.createdAt).getTime() - new Date(a.summary.createdAt).getTime(),
      );
    }
    return items.sort((a, b) => {
      const bScore = b.summary.answerCount + b.summary.commentCount;
      const aScore = a.summary.answerCount + a.summary.commentCount;
      if (bScore !== aScore) return bScore - aScore;
      return new Date(b.summary.createdAt).getTime() - new Date(a.summary.createdAt).getTime();
    });
  }, [posts, sortMode]);

  const openPost = (postId: string) => {
    setCommentBody('');
    setSelectedId(postId);
  };

  const openProfile = async (userId: string) => {
    setSelectedId(null);
    setProfileOpen(true);
    setProfileLoading(true);
    try {
      const response = await backendFetch(
        `/api/communities/${encodeURIComponent(communitySlug)}/users/${encodeURIComponent(userId)}/profile`,
        { cache: 'no-store' },
      );
      if (!response.ok) {
        setProfile(null);
        return;
      }
      setProfile((await response.json()) as CommunityProfile);
    } finally {
      setProfileLoading(false);
    }
  };

  const submitComment = async () => {
    if (!selected || savingComment) return;
    const body = commentBody.trim();
    if (!body) return;
    setSavingComment(true);
    try {
      const response = await backendFetch(
        `/api/communities/${encodeURIComponent(communitySlug)}/posts/${encodeURIComponent(selected.summary.id)}/comments`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ body }),
        },
      );
      if (!response.ok) return;
      const commentsResponse = await backendFetch(
        `/api/communities/${encodeURIComponent(communitySlug)}/posts/${encodeURIComponent(selected.summary.id)}/comments?limit=10`,
        { cache: 'no-store' },
      );
      if (commentsResponse.ok) {
        const payload = (await commentsResponse.json()) as {
          comments: CommunityPostFeedItem['comments'];
        };
        setCommentsByPostId((current) => {
          const next = new Map(current);
          next.set(selected.summary.id, payload.comments);
          return next;
        });
      }
      setCommentBody('');
    } finally {
      setSavingComment(false);
    }
  };

  return (
    <>
      <section className="min-w-0">
        <div className="mb-3 flex items-center gap-2 border-b border-slate-200 pb-3 text-sm text-slate-500 dark:border-white/10 dark:text-slate-400">
          <button
            type="button"
            className={cn(
              'rounded-md px-1 font-semibold transition hover:text-slate-900 dark:hover:text-slate-100',
              sortMode === 'best' && 'text-slate-900 dark:text-slate-100',
            )}
            onClick={() => setSortMode('best')}
          >
            Best
          </button>
          <span>·</span>
          <button
            type="button"
            className={cn(
              'rounded-md px-1 transition hover:text-slate-900 dark:hover:text-slate-100',
              sortMode === 'latest' && 'font-semibold text-slate-900 dark:text-slate-100',
            )}
            onClick={() => setSortMode('latest')}
          >
            Latest
          </button>
        </div>
        <div className="space-y-3">
          {visiblePosts.length ? (
            visiblePosts.map((post) => (
              <article
                key={post.summary.id}
                className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950"
              >
                <ForumPostFeedCard
                  post={post.summary}
                  selected={selectedId === post.summary.id}
                  onProfileOpen={() => void openProfile(post.summary.author.id)}
                  onOpen={() => openPost(post.summary.id)}
                  topRightAction={
                    viewerIsManager ? (
                      <CommunityPostPinButton
                        communitySlug={communitySlug}
                        postId={post.summary.id}
                        pinned={post.summary.pinned}
                      />
                    ) : undefined
                  }
                />
              </article>
            ))
          ) : (
            <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-400">
              这个 community 还没有帖子。
            </div>
          )}
        </div>
      </section>

      <aside className="space-y-4">
        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.035]">
          <h3 className="text-lg font-semibold">关于 c/{communityInfo.name}</h3>
          <p className="mt-3 text-sm font-semibold text-slate-900 dark:text-slate-100">
            {communityInfo.welcomeText || `欢迎来到 c/${communityInfo.name}`}
          </p>
          <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {communityInfo.description || '这个 community 还没有介绍。'}
          </p>
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-white/10 dark:bg-white/[0.04]">
            <Users className="size-4 text-violet-600" />
            <div>
              <div className="text-base font-semibold text-slate-950 dark:text-white">
                {communityInfo.memberCount}
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">members</div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-slate-50 p-5 dark:border-white/10 dark:bg-white/[0.035]">
          <div className="flex items-center gap-2">
            <Pin className="size-4 text-violet-600" />
            <h3 className="text-lg font-semibold">置顶帖子</h3>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            按置顶时间排序；中间帖子流仍按发布时间显示。
          </p>
          <div className="mt-4 space-y-3">
            {pinnedPosts.length ? (
              pinnedPosts.map((post) => (
                <div
                  key={post.summary.id}
                  className="relative rounded-xl border border-violet-100 bg-white transition hover:border-violet-200 hover:bg-violet-50/60 dark:border-violet-400/20 dark:bg-white/[0.04] dark:hover:bg-violet-400/10"
                >
                  {viewerIsManager ? (
                    <div className="absolute top-2 right-2 z-10">
                      <CommunityPostPinButton
                        communitySlug={communitySlug}
                        postId={post.summary.id}
                        pinned={post.summary.pinned}
                      />
                    </div>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openPost(post.summary.id)}
                    className="block w-full p-3 pr-24 text-left"
                  >
                    <div className="flex items-start gap-2">
                      <Pin className="mt-0.5 size-3.5 shrink-0 fill-violet-600 text-violet-600" />
                      <div className="min-w-0">
                        <h4 className="line-clamp-2 text-sm font-semibold leading-5">
                          {post.summary.title}
                        </h4>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {post.summary.bodyPreview}
                        </p>
                        <p className="mt-2 text-[11px] text-slate-400">
                          u/{post.author.name} ·{' '}
                          {relativeTime(post.summary.pinnedAt || post.summary.createdAt)}
                        </p>
                      </div>
                    </div>
                  </button>
                </div>
              ))
            ) : (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                暂无置顶帖子。
              </div>
            )}
          </div>
        </section>
      </aside>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelectedId(null)}>
        <DialogContent
          showCloseButton={false}
          className="flex flex-col overflow-hidden rounded-[28px] border-slate-200 p-0 shadow-[0_28px_90px_rgba(15,23,42,0.24)] dark:border-white/10"
          style={{
            width: 'min(96vw, 164dvh)',
            height: 'min(82dvh, 48vw)',
            maxWidth: 'none',
            maxHeight: 'none',
            aspectRatio: '2 / 1',
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>{selected?.summary.title || '帖子详情'}</DialogTitle>
            <DialogDescription>查看 community 帖子内容。</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 right-4 z-20 size-9 rounded-full border border-slate-200 bg-white/95 text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-slate-950/90 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
              aria-label="关闭帖子详情"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>
          <div className="min-h-0 flex-1 overflow-y-auto bg-white dark:bg-slate-950">
            {selected ? (
              <div className="w-full px-6 py-5 pr-16 sm:px-10 sm:py-6 sm:pr-20 lg:px-14">
                <article>
                  <div className="flex flex-col gap-3">
                    <AuthorLine
                      author={selected.summary.author}
                      time={selected.summary.createdAt}
                      label="提问者"
                      onProfileOpen={() => void openProfile(selected.summary.author.id)}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-start gap-2">
                        {selected.summary.pinned ? (
                          <Badge className="mt-1 bg-violet-600 text-white hover:bg-violet-600">
                            <Pin className="size-3 fill-current" />
                            置顶
                          </Badge>
                        ) : null}
                        <h2 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight sm:text-[28px]">
                          {selected.summary.title}
                        </h2>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4">
                    <ForumMarkdown>{selected.bodyMarkdown}</ForumMarkdown>
                    <ForumAttachmentGallery
                      communitySlug={communitySlug}
                      items={selected.attachments}
                    />
                  </div>
                </article>

                <section className="mt-6 rounded-[24px] border border-slate-200 bg-slate-100/70 p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-slate-700 text-white shadow-sm dark:bg-slate-600">
                        <MessageCircle className="size-4" />
                      </span>
                      <div>
                        <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                          评论
                        </h3>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-white/70 dark:bg-white/5">
                      {selectedComments.length} 条
                    </Badge>
                  </div>
                  <div className="mt-5 divide-y divide-slate-200/80 overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-slate-950/55">
                    {selectedComments.map((comment) => (
                      <div key={comment.id} className="relative px-4 py-3.5 pb-9">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            className="mt-0.5 shrink-0 rounded-full outline-none ring-violet-400 transition hover:ring-2 focus-visible:ring-2"
                            onClick={() => void openProfile(comment.author.id)}
                            aria-label={`查看 ${comment.author.name} 的介绍页面`}
                          >
                            <Avatar size="sm">
                              {comment.author.image ? (
                                <AvatarImage src={comment.author.image} alt={comment.author.name} />
                              ) : null}
                              <AvatarFallback className="text-[10px]">
                                {initials(comment.author.name)}
                              </AvatarFallback>
                            </Avatar>
                          </button>
                          <div className="min-w-0 flex-1 rounded-xl text-left">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                {comment.author.name}
                              </span>
                              {comment.author.forumRoleLabel ? (
                                <Badge
                                  className={cn(
                                    'h-4 px-1.5 text-[10px]',
                                    authorRoleBadgeClass(comment.author.forumRole),
                                  )}
                                >
                                  {comment.author.forumRoleLabel}
                                </Badge>
                              ) : null}
                              <span className="text-slate-400">
                                {relativeTime(comment.createdAt)}
                              </span>
                            </div>
                            <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
                              {comment.body}
                            </p>
                          </div>
                          {viewerIsManager ? (
                            <CommunityCommentQualityAnswerButton
                              communitySlug={communitySlug}
                              postId={selected.summary.id}
                              commentId={comment.id}
                              qualityAnswer={comment.qualityAnswer}
                              onChanged={(value) =>
                                updateCommentQualityAnswer(selected.summary.id, comment.id, value)
                              }
                            />
                          ) : null}
                        </div>
                        {comment.qualityAnswer ? (
                          <div className="absolute right-4 bottom-3 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20">
                            <Award className="size-3" />
                            优质解答
                          </div>
                        ) : null}
                      </div>
                    ))}
                    {!selectedComments.length ? (
                      <p className="py-6 text-center text-sm text-slate-400">暂无评论</p>
                    ) : null}
                  </div>
                </section>
              </div>
            ) : (
              <div className="grid min-h-[420px] place-items-center px-6 text-center text-sm text-slate-500">
                <div>
                  <MessageCircle className="mx-auto size-9 text-slate-300" />
                  <p className="mt-3 font-medium text-slate-700 dark:text-slate-200">
                    选择一个帖子开始阅读
                  </p>
                </div>
              </div>
            )}
          </div>
          {selected ? (
            <div className="shrink-0 border-t border-slate-200 bg-white/95 px-5 py-4 shadow-[0_-12px_32px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-950/95">
              <div className="flex gap-2">
                <Textarea
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="补充信息或追问…"
                  maxLength={MAX_COMMENT_LENGTH}
                  className="min-h-11 flex-1 resize-none rounded-xl bg-slate-50 dark:bg-slate-900"
                />
                <Button
                  className="h-auto rounded-xl bg-violet-600 px-4 hover:bg-violet-700"
                  disabled={!commentBody.trim() || savingComment}
                  onClick={() => void submitComment()}
                >
                  {savingComment ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  <span className="sr-only">发表评论</span>
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex w-[min(94vw,1024px)] max-w-none flex-col overflow-hidden rounded-[28px] border-slate-200 p-0 shadow-[0_28px_90px_rgba(15,23,42,0.24)] dark:border-white/10"
          style={{
            height: 'min(88dvh, 760px)',
            maxHeight: 'none',
          }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>成员介绍</DialogTitle>
            <DialogDescription>查看 community 成员介绍。</DialogDescription>
          </DialogHeader>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="absolute top-4 right-4 z-20 size-9 rounded-full border border-slate-200 bg-white/95 text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-slate-950/90 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-white"
              aria-label="关闭成员介绍"
            >
              <X className="size-4" />
            </Button>
          </DialogClose>

          {profileLoading ? (
            <div className="grid min-h-[420px] place-items-center text-slate-500">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : profile ? (
            <>
              <header className="shrink-0 border-b border-slate-200 px-5 py-4 pr-14 dark:border-white/10 sm:px-7">
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {profile.communityHeading}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">成员介绍</h2>
              </header>

              <section className="shrink-0 border-b border-slate-200 bg-gradient-to-br from-violet-50 via-white to-sky-50 px-5 py-6 dark:border-white/10 dark:from-violet-400/10 dark:via-white/[0.04] dark:to-sky-400/10 sm:px-7">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    <Avatar className="size-20 ring-4 ring-white dark:ring-slate-900">
                      {profile.author.image ? (
                        <AvatarImage src={profile.author.image} alt={profile.author.name} />
                      ) : null}
                      <AvatarFallback className="bg-violet-100 text-xl font-semibold text-violet-700">
                        {initials(profile.author.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-2xl font-semibold tracking-tight">
                          {profile.author.name}
                        </h3>
                        {profile.author.forumRoleLabel ? (
                          <Badge className={authorRoleBadgeClass(profile.author.forumRole)}>
                            {profile.author.forumRoleLabel}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">
                        {profile.joinedText} · 昵称来自论坛账号 {profile.displayName}
                      </p>
                    </div>
                  </div>
                  {profile.canMessage ? (
                    <div className="flex">
                      <StartDirectMessageButton
                        recipientId={profile.userId}
                        currentUserId={profile.viewerId}
                      />
                    </div>
                  ) : null}
                  <div className="grid grid-cols-3 gap-2 sm:w-72">
                    {[
                      { label: '帖子', value: profile.counts.posts },
                      { label: '解答', value: profile.counts.answers },
                      { label: '评论', value: profile.counts.comments },
                    ].map((item) => (
                      <div
                        key={item.label}
                        className="rounded-2xl border border-white/80 bg-white/75 px-3 py-3 text-center shadow-sm dark:border-white/10 dark:bg-white/5"
                      >
                        <p className="text-lg font-semibold">{item.value}</p>
                        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                          {item.label}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="min-h-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7">
                <div className="mb-4 flex items-center gap-2">
                  <PenLine className="size-4 text-violet-600" />
                  <h3 className="text-base font-semibold">最近发帖</h3>
                </div>
                {profile.recentPosts.length ? (
                  <div className="space-y-3">
                    {profile.recentPosts.map((post) => (
                      <article
                        key={post.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.035]"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <h4 className="line-clamp-2 text-base font-semibold">{post.title}</h4>
                            <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                              {post.bodyPreview}
                            </p>
                          </div>
                        </div>
                        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                          <span>{relativeTime(post.createdAt)}</span>
                          <span className="inline-flex items-center gap-1">
                            <MessageSquareReply className="size-3" />
                            {post.answerCount}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle className="size-3" />
                            {post.commentCount}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="grid min-h-52 place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.035] dark:text-slate-400">
                    这个成员还没有在课程论坛发帖。
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className="grid min-h-[420px] place-items-center px-6 text-center text-sm text-slate-500">
              成员介绍加载失败
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
