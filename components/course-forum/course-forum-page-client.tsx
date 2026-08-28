'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  Award,
  ChevronDown,
  Download,
  Eye,
  FileImage,
  ImagePlus,
  Loader2,
  MessageCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { DirectMessageInboxButton } from '@/components/course-forum/direct-messages/direct-message-inbox-button';
import { ForumPostFeedCard } from '@/components/course-forum/forum-post-feed-card';
import { normalizeForumMarkdownForDisplay } from '@/lib/course-forum/markdown';
import { ForumMarkdownEditor } from '@/components/course-forum/forum-markdown-editor';
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
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type {
  CourseForumAttachmentItem,
  CourseForumAuthor,
  CourseForumCommentItem,
  CourseForumSnapshot,
  CourseForumStatusFilter,
} from '@/features/course-forum/domain/course-forum';
import { buildCourseForumMockSnapshot } from '@/features/course-forum/mock/course-forum-mock';
import { cn } from '@/lib/utils';
import { backendFetch, backendJson } from '@/lib/utils/backend-api';
import { AVATAR_OPTIONS, useUserProfileStore } from '@/lib/store/user-profile';

const TERM_LABEL = { winter: 'Winter', summer: 'Summer', fall: 'Fall' } as const;
const COMMENT_PAGE_SIZE = 10;
const REPLY_PAGE_SIZE = 5;
const MAX_COMMENT_LENGTH = 2000;

type CourseForumCommentsPageResponse = {
  comments: CourseForumCommentItem[];
  hasMore: boolean;
  nextOffset: number;
  totalCount: number;
};

type CourseForumRepliesPageResponse = {
  replies: CourseForumCommentItem[];
  hasMore: boolean;
  nextOffset: number;
  totalCount: number;
};

type CommentRepliesState = {
  items: CourseForumCommentItem[];
  hasMore: boolean;
  nextOffset: number;
  totalCount: number;
  loading: boolean;
};

type CommunityMenuItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  postCount: number;
};

type CommunitiesMenuResponse = {
  communities: CommunityMenuItem[];
};

type PublicCommunitySearchItem = CommunityMenuItem & {
  bannerUrl: string | null;
  isJoined: boolean;
};

type PublicCommunitySearchResponse = {
  communities: PublicCommunitySearchItem[];
};

type CreateCommunityResponse = {
  community: CommunityMenuItem;
};

function initials(name: string) {
  const compact = name.trim();
  return compact.slice(0, 2).toUpperCase() || '同学';
}

function authorRoleBadgeClass(role: CourseForumAuthor['forumRole']) {
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

function AuthorLine({
  author,
  time,
  label,
  profileHref,
}: {
  author: CourseForumAuthor;
  time: string;
  label?: '提问者' | '回答者' | '评论者';
  profileHref?: string;
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
        profileHref &&
          'transition hover:text-violet-700 hover:underline dark:hover:text-violet-200',
      )}
    >
      {author.name}
    </span>
  );
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {profileHref ? (
        <Link
          href={profileHref}
          className="shrink-0 rounded-full outline-none ring-violet-400 transition hover:ring-2 focus-visible:ring-2"
          aria-label={`查看 ${author.name} 的介绍页面`}
        >
          {avatar}
        </Link>
      ) : (
        avatar
      )}
      <div className={cn('min-w-0', prominent ? 'text-sm' : 'text-xs')}>
        <div className="flex flex-wrap items-center gap-1.5">
          {label ? <span className="text-[11px] font-medium text-slate-400">{label}</span> : null}
          {profileHref ? <Link href={profileHref}>{name}</Link> : name}
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
  const normalized = normalizeForumMarkdownForDisplay(children);
  return (
    <MessageResponse
      mode="static"
      className="text-[15px] leading-7 text-slate-700 dark:text-slate-200 [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-950 [&_pre]:text-slate-100 dark:[&_pre]:border-white/10"
    >
      {normalized}
    </MessageResponse>
  );
}

function ForumAttachmentGallery({ items }: { items: CourseForumAttachmentItem[] }) {
  const [preview, setPreview] = useState<CourseForumAttachmentItem | null>(null);
  if (!items.length) return null;
  return (
    <>
      <div className="mt-4 flex flex-wrap gap-2.5">
        {items.map((item) => (
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
                src={item.url}
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
                href={item.downloadUrl}
                download={item.fileName}
                className="text-slate-400 transition hover:text-violet-600"
                aria-label={`保存图片 ${item.fileName}`}
              >
                <Download className="size-3" />
              </a>
            </div>
          </div>
        ))}
      </div>
      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreview(null)}>
        <DialogContent className="flex max-h-[92dvh] w-[min(94vw,1100px)] max-w-none flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-14 dark:border-white/10">
            <DialogTitle className="truncate">{preview?.fileName}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4 dark:bg-slate-950">
            {preview ? (
              <img
                src={preview.url}
                alt={preview.fileName}
                className="mx-auto h-auto max-w-full rounded-xl bg-white shadow-sm"
              />
            ) : null}
          </div>
          <DialogFooter className="border-t border-slate-200 px-5 py-3 dark:border-white/10">
            {preview ? (
              <Button asChild>
                <a href={preview.downloadUrl} download={preview.fileName}>
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

function forumUserHref(courseId: string, userId: string) {
  return `/course/${encodeURIComponent(courseId)}/forum/users/${encodeURIComponent(userId)}`;
}

function ImagePicker({
  files,
  onChange,
  inputRef,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3 dark:border-white/15 dark:bg-white/5">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
        <ImagePlus className="size-4 text-violet-600" />
        添加图片
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          multiple
          className="sr-only"
          onChange={(event) => onChange(Array.from(event.target.files || []).slice(0, 5))}
        />
      </label>
      <p className="mt-1 text-xs text-slate-400">
        最多 5 张，单张不超过 5 MB；发布后统一显示在帖子正文下方。
      </p>
      {files.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {files.map((file, index) => (
            <button
              type="button"
              key={`${file.name}-${file.size}-${index}`}
              className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 shadow-sm dark:bg-white/10 dark:text-slate-200"
              onClick={() => onChange(files.filter((_, fileIndex) => fileIndex !== index))}
              title="点击移除"
            >
              <Paperclip className="size-3" />
              <span className="max-w-40 truncate">{file.name}</span>
              <span className="text-slate-400">×</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

async function requestError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

export function CourseForumPageClient({
  courseId,
  initialSnapshot,
  disableProfileSync = false,
  mockMode = false,
}: {
  courseId: string;
  initialSnapshot?: CourseForumSnapshot;
  disableProfileSync?: boolean;
  mockMode?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialUrlPostId = searchParams.get('postId') || '';
  const forumEntrySource =
    searchParams.get('from') === 'home' || searchParams.get('from') === 'course'
      ? searchParams.get('from')
      : '';
  const profileNickname = useUserProfileStore((state) => state.nickname);
  const profileAvatar = useUserProfileStore((state) => state.avatar);
  const profileBio = useUserProfileStore((state) => state.bio);
  const setProfileNickname = useUserProfileStore((state) => state.setNickname);
  const setProfileAvatar = useUserProfileStore((state) => state.setAvatar);
  const setProfileBio = useUserProfileStore((state) => state.setBio);
  const [snapshot, setSnapshot] = useState<CourseForumSnapshot | null>(initialSnapshot || null);
  const [filter, setFilter] = useState<CourseForumStatusFilter>('all');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [publicCommunityResults, setPublicCommunityResults] = useState<PublicCommunitySearchItem[]>(
    [],
  );
  const [selectedPostId, setSelectedPostId] = useState(initialSnapshot?.selectedPost?.id || '');
  const [loading, setLoading] = useState(!initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [postDetailOpen, setPostDetailOpen] = useState(false);
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postImages, setPostImages] = useState<File[]>([]);
  const [commentBody, setCommentBody] = useState('');
  const [replyTarget, setReplyTarget] = useState<CourseForumCommentItem | null>(null);
  const [commentReplies, setCommentReplies] = useState<Record<string, CommentRepliesState>>({});
  const [savingAction, setSavingAction] = useState('');
  const [loadingMoreComments, setLoadingMoreComments] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileAvatarDraft, setProfileAvatarDraft] = useState('');
  const [profileBioDraft, setProfileBioDraft] = useState('');
  const [sidebarCommunitiesOpen, setSidebarCommunitiesOpen] = useState(true);
  const [communityMenuLoading, setCommunityMenuLoading] = useState(false);
  const [communities, setCommunities] = useState<CommunityMenuItem[]>([]);
  const [createCommunityOpen, setCreateCommunityOpen] = useState(false);
  const [communityNameDraft, setCommunityNameDraft] = useState('');
  const [communitySlugDraft, setCommunitySlugDraft] = useState('');
  const [communityDescriptionDraft, setCommunityDescriptionDraft] = useState('');
  const [communityPrivacyDraft, setCommunityPrivacyDraft] = useState<'public' | 'private'>(
    'public',
  );
  const [creatingCommunity, setCreatingCommunity] = useState(false);
  const lastProfileSyncKeyRef = useRef('');
  const commentsSentinelRef = useRef<HTMLDivElement | null>(null);
  const communitiesLoadedRef = useRef(false);
  const communitiesLoadingRef = useRef(false);
  const mockAsTeacher = initialSnapshot?.viewer.accessRole === 'owner';

  const load = useCallback(
    async (options?: { postId?: string; quiet?: boolean; status?: CourseForumStatusFilter }) => {
      if (options?.quiet) setRefreshing(true);
      else setLoading(true);
      try {
        const status = options?.status || filter;
        const postId = options?.postId || '';
        if (mockMode) {
          const next = buildCourseForumMockSnapshot({
            courseId,
            status,
            q: search,
            postId,
            asTeacher: mockAsTeacher,
          });
          setSnapshot(next);
          setSelectedPostId(next.selectedPost?.id || '');
          setError('');
          return;
        }
        const params = new URLSearchParams({ status });
        if (search) params.set('q', search);
        if (postId) params.set('postId', postId);
        const [next, communitySearch] = await Promise.all([
          backendJson<CourseForumSnapshot>(
            `/api/course-forum/${encodeURIComponent(courseId)}?${params.toString()}`,
            { timeoutMs: 45_000 },
          ),
          search
            ? backendJson<PublicCommunitySearchResponse>(
                `/api/communities/public-search?q=${encodeURIComponent(search)}`,
                { timeoutMs: 20_000 },
              )
            : Promise.resolve({ communities: [] }),
        ]);
        setSnapshot(next);
        setPublicCommunityResults(communitySearch.communities);
        setSelectedPostId(next.selectedPost?.id || '');
        setError('');
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : '论坛加载失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [courseId, filter, mockAsTeacher, mockMode, search],
  );

  useEffect(() => {
    if (mockMode) {
      void load({ postId: selectedPostId, quiet: true, status: filter });
      return;
    }
    if (initialSnapshot) return;
    void load({ postId: initialUrlPostId || undefined });
  }, [filter, initialSnapshot, initialUrlPostId, load, mockMode, search]);

  useEffect(() => {
    if (disableProfileSync || mockMode) return;
    const name = profileNickname.trim();
    const image = profileAvatar.trim();
    if (!name && !image) return;
    const syncKey = `${name}\u0000${image}`;
    if (lastProfileSyncKeyRef.current === syncKey) return;
    lastProfileSyncKeyRef.current = syncKey;

    void backendFetch('/api/me', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: name || undefined, image: image || undefined }),
      timeoutMs: 12_000,
    }).then((response) => {
      if (response.ok) void load({ postId: selectedPostId, quiet: true });
    });
  }, [disableProfileSync, load, profileAvatar, profileNickname, selectedPostId]);

  useEffect(() => {
    if (!profileOpen) return;
    setProfileNameDraft(profileNickname.trim());
    setProfileAvatarDraft(profileAvatar.trim());
    setProfileBioDraft(profileBio.trim());
  }, [profileAvatar, profileBio, profileNickname, profileOpen]);

  const selected = snapshot?.selectedPost || null;
  const isTeacher = snapshot?.viewer.accessRole === 'owner';
  const term = snapshot?.course.term ? TERM_LABEL[snapshot.course.term] : null;
  const courseHeading = snapshot
    ? [snapshot.course.code, snapshot.course.academicYear, term].filter(Boolean).join(' · ')
    : '课程论坛';
  const viewerName = profileNickname.trim() || snapshot?.viewer.name || '课程同学';
  const viewerAvatar = profileAvatar.trim() || snapshot?.viewer.image || '';
  const viewerBio = profileBio.trim();
  const forumBackHref =
    forumEntrySource === 'home'
      ? isTeacher
        ? '/teacher'
        : '/learn'
      : isTeacher
        ? `/teacher/courses/${courseId}`
        : `/learn?courseId=${encodeURIComponent(courseId)}`;
  const buildForumHref = (postId?: string) => {
    const params = new URLSearchParams();
    if (forumEntrySource) params.set('from', forumEntrySource);
    if (postId) params.set('postId', postId);
    const query = params.toString();
    return `/course/${encodeURIComponent(courseId)}/forum${query ? `?${query}` : ''}`;
  };

  const openPost = (postId: string) => {
    setSelectedPostId(postId);
    setPostDetailOpen(true);
    setReplyTarget(null);
    setCommentReplies({});
    router.replace(buildForumHref(postId), { scroll: false });
    void load({ postId });
  };

  useEffect(() => {
    if (!initialUrlPostId) return;
    setSelectedPostId(initialUrlPostId);
    setPostDetailOpen(true);
    setReplyTarget(null);
    setCommentReplies({});
  }, [initialUrlPostId]);

  const setPostDetailDialogOpen = (open: boolean) => {
    setPostDetailOpen(open);
    if (!open && initialUrlPostId) {
      router.replace(buildForumHref(), { scroll: false });
    }
  };

  const saveProfile = () => {
    const nextName = profileNameDraft.trim().slice(0, 60);
    const nextAvatar = profileAvatarDraft.trim().slice(0, 2000) || AVATAR_OPTIONS[0] || '';
    const nextBio = profileBioDraft.trim().slice(0, 160);
    setProfileNickname(nextName);
    setProfileAvatar(nextAvatar);
    setProfileBio(nextBio);
    setProfileOpen(false);
  };

  const normalizeCommunitySlug = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);

  const createCommunity = async () => {
    const name = communityNameDraft.trim();
    const slug = normalizeCommunitySlug(communitySlugDraft || communityNameDraft);
    const description = communityDescriptionDraft.trim();
    if (!name || !slug || !description || creatingCommunity) return;
    setCreatingCommunity(true);
    setError('');
    try {
      const payload = await backendJson<CreateCommunityResponse>('/api/communities', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          courseId,
          name,
          slug,
          description,
          privacy: communityPrivacyDraft,
        }),
        timeoutMs: 20_000,
      });
      communitiesLoadedRef.current = true;
      setCommunities((current) => {
        const withoutDuplicate = current.filter(
          (community) => community.id !== payload.community.id,
        );
        return [payload.community, ...withoutDuplicate];
      });
      setCreateCommunityOpen(false);
      setCommunityNameDraft('');
      setCommunitySlugDraft('');
      setCommunityDescriptionDraft('');
      setCommunityPrivacyDraft('public');
      router.push(`/communities/${encodeURIComponent(payload.community.slug)}`);
    } catch (communityError) {
      setError(communityError instanceof Error ? communityError.message : 'Community 创建失败');
    } finally {
      setCreatingCommunity(false);
    }
  };

  const loadCommunities = useCallback(async (options?: { force?: boolean }) => {
    if (!options?.force && (communitiesLoadedRef.current || communitiesLoadingRef.current)) return;
    communitiesLoadingRef.current = true;
    setCommunityMenuLoading(true);
    try {
      const payload = await backendJson<CommunitiesMenuResponse>('/api/communities', {
        timeoutMs: 20_000,
      });
      communitiesLoadedRef.current = true;
      setCommunities(payload.communities);
    } catch (communityError) {
      setError(communityError instanceof Error ? communityError.message : 'Community 加载失败');
    } finally {
      communitiesLoadingRef.current = false;
      setCommunityMenuLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCommunities();
  }, [loadCommunities]);

  const toggleSidebarCommunities = () => {
    setSidebarCommunitiesOpen((open) => !open);
  };

  const loadMoreComments = useCallback(async () => {
    const current = snapshot?.selectedPost;
    if (
      !current ||
      mockMode ||
      loadingMoreComments ||
      savingAction ||
      !current.commentsPage.hasMore
    ) {
      return;
    }
    setLoadingMoreComments(true);
    setError('');
    try {
      const params = new URLSearchParams({
        offset: String(current.commentsPage.nextOffset),
        limit: String(COMMENT_PAGE_SIZE),
      });
      const page = await backendJson<CourseForumCommentsPageResponse>(
        `/api/course-forum/${encodeURIComponent(courseId)}/posts/${encodeURIComponent(
          current.id,
        )}/comments?${params.toString()}`,
        { timeoutMs: 20_000 },
      );
      setSnapshot((previous) => {
        const selectedPost = previous?.selectedPost;
        if (!previous || !selectedPost || selectedPost.id !== current.id) return previous;
        const existingIds = new Set(selectedPost.comments.map((comment) => comment.id));
        const nextComments = [
          ...selectedPost.comments,
          ...page.comments.filter((comment) => !existingIds.has(comment.id)),
        ];
        return {
          ...previous,
          selectedPost: {
            ...selectedPost,
            commentCount: page.totalCount,
            comments: nextComments,
            commentsPage: {
              hasMore: page.hasMore,
              nextOffset: page.nextOffset,
              totalCount: page.totalCount,
            },
          },
        };
      });
    } catch (commentsError) {
      setError(commentsError instanceof Error ? commentsError.message : '加载更多评论失败');
    } finally {
      setLoadingMoreComments(false);
    }
  }, [courseId, loadingMoreComments, mockMode, savingAction, snapshot?.selectedPost]);

  useEffect(() => {
    const sentinel = commentsSentinelRef.current;
    if (!sentinel || !selected?.commentsPage.hasMore || mockMode) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMoreComments();
      },
      { rootMargin: '320px 0px' },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMoreComments, mockMode, selected?.commentsPage.hasMore, selected?.id]);

  const loadCommentReplies = useCallback(
    async (comment: CourseForumCommentItem, reset = false) => {
      const current = snapshot?.selectedPost;
      if (!current || mockMode || savingAction) return;
      const existing = commentReplies[comment.id];
      if (!reset && existing && (existing.loading || !existing.hasMore)) return;
      const offset = reset ? 0 : existing?.nextOffset || 0;
      setCommentReplies((previous) => ({
        ...previous,
        [comment.id]: {
          items: reset ? [] : previous[comment.id]?.items || [],
          hasMore: previous[comment.id]?.hasMore ?? true,
          nextOffset: offset,
          totalCount: previous[comment.id]?.totalCount ?? comment.replyCount,
          loading: true,
        },
      }));
      try {
        const params = new URLSearchParams({
          offset: String(offset),
          limit: String(REPLY_PAGE_SIZE),
        });
        const page = await backendJson<CourseForumRepliesPageResponse>(
          `/api/course-forum/${encodeURIComponent(courseId)}/posts/${encodeURIComponent(
            current.id,
          )}/comments/${encodeURIComponent(comment.id)}/replies?${params.toString()}`,
          { timeoutMs: 20_000 },
        );
        setCommentReplies((previous) => {
          const prevItems = reset ? [] : previous[comment.id]?.items || [];
          const existingIds = new Set(prevItems.map((item) => item.id));
          const nextItems = [
            ...prevItems,
            ...page.replies.filter((reply) => !existingIds.has(reply.id)),
          ];
          return {
            ...previous,
            [comment.id]: {
              items: nextItems,
              hasMore: page.hasMore,
              nextOffset: page.nextOffset,
              totalCount: page.totalCount,
              loading: false,
            },
          };
        });
      } catch (replyError) {
        setError(replyError instanceof Error ? replyError.message : '加载回复失败');
        setCommentReplies((previous) => ({
          ...previous,
          [comment.id]: {
            items: previous[comment.id]?.items || [],
            hasMore: previous[comment.id]?.hasMore ?? true,
            nextOffset: previous[comment.id]?.nextOffset || offset,
            totalCount: previous[comment.id]?.totalCount ?? comment.replyCount,
            loading: false,
          },
        }));
      }
    },
    [commentReplies, courseId, mockMode, savingAction, snapshot?.selectedPost],
  );

  const startReplyToComment = (comment: CourseForumCommentItem) => {
    setReplyTarget(comment);
    if (comment.replyCount > 0 && !commentReplies[comment.id]) {
      void loadCommentReplies(comment, true);
    }
  };

  const createPost = async () => {
    if (!postTitle.trim() || !postBody.trim() || savingAction) return;
    if (mockMode) {
      setError('Mock 模式仅用于 UI 预览，发布不会写入服务器。');
      return;
    }
    setSavingAction('post');
    setError('');
    try {
      const form = new FormData();
      form.set('title', postTitle.trim());
      form.set('bodyMarkdown', postBody.trim());
      postImages.forEach((file) => form.append('images', file));
      const response = await backendFetch(`/api/course-forum/${encodeURIComponent(courseId)}`, {
        method: 'POST',
        body: form,
        timeoutMs: 30_000,
      });
      if (!response.ok) throw new Error(await requestError(response, '发布问题失败'));
      const payload = (await response.json()) as { postId: string };
      setNewPostOpen(false);
      setPostTitle('');
      setPostBody('');
      setPostImages([]);
      setFilter('all');
      setSelectedPostId(payload.postId);
      await load({ postId: payload.postId, quiet: true, status: 'all' });
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : '发布问题失败');
    } finally {
      setSavingAction('');
    }
  };

  const submitComment = async () => {
    if (!selected || !commentBody.trim() || savingAction) return;
    if (mockMode) {
      setError('Mock 模式仅用于 UI 预览，评论不会写入服务器。');
      return;
    }
    const submittedReplyTarget = replyTarget;
    setSavingAction('comment');
    setError('');
    try {
      const response = await backendFetch(
        `/api/course-forum/${encodeURIComponent(courseId)}/posts/${encodeURIComponent(selected.id)}/comments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            body: commentBody.trim(),
            parentId: replyTarget?.id,
          }),
          timeoutMs: 20_000,
        },
      );
      if (!response.ok) throw new Error(await requestError(response, '发表评论失败'));
      setCommentBody('');
      setReplyTarget(null);
      if (submittedReplyTarget) {
        setCommentReplies((previous) => {
          const current = previous[submittedReplyTarget.id];
          const nextTotalCount = (current?.totalCount ?? submittedReplyTarget.replyCount) + 1;
          return {
            ...previous,
            [submittedReplyTarget.id]: {
              items: current?.items ?? [],
              hasMore: true,
              nextOffset: current?.nextOffset ?? 0,
              totalCount: nextTotalCount,
              loading: current?.loading ?? false,
            },
          };
        });
      } else {
        setCommentReplies({});
      }
      await load({ postId: selected.id, quiet: true });
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : '发表评论失败');
    } finally {
      setSavingAction('');
    }
  };

  const deleteComment = async (commentId: string) => {
    if (!selected || savingAction || !window.confirm('确定删除这条评论吗？')) return;
    if (mockMode) {
      setError('Mock 模式仅用于 UI 预览，删除不会写入服务器。');
      return;
    }
    setSavingAction(`delete:${commentId}`);
    setError('');
    try {
      const response = await backendFetch(
        `/api/course-forum/${encodeURIComponent(courseId)}/comments/${encodeURIComponent(commentId)}`,
        { method: 'DELETE', timeoutMs: 20_000 },
      );
      if (!response.ok) throw new Error(await requestError(response, '删除评论失败'));
      await load({ postId: selected.id, quiet: true });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : '删除评论失败');
    } finally {
      setSavingAction('');
    }
  };

  if (loading && !snapshot) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 text-sm text-slate-500">
        <span className="inline-flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          正在打开课程论坛…
        </span>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-slate-50 p-3 text-slate-950 dark:bg-slate-950 dark:text-white sm:p-4">
      <main className="mx-auto flex min-h-[calc(100dvh-24px)] max-w-[1536px] flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-slate-950 sm:min-h-[calc(100dvh-32px)]">
        <header className="border-b border-slate-200/80 px-4 py-4 dark:border-white/10 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="mt-0.5 shrink-0 rounded-xl"
                onClick={() => router.push(forumBackHref)}
                aria-label={forumEntrySource === 'home' ? '返回主界面' : '返回课程'}
              >
                <ArrowLeft className="size-5" />
              </Button>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {courseHeading}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">课程论坛</h1>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pl-12 lg:pl-0">
              <button
                type="button"
                onClick={() => setProfileOpen(true)}
                className="inline-flex h-11 max-w-full items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 text-left shadow-sm transition hover:border-violet-300 hover:bg-violet-50/70 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 sm:px-3"
                aria-label="编辑个人主页"
                title={viewerBio || '编辑个人主页'}
              >
                <Avatar size="sm" className="size-7 ring-2 ring-violet-100 dark:ring-violet-400/20">
                  {viewerAvatar ? <AvatarImage src={viewerAvatar} alt={viewerName} /> : null}
                  <AvatarFallback className="bg-violet-50 text-[10px] font-semibold text-violet-700">
                    {initials(viewerName)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden min-w-0 sm:block">
                  <span className="block truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {viewerName}
                  </span>
                  <span className="block truncate text-[10px] text-slate-400">
                    {viewerBio || '编辑个人主页'}
                  </span>
                </span>
              </button>
              <DirectMessageInboxButton courseId={courseId} />
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={() => void load({ postId: selectedPostId, quiet: true })}
                disabled={refreshing}
              >
                <RefreshCw className={cn('mr-1.5 size-4', refreshing && 'animate-spin')} />
                刷新
              </Button>
              <Button
                className="rounded-xl bg-violet-600 hover:bg-violet-700"
                onClick={() => setNewPostOpen(true)}
              >
                <Plus className="mr-1.5 size-4" />
                发布问题
              </Button>
            </div>
          </div>
        </header>

        {error ? (
          <div className="border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 dark:bg-white/[0.025]">
          <div className="relative mx-auto w-full px-4 py-5 sm:px-6 lg:px-8">
            <aside
              className="absolute top-5 left-4 space-y-4"
              style={{
                width: 'calc(50% - 28rem - 2rem)',
                minWidth: 240,
                maxWidth: 420,
              }}
            >
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950">
                <div className="h-20 bg-slate-200 dark:bg-slate-800">
                  <div className="h-full w-full bg-[radial-gradient(circle_at_18%_0%,rgba(139,92,246,0.30),transparent_34%),linear-gradient(135deg,rgba(224,242,254,0.95),rgba(245,243,255,0.95))] dark:bg-[radial-gradient(circle_at_18%_0%,rgba(139,92,246,0.34),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(49,46,129,0.55))]" />
                </div>
                <div className="px-4 pb-5">
                  <button
                    type="button"
                    onClick={() => setProfileOpen(true)}
                    className="-mt-9 block rounded-full outline-none ring-violet-400 transition hover:ring-2 focus-visible:ring-2"
                    aria-label="编辑个人主页"
                  >
                    <Avatar className="size-20 border-4 border-white shadow-md dark:border-slate-950">
                      {viewerAvatar ? <AvatarImage src={viewerAvatar} alt={viewerName} /> : null}
                      <AvatarFallback className="bg-violet-100 text-2xl font-semibold text-violet-700">
                        {initials(viewerName)}
                      </AvatarFallback>
                    </Avatar>
                  </button>
                  <button
                    type="button"
                    onClick={() => setProfileOpen(true)}
                    className="mt-3 block w-full text-left"
                  >
                    <span className="block truncate text-xl font-bold tracking-tight text-slate-950 dark:text-slate-50">
                      {viewerName}
                    </span>
                    <span className="mt-1 block line-clamp-3 text-sm leading-5 text-slate-500 dark:text-slate-400">
                      {viewerBio || '还没有个性签名'}
                    </span>
                  </button>
                </div>
              </section>

              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950">
                <button
                  type="button"
                  onClick={() => void toggleSidebarCommunities()}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-slate-50 dark:hover:bg-white/[0.04]"
                  aria-expanded={sidebarCommunitiesOpen}
                >
                  <span>
                    <span className="block text-sm font-bold text-slate-950 dark:text-slate-50">
                      Communities
                    </span>
                    <span className="block text-xs text-slate-400">已加入的 community</span>
                  </span>
                  <ChevronDown
                    className={cn(
                      'size-4 shrink-0 text-slate-400 transition',
                      sidebarCommunitiesOpen && 'rotate-180',
                    )}
                  />
                </button>
                {sidebarCommunitiesOpen ? (
                  <div className="border-t border-slate-200 dark:border-white/10">
                    <div className="max-h-80 overflow-y-auto p-2">
                      {communityMenuLoading ? (
                        <div className="flex items-center justify-center gap-2 px-3 py-8 text-sm text-slate-500">
                          <Loader2 className="size-4 animate-spin" />
                          加载中…
                        </div>
                      ) : communities.length ? (
                        <div className="space-y-1">
                          {communities.map((community) => (
                            <Link
                              key={community.id}
                              href={`/communities/${encodeURIComponent(community.slug)}`}
                              className="flex items-center gap-3 rounded-xl px-2.5 py-2.5 transition hover:bg-violet-50 dark:hover:bg-violet-400/10"
                            >
                              <Avatar className="size-10">
                                {community.avatarUrl ? (
                                  <AvatarImage src={community.avatarUrl} alt={community.name} />
                                ) : null}
                                <AvatarFallback className="bg-violet-100 text-xs font-semibold text-violet-700">
                                  {initials(community.name)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                                  c/{community.name}
                                </span>
                                <span className="block truncate text-xs text-slate-500 dark:text-slate-400">
                                  {community.memberCount} members · {community.postCount} posts
                                </span>
                              </span>
                            </Link>
                          ))}
                        </div>
                      ) : (
                        <div className="px-3 py-8 text-center text-sm text-slate-500">
                          暂无已加入 community
                        </div>
                      )}
                    </div>
                    <div className="border-t border-slate-200 p-2 dark:border-white/10">
                      <Button
                        variant="ghost"
                        className="w-full justify-start rounded-xl text-sm"
                        onClick={() => setCreateCommunityOpen(true)}
                      >
                        <Plus className="mr-1.5 size-4" />
                        新建 Community
                      </Button>
                    </div>
                  </div>
                ) : null}
              </section>
            </aside>

            <section className="mx-auto min-w-0 max-w-4xl">
              <div className="pb-4">
                <form
                  className="relative"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setSearch(searchDraft.trim());
                  }}
                >
                  <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchDraft}
                    onChange={(event) => setSearchDraft(event.target.value)}
                    placeholder="搜索标题、正文或 public community"
                    className="h-12 rounded-2xl bg-white pl-10 text-base shadow-sm dark:bg-white/5"
                  />
                </form>
              </div>
              {search && publicCommunityResults.length ? (
                <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Public communities
                    </h2>
                    <span className="text-xs text-slate-400">
                      {publicCommunityResults.length} 个结果
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {publicCommunityResults.slice(0, 6).map((community) => (
                      <Link
                        key={community.id}
                        href={`/communities/${encodeURIComponent(community.slug)}`}
                        className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 transition hover:border-violet-200 hover:bg-violet-50/70 dark:border-white/10 dark:bg-white/[0.035] dark:hover:bg-violet-400/10"
                      >
                        <div className="h-12 bg-[radial-gradient(circle_at_18%_0%,rgba(139,92,246,0.24),transparent_34%),linear-gradient(135deg,rgba(224,242,254,0.95),rgba(245,243,255,0.95))] dark:bg-[radial-gradient(circle_at_18%_0%,rgba(139,92,246,0.30),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(49,46,129,0.55))]">
                          {community.bannerUrl ? (
                            <img
                              src={community.bannerUrl}
                              alt=""
                              className="size-full object-cover opacity-80"
                            />
                          ) : null}
                        </div>
                        <div className="flex gap-3 p-3">
                          <Avatar className="-mt-7 size-12 border-4 border-white bg-white shadow-sm dark:border-slate-950 dark:bg-slate-950">
                            {community.avatarUrl ? (
                              <AvatarImage src={community.avatarUrl} alt={community.name} />
                            ) : null}
                            <AvatarFallback className="bg-violet-100 text-sm font-semibold text-violet-700">
                              {initials(community.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <h3 className="truncate text-sm font-semibold group-hover:text-violet-700 dark:group-hover:text-violet-200">
                                c/{community.name}
                              </h3>
                              {community.isJoined ? (
                                <Badge variant="outline" className="h-5 bg-white text-[10px]">
                                  Joined
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
                              {community.description || '这个 public community 还没有介绍。'}
                            </p>
                            <p className="mt-2 text-[11px] text-slate-400">
                              {community.memberCount} members · {community.postCount} posts
                            </p>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </section>
              ) : null}
              <div>
                {snapshot?.posts.length ? (
                  <div className="space-y-3">
                    {snapshot.posts.map((post) => (
                      <article
                        key={post.id}
                        className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950"
                      >
                        <ForumPostFeedCard
                          post={post}
                          selected={false}
                          profileHref={forumUserHref(courseId, post.author.id)}
                          onOpen={() => openPost(post.id)}
                        />
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="grid min-h-52 place-items-center px-6 text-center text-sm text-slate-500">
                    <div>
                      <MessageCircle className="mx-auto size-7 text-slate-300" />
                      <p className="mt-3">当前筛选下还没有帖子</p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          <Dialog open={postDetailOpen && Boolean(selected)} onOpenChange={setPostDetailDialogOpen}>
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
                <DialogTitle>{selected?.title || '帖子详情'}</DialogTitle>
                <DialogDescription>查看帖子正文和评论。</DialogDescription>
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
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <AuthorLine
                            author={selected.author}
                            time={selected.createdAt}
                            label="提问者"
                            profileHref={forumUserHref(courseId, selected.author.id)}
                          />
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-start gap-2">
                            <h2 className="min-w-0 flex-1 text-2xl font-semibold tracking-tight sm:text-[28px]">
                              {selected.title}
                            </h2>
                          </div>
                        </div>
                      </div>
                      <div className="mt-4">
                        <ForumMarkdown>{selected.bodyMarkdown}</ForumMarkdown>
                        <ForumAttachmentGallery items={selected.attachments} />
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
                          {selected.commentsPage.totalCount} 条
                        </Badge>
                      </div>
                      <div className="mt-5 divide-y divide-slate-200/80 overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-slate-950/55">
                        {selected.comments.map((comment) => {
                          const repliesState = commentReplies[comment.id];
                          const replies = repliesState?.items || [];
                          const loadedReplyCount = replies.length;
                          const totalReplyCount = repliesState?.totalCount ?? comment.replyCount;
                          const remainingReplyCount = Math.max(
                            totalReplyCount - loadedReplyCount,
                            0,
                          );
                          return (
                            <div key={comment.id} className="relative px-4 py-3.5 pb-9">
                              <div className="flex items-start gap-3">
                                <Link
                                  href={forumUserHref(courseId, comment.author.id)}
                                  className="mt-0.5 shrink-0 rounded-full outline-none ring-violet-400 transition hover:ring-2 focus-visible:ring-2"
                                  aria-label={`查看 ${comment.author.name} 的介绍页面`}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <Avatar size="sm">
                                    {comment.author.image ? (
                                      <AvatarImage
                                        src={comment.author.image}
                                        alt={comment.author.name}
                                      />
                                    ) : null}
                                    <AvatarFallback className="text-[10px]">
                                      {initials(comment.author.name)}
                                    </AvatarFallback>
                                  </Avatar>
                                </Link>
                                <button
                                  type="button"
                                  className="min-w-0 flex-1 rounded-xl text-left transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none dark:hover:bg-white/[0.04]"
                                  onClick={() => startReplyToComment(comment)}
                                >
                                  <div className="flex flex-wrap items-center gap-2 text-xs">
                                    <span className="font-medium text-slate-700 dark:text-slate-200">
                                      {comment.author.name}
                                    </span>
                                    {comment.author.forumRoleLabel ? (
                                      <Badge
                                        className={cn(
                                          'h-5 px-2 text-[11px]',
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
                                  <div className="mt-2 flex flex-wrap items-center gap-3 text-xs font-medium text-slate-400">
                                    <span className="text-violet-600 dark:text-violet-300">
                                      回复 {comment.author.name}
                                    </span>
                                    {comment.replyCount > 0 ? (
                                      <span>
                                        {repliesState
                                          ? `已显示 ${loadedReplyCount}/${totalReplyCount} 条回复`
                                          : `${comment.replyCount} 条回复`}
                                      </span>
                                    ) : null}
                                  </div>
                                </button>
                                {isTeacher ? (
                                  <Button
                                    size="icon-sm"
                                    variant="ghost"
                                    className="shrink-0 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                                    onClick={() => void deleteComment(comment.id)}
                                    disabled={Boolean(savingAction)}
                                    aria-label={`删除 ${comment.author.name} 的评论`}
                                  >
                                    {savingAction === `delete:${comment.id}` ? (
                                      <Loader2 className="size-3.5 animate-spin" />
                                    ) : (
                                      <Trash2 className="size-3.5" />
                                    )}
                                  </Button>
                                ) : null}
                              </div>
                              {comment.qualityAnswer ? (
                                <div className="absolute right-4 bottom-3 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-amber-400/10 dark:text-amber-200 dark:ring-amber-400/20">
                                  <Award className="size-3" />
                                  优质解答
                                </div>
                              ) : null}
                              {repliesState ? (
                                <div className="mt-3 ml-11 overflow-hidden rounded-2xl border border-slate-200 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.035]">
                                  {replies.length ? (
                                    replies.map((reply) => (
                                      <div
                                        key={reply.id}
                                        className="flex items-start gap-2 border-b border-slate-200/80 px-3 py-3 last:border-b-0 dark:border-white/10"
                                      >
                                        <Avatar size="sm">
                                          {reply.author.image ? (
                                            <AvatarImage
                                              src={reply.author.image}
                                              alt={reply.author.name}
                                            />
                                          ) : null}
                                          <AvatarFallback className="text-[10px]">
                                            {initials(reply.author.name)}
                                          </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                          <div className="flex flex-wrap items-center gap-2 text-xs">
                                            <span className="font-medium text-slate-700 dark:text-slate-200">
                                              {reply.author.name}
                                            </span>
                                            <span className="text-slate-400">
                                              {relativeTime(reply.createdAt)}
                                            </span>
                                          </div>
                                          <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
                                            {reply.body}
                                          </p>
                                        </div>
                                      </div>
                                    ))
                                  ) : repliesState.loading ? (
                                    <div className="flex items-center justify-center gap-2 px-3 py-4 text-xs text-slate-400">
                                      <Loader2 className="size-3.5 animate-spin" />
                                      正在加载回复…
                                    </div>
                                  ) : (
                                    <p className="px-3 py-4 text-center text-xs text-slate-400">
                                      暂无回复
                                    </p>
                                  )}
                                  {repliesState.hasMore ? (
                                    <button
                                      type="button"
                                      className="flex w-full items-center justify-center gap-2 px-3 py-3 text-xs font-medium text-violet-600 transition hover:bg-violet-50 dark:text-violet-300 dark:hover:bg-violet-400/10"
                                      onClick={() => void loadCommentReplies(comment)}
                                      disabled={repliesState.loading}
                                    >
                                      {repliesState.loading ? (
                                        <Loader2 className="size-3.5 animate-spin" />
                                      ) : null}
                                      {repliesState.loading
                                        ? '正在加载更多回复…'
                                        : `加载更多回复${remainingReplyCount ? `（剩余 ${remainingReplyCount} 条）` : ''}`}
                                    </button>
                                  ) : null}
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                        {!selected.comments.length ? (
                          <p className="py-6 text-center text-sm text-slate-400">暂无评论</p>
                        ) : null}
                        {selected.commentsPage.hasMore ? (
                          <div
                            ref={commentsSentinelRef}
                            className="flex items-center justify-center gap-2 px-4 py-4 text-xs text-slate-400"
                            aria-live="polite"
                          >
                            {loadingMoreComments ? (
                              <>
                                <Loader2 className="size-3.5 animate-spin" />
                                正在加载更多评论…
                              </>
                            ) : (
                              <span>继续向下滚动加载更多评论</span>
                            )}
                          </div>
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
                      <p className="mt-1">也可以发布这门课程的第一个问题。</p>
                    </div>
                  </div>
                )}
              </div>
              {selected ? (
                <div className="shrink-0 border-t border-slate-200 bg-white/95 px-5 py-4 shadow-[0_-12px_32px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-950/95">
                  {replyTarget ? (
                    <div className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-violet-50 px-3 py-2 text-xs text-violet-700 dark:bg-violet-400/10 dark:text-violet-200">
                      <span className="min-w-0 truncate">
                        正在回复 {replyTarget.author.name}：{replyTarget.body}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 font-semibold hover:underline"
                        onClick={() => setReplyTarget(null)}
                      >
                        取消回复
                      </button>
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <Textarea
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      placeholder={
                        replyTarget ? `回复 ${replyTarget.author.name}…` : '补充信息或追问…'
                      }
                      maxLength={MAX_COMMENT_LENGTH}
                      className="min-h-11 flex-1 resize-none rounded-xl bg-slate-50 dark:bg-slate-900"
                    />
                    <Button
                      className="h-auto rounded-xl bg-violet-600 px-4 hover:bg-violet-700"
                      disabled={!commentBody.trim() || Boolean(savingAction)}
                      onClick={() => void submitComment()}
                    >
                      {savingAction === 'comment' ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      <span className="sr-only">{replyTarget ? '发表回复' : '发表评论'}</span>
                    </Button>
                  </div>
                </div>
              ) : null}
            </DialogContent>
          </Dialog>
        </div>
      </main>

      <Dialog open={newPostOpen} onOpenChange={setNewPostOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[96dvh] max-h-[1100px] w-[min(98vw,1540px)] max-w-none flex-col overflow-hidden p-0"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>发布问题</DialogTitle>
            <DialogDescription>
              用 Markdown、代码块和数学公式完整描述问题；内容只保存在课程论坛中。
            </DialogDescription>
          </DialogHeader>
          <div className="relative min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
            <DialogClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-4 right-4 z-10 size-8 shrink-0 rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm hover:bg-slate-50 hover:text-slate-900 dark:border-white/10 dark:bg-white/5 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
                aria-label="关闭"
              >
                <X className="size-4" />
              </Button>
            </DialogClose>
            <div className="pr-12">
              <label className="text-sm font-medium">标题</label>
              <Input
                value={postTitle}
                onChange={(event) => setPostTitle(event.target.value)}
                placeholder="一句话说明你遇到的问题"
                maxLength={200}
                className="mt-2 rounded-xl"
              />
            </div>
            <div>
              <ForumMarkdownEditor
                value={postBody}
                onChange={setPostBody}
                placeholder={'支持 Markdown，例如：\n\n```python\na = [1, 2]\nb = a\n```'}
                className="min-h-[620px] lg:h-[calc(96dvh-300px)] lg:max-h-[760px]"
              />
            </div>
          </div>
          <DialogFooter className="flex-col items-stretch gap-3 border-t border-slate-200 px-6 py-4 dark:border-white/10 sm:flex-col">
            <ImagePicker files={postImages} onChange={setPostImages} />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => setNewPostOpen(false)}
                disabled={savingAction === 'post'}
              >
                取消
              </Button>
              <Button
                className="bg-violet-600 hover:bg-violet-700"
                disabled={!postTitle.trim() || !postBody.trim() || savingAction === 'post'}
                onClick={() => void createPost()}
              >
                {savingAction === 'post' ? (
                  <Loader2 className="mr-1.5 size-4 animate-spin" />
                ) : (
                  <Plus className="mr-1.5 size-4" />
                )}
                发布问题
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
        <DialogContent className="flex max-h-[92dvh] w-[min(94vw,620px)] flex-col overflow-hidden rounded-2xl p-0">
          <DialogHeader className="shrink-0 border-b border-slate-200 px-5 pt-5 pb-4 dark:border-white/10 sm:px-6">
            <DialogTitle className="text-xl">编辑个人主页</DialogTitle>
            <DialogDescription>设置你在课程论坛里的头像、昵称和个性签名。</DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="space-y-5">
              <div className="relative overflow-hidden rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-sky-50 p-4 dark:border-violet-400/20 dark:from-violet-400/10 dark:via-white/[0.04] dark:to-sky-400/10">
                <div className="flex items-center gap-4">
                  <Avatar className="size-18 ring-4 ring-white dark:ring-slate-900">
                    {profileAvatarDraft ? (
                      <AvatarImage src={profileAvatarDraft} alt={profileNameDraft || viewerName} />
                    ) : null}
                    <AvatarFallback className="bg-violet-100 text-lg font-semibold text-violet-700">
                      {initials(profileNameDraft || viewerName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold text-slate-950 dark:text-slate-100">
                      {profileNameDraft.trim() || viewerName}
                    </p>
                    <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-300">
                      {profileBioDraft.trim() || '还没有个性签名'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  昵称
                </label>
                <Input
                  value={profileNameDraft}
                  onChange={(event) => setProfileNameDraft(event.target.value)}
                  placeholder="输入你的论坛昵称"
                  maxLength={60}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  头像
                </label>
                <div className="max-h-40 overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50/70 p-3 dark:border-white/10 dark:bg-white/5">
                  <div className="grid grid-cols-6 gap-2 sm:grid-cols-8">
                    {AVATAR_OPTIONS.slice(0, 24).map((avatar) => (
                      <button
                        type="button"
                        key={avatar}
                        onClick={() => setProfileAvatarDraft(avatar)}
                        className={cn(
                          'grid place-items-center rounded-full p-1 transition hover:bg-violet-100 dark:hover:bg-violet-400/20',
                          profileAvatarDraft === avatar &&
                            'bg-violet-100 ring-2 ring-violet-500 dark:bg-violet-400/20',
                        )}
                        aria-label="选择头像"
                      >
                        <Avatar className="size-10">
                          <AvatarImage src={avatar} alt="" />
                          <AvatarFallback>
                            {initials(profileNameDraft || viewerName)}
                          </AvatarFallback>
                        </Avatar>
                      </button>
                    ))}
                  </div>
                </div>
                <Input
                  value={profileAvatarDraft}
                  onChange={(event) => setProfileAvatarDraft(event.target.value)}
                  placeholder="也可以粘贴图片 URL"
                  maxLength={2000}
                  className="rounded-xl"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
                    个性签名
                  </label>
                  <span className="text-xs text-slate-400">{profileBioDraft.length}/160</span>
                </div>
                <Textarea
                  value={profileBioDraft}
                  onChange={(event) => setProfileBioDraft(event.target.value)}
                  placeholder="写一句会显示在个人主页入口的小签名"
                  maxLength={160}
                  className="min-h-28 resize-none rounded-xl"
                />
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 dark:border-white/10 dark:bg-slate-950 sm:px-6">
            <Button variant="outline" onClick={() => setProfileOpen(false)}>
              取消
            </Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700"
              disabled={!profileNameDraft.trim() && !profileAvatarDraft.trim()}
              onClick={saveProfile}
            >
              保存个人主页
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createCommunityOpen} onOpenChange={setCreateCommunityOpen}>
        <DialogContent className="flex max-h-[92dvh] w-[min(94vw,620px)] flex-col overflow-hidden rounded-2xl p-0">
          <DialogHeader className="shrink-0 border-b border-slate-200 px-5 pt-5 pb-4 dark:border-white/10 sm:px-6">
            <DialogTitle className="text-xl">新建 Community</DialogTitle>
            <DialogDescription>
              创建一个独立讨论区。Public 任何人都可以加入；Private 需要创建人邀请。
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Community Name
              </label>
              <Input
                value={communityNameDraft}
                onChange={(event) => {
                  const nextName = event.target.value;
                  setCommunityNameDraft(nextName);
                  if (!communitySlugDraft.trim()) {
                    setCommunitySlugDraft(normalizeCommunitySlug(nextName));
                  }
                }}
                placeholder="Computer Science"
                maxLength={120}
                className="rounded-xl"
              />
              <p className="text-xs text-slate-400">显示名称</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Unique ID / URL
              </label>
              <div className="flex overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-white/10 dark:bg-white/5">
                <span className="inline-flex items-center border-r border-slate-200 px-3 text-sm text-slate-400 dark:border-white/10">
                  /communities/
                </span>
                <input
                  value={communitySlugDraft}
                  onChange={(event) =>
                    setCommunitySlugDraft(normalizeCommunitySlug(event.target.value))
                  }
                  placeholder="computer-science"
                  maxLength={80}
                  className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm outline-none"
                />
              </div>
              <p className="text-xs text-slate-400">唯一标识、URL</p>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Description
              </label>
              <Textarea
                value={communityDescriptionDraft}
                onChange={(event) => setCommunityDescriptionDraft(event.target.value)}
                placeholder="Discuss CS courses…"
                maxLength={600}
                className="min-h-28 resize-none rounded-xl"
              />
              <div className="flex justify-between gap-3 text-xs text-slate-400">
                <span>社区简介</span>
                <span>{communityDescriptionDraft.length}/600</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                Privacy
              </label>
              <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1 dark:border-white/10 dark:bg-white/5">
                {[
                  {
                    value: 'public' as const,
                    title: 'Public',
                    description: '谁都可以加入',
                  },
                  {
                    value: 'private' as const,
                    title: 'Private',
                    description: '需要创建人邀请',
                  },
                ].map((option) => {
                  const active = communityPrivacyDraft === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setCommunityPrivacyDraft(option.value)}
                      className={cn(
                        'rounded-xl px-3 py-2.5 text-left transition',
                        active
                          ? 'bg-white text-violet-700 shadow-sm ring-1 ring-violet-200 dark:bg-slate-950 dark:text-violet-200 dark:ring-violet-400/25'
                          : 'text-slate-500 hover:bg-white/70 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-white',
                      )}
                      aria-pressed={active}
                    >
                      <span className="block text-sm font-semibold">{option.title}</span>
                      <span className="mt-0.5 block text-xs opacity-75">{option.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 bg-white px-5 py-4 dark:border-white/10 dark:bg-slate-950 sm:px-6">
            <Button
              variant="outline"
              onClick={() => setCreateCommunityOpen(false)}
              disabled={creatingCommunity}
            >
              取消
            </Button>
            <Button
              className="bg-violet-600 hover:bg-violet-700"
              disabled={
                !communityNameDraft.trim() ||
                !normalizeCommunitySlug(communitySlugDraft || communityNameDraft) ||
                !communityDescriptionDraft.trim() ||
                creatingCommunity
              }
              onClick={() => void createCommunity()}
            >
              {creatingCommunity ? (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              ) : (
                <Plus className="mr-1.5 size-4" />
              )}
              创建 Community
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
