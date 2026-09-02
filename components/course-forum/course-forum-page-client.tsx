'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useRouter } from 'next/navigation';
import {
  CheckCircle2,
  Download,
  Eye,
  FileImage,
  ImagePlus,
  LockKeyhole,
  Loader2,
  MessageCircle,
  MessageSquareReply,
  Paperclip,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { CourseSpaceHeader } from '@/components/course-space/course-space-header';
import { CourseSpacePageFrame } from '@/components/course-space/course-space-page-frame';
import {
  COURSE_SPACE_BODY_SURFACE_CLASS,
  resolveCourseSpaceHeaderFields,
} from '@/lib/course-space/format-course-space-header';
import { normalizeForumMarkdownForDisplay } from '@/lib/course-forum/markdown';
import { ForumMarkdownEditor } from '@/components/course-forum/forum-markdown-editor';
import { forumMarkdownDisplayClassName } from '@/components/course-forum/forum-markdown-display';
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
  CourseForumSnapshot,
  CourseForumStatusFilter,
} from '@/features/course-forum/domain/course-forum';
import { buildCourseForumMockSnapshot } from '@/features/course-forum/mock/course-forum-mock';
import { cn } from '@/lib/utils';
import { BackendApiError, backendFetch, backendJson } from '@/lib/utils/backend-api';
import { useUserProfileStore } from '@/lib/store/user-profile';

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

function AuthorLine({
  author,
  time,
  label,
  compact = false,
}: {
  author: CourseForumAuthor;
  time: string;
  label?: '提问者' | '回答者' | '评论者';
  compact?: boolean;
}) {
  const prominent = Boolean(label);
  return (
    <div className={cn('flex min-w-0 items-center', compact ? 'gap-2' : 'gap-2.5')}>
      <Avatar
        size={prominent ? 'default' : 'sm'}
        className={cn(prominent ? 'size-10' : compact ? 'size-6' : 'size-7')}
      >
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
      <div className={cn('min-w-0', prominent ? 'text-sm' : 'text-xs')}>
        <div className="flex flex-wrap items-center gap-1.5">
          {label ? <span className="text-[11px] font-medium text-slate-400">{label}</span> : null}
          <span
            className={cn(
              'truncate text-slate-700 dark:text-slate-200',
              prominent ? 'font-semibold' : 'font-medium',
            )}
          >
            {author.name}
          </span>
          {author.isTeacher ? (
            <Badge className="h-4 bg-violet-50 px-1.5 text-[10px] text-violet-700 hover:bg-violet-50 dark:bg-violet-400/10 dark:text-violet-200">
              老师
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
    <MessageResponse mode="static" className={forumMarkdownDisplayClassName}>
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
            <DialogDescription>点击右下角可保存原图</DialogDescription>
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
  const profileNickname = useUserProfileStore((state) => state.nickname);
  const profileAvatar = useUserProfileStore((state) => state.avatar);
  const [snapshot, setSnapshot] = useState<CourseForumSnapshot | null>(initialSnapshot || null);
  const [filter, setFilter] = useState<CourseForumStatusFilter>('all');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [selectedPostId, setSelectedPostId] = useState(initialSnapshot?.selectedPost?.id || '');
  const selectedPostIdRef = useRef(initialSnapshot?.selectedPost?.id || '');
  const [loading, setLoading] = useState(!initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [accessRevoked, setAccessRevoked] = useState(false);
  const [error, setError] = useState('');
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postImages, setPostImages] = useState<File[]>([]);
  const [answerBody, setAnswerBody] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [savingAction, setSavingAction] = useState('');
  const lastProfileSyncKeyRef = useRef('');
  const accessCheckInFlightRef = useRef(false);
  const mockAsTeacher = initialSnapshot?.viewer.accessRole === 'owner';

  const commitSelectedPostId = useCallback((postId: string) => {
    selectedPostIdRef.current = postId;
    setSelectedPostId(postId);
  }, []);

  const load = useCallback(
    async (options?: {
      postId?: string;
      quiet?: boolean;
      background?: boolean;
      status?: CourseForumStatusFilter;
    }) => {
      if (!options?.background) {
        if (options?.quiet) setRefreshing(true);
        else setLoading(true);
      }
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
          commitSelectedPostId(next.selectedPost?.id || '');
          setError('');
          return;
        }
        const params = new URLSearchParams({ status });
        if (search) params.set('q', search);
        if (postId) params.set('postId', postId);
        const next = await backendJson<CourseForumSnapshot>(
          `/api/course-forum/${encodeURIComponent(courseId)}?${params.toString()}`,
          { timeoutMs: 45_000 },
        );
        setSnapshot(next);
        commitSelectedPostId(next.selectedPost?.id || '');
        setAccessRevoked(false);
        setError('');
      } catch (loadError) {
        if (
          loadError instanceof BackendApiError &&
          (loadError.status === 403 || loadError.status === 404)
        ) {
          setSnapshot(null);
          setAccessRevoked(true);
          setError(loadError.backendMessage || '机构已关闭这门课程的 AI 访问权限。');
          return;
        }
        setError(loadError instanceof Error ? loadError.message : '论坛加载失败');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [commitSelectedPostId, courseId, filter, mockAsTeacher, mockMode, search],
  );

  useEffect(() => {
    if (mockMode) {
      void load({ postId: selectedPostIdRef.current, quiet: true, status: filter });
      return;
    }
    if (initialSnapshot) return;
    void load({ postId: selectedPostIdRef.current });
  }, [filter, initialSnapshot, load, mockMode, search]);

  useEffect(() => {
    if (mockMode || accessRevoked) return;
    const checkAccess = () => {
      if (accessCheckInFlightRef.current) return;
      accessCheckInFlightRef.current = true;
      void load({ postId: selectedPostId, quiet: true, background: true }).finally(() => {
        accessCheckInFlightRef.current = false;
      });
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') checkAccess();
    };
    const timer = window.setInterval(checkAccess, 30_000);
    window.addEventListener('focus', checkAccess);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', checkAccess);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [accessRevoked, load, mockMode, selectedPostId]);

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
  }, [disableProfileSync, load, mockMode, profileAvatar, profileNickname, selectedPostId]);

  const selected = snapshot?.selectedPost || null;
  const isTeacher = snapshot?.viewer.accessRole === 'owner';
  const courseHeading = snapshot
    ? resolveCourseSpaceHeaderFields({
        code: snapshot.course.code,
        name: snapshot.course.name,
        academicYear: snapshot.course.academicYear,
        term: snapshot.course.term,
      })
    : { courseTitle: '课程论坛', courseMeta: undefined };

  const openPost = (postId: string) => {
    commitSelectedPostId(postId);
    void load({ postId });
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
      commitSelectedPostId(payload.postId);
      await load({ postId: payload.postId, quiet: true, status: 'all' });
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : '发布问题失败');
    } finally {
      setSavingAction('');
    }
  };

  const submitAnswer = async () => {
    if (!selected || !answerBody.trim() || savingAction) return;
    if (mockMode) {
      setError('Mock 模式仅用于 UI 预览，解答不会写入服务器。');
      return;
    }
    setSavingAction('answer');
    setError('');
    try {
      const form = new FormData();
      form.set('bodyMarkdown', answerBody.trim());
      const response = await backendFetch(
        `/api/course-forum/${encodeURIComponent(courseId)}/posts/${encodeURIComponent(selected.id)}/answers`,
        { method: 'POST', body: form, timeoutMs: 30_000 },
      );
      if (!response.ok) throw new Error(await requestError(response, '提交解答失败'));
      setAnswerBody('');
      await load({ postId: selected.id, quiet: true });
    } catch (answerError) {
      setError(answerError instanceof Error ? answerError.message : '提交解答失败');
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
    setSavingAction('comment');
    setError('');
    try {
      const response = await backendFetch(
        `/api/course-forum/${encodeURIComponent(courseId)}/posts/${encodeURIComponent(selected.id)}/comments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: commentBody.trim() }),
          timeoutMs: 20_000,
        },
      );
      if (!response.ok) throw new Error(await requestError(response, '发表评论失败'));
      setCommentBody('');
      await load({ postId: selected.id, quiet: true });
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : '发表评论失败');
    } finally {
      setSavingAction('');
    }
  };

  const acceptAnswer = async (answerId: string) => {
    if (!selected || savingAction) return;
    if (mockMode) {
      setError('Mock 模式仅用于 UI 预览，采纳不会写入服务器。');
      return;
    }
    setSavingAction(`accept:${answerId}`);
    setError('');
    try {
      const response = await backendFetch(
        `/api/course-forum/${encodeURIComponent(courseId)}/answers/${encodeURIComponent(answerId)}/accept`,
        { method: 'PATCH', timeoutMs: 20_000 },
      );
      if (!response.ok) throw new Error(await requestError(response, '采纳解答失败'));
      await load({ postId: selected.id, quiet: true });
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : '采纳解答失败');
    } finally {
      setSavingAction('');
    }
  };

  const togglePin = async () => {
    if (!selected || !isTeacher || savingAction) return;
    if (mockMode) {
      setError('Mock 模式仅用于 UI 预览，置顶状态不会写入服务器。');
      return;
    }
    setSavingAction(`pin:${selected.id}`);
    setError('');
    try {
      const response = await backendFetch(
        `/api/course-forum/${encodeURIComponent(courseId)}/posts/${encodeURIComponent(selected.id)}/pin`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pinned: !selected.pinned }),
          timeoutMs: 20_000,
        },
      );
      if (!response.ok) {
        throw new Error(
          await requestError(response, selected.pinned ? '取消置顶失败' : '置顶失败'),
        );
      }
      await load({ postId: selected.id, quiet: true });
    } catch (pinError) {
      setError(pinError instanceof Error ? pinError.message : '更新置顶状态失败');
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

  if (accessRevoked) {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 px-6 text-center text-slate-950 dark:bg-slate-950 dark:text-white">
        <div className="max-w-sm rounded-[28px] border border-slate-200/80 bg-white px-8 py-10 shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-white/5">
          <LockKeyhole className="mx-auto size-9 text-slate-400" strokeWidth={1.6} />
          <h1 className="mt-4 text-xl font-semibold">课程权限已关闭</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
            {error || '机构已关闭这门课程的 AI 访问权限，课程论坛现在不可访问。'}
          </p>
          <Button className="mt-6 rounded-full px-5" onClick={() => router.push('/learn')}>
            返回全部课程
          </Button>
        </div>
      </div>
    );
  }

  return (
    <CourseSpacePageFrame>
      {snapshot ? (
        <CourseSpaceHeader
          courseId={courseId}
          courseTitle={courseHeading.courseTitle}
          courseMeta={courseHeading.courseMeta}
          role={isTeacher ? 'teacher' : 'student'}
          active="forum"
          problemCount={snapshot.course.problemCount}
          forumCount={snapshot.unresolvedCount}
          previewMode={mockMode}
          actions={
            <>
              <Button
                variant="outline"
                className="h-8 rounded-lg"
                onClick={() => void load({ postId: selectedPostId, quiet: true })}
                disabled={refreshing}
              >
                <RefreshCw className={cn('mr-1.5 size-4', refreshing && 'animate-spin')} />
                刷新
              </Button>
              <Button
                className="h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700"
                onClick={() => setNewPostOpen(true)}
              >
                <Plus className="mr-1.5 size-4" />
                发布问题
              </Button>
            </>
          }
        />
      ) : null}

      {error ? (
        <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
          {error}
        </div>
      ) : null}

      <section className={cn(COURSE_SPACE_BODY_SURFACE_CLASS, 'flex min-h-0 flex-1 flex-col')}>
        <div className="grid min-h-0 flex-1 lg:grid-cols-[390px_minmax(0,1fr)]">
          <aside className="flex min-h-[360px] flex-col border-b border-slate-200/80 bg-slate-50/70 dark:border-white/10 dark:bg-white/[0.025] lg:min-h-0 lg:border-r lg:border-b-0">
            <div className="border-b border-slate-200/80 p-4 dark:border-white/10">
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
                  placeholder="搜索标题或正文"
                  className="h-10 rounded-xl bg-white pl-9 shadow-none dark:bg-white/5"
                />
              </form>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {snapshot?.pinnedPosts.length ? (
                <section className="border-b border-violet-200/70 bg-violet-50/65 px-3 py-3 dark:border-violet-400/20 dark:bg-violet-400/[0.07]">
                  <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-bold tracking-wide text-violet-700 dark:text-violet-200">
                    <Pin className="size-3.5 fill-current" />
                    置顶
                  </div>
                  <div className="space-y-2">
                    {snapshot.pinnedPosts.map((post) => (
                      <button
                        key={post.id}
                        type="button"
                        onClick={() => openPost(post.id)}
                        className={cn(
                          'w-full rounded-xl border border-violet-200/80 bg-white/90 px-3 py-2.5 text-left shadow-sm transition hover:border-violet-300 hover:bg-white dark:border-violet-400/20 dark:bg-white/5 dark:hover:bg-white/10',
                          selected?.id === post.id &&
                            'border-violet-400 ring-2 ring-violet-200/70 dark:border-violet-300/50 dark:ring-violet-400/20',
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <h2 className="line-clamp-1 min-w-0 flex-1 text-[13px] font-semibold leading-4">
                            {post.title}
                          </h2>
                          <Badge className="h-4 shrink-0 bg-violet-600 px-1.5 text-[10px] leading-none text-white hover:bg-violet-600">
                            {post.isWelcome ? '指南' : '置顶'}
                          </Badge>
                        </div>
                        <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                          {post.bodyPreview}
                        </p>
                      </button>
                    ))}
                  </div>
                </section>
              ) : null}
              {snapshot?.posts.length ? (
                <div className="divide-y divide-slate-200/80 dark:divide-white/10">
                  {snapshot.posts.map((post) => (
                    <button
                      key={post.id}
                      type="button"
                      onClick={() => openPost(post.id)}
                      className={cn(
                        'w-full px-3 py-2.5 text-left transition hover:bg-white dark:hover:bg-white/5',
                        selected?.id === post.id &&
                          'bg-white shadow-[inset_3px_0_0_#7c3aed] dark:bg-white/5',
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h2 className="line-clamp-1 min-w-0 flex-1 text-[13px] font-semibold leading-4">
                          {post.title}
                        </h2>
                        <Badge
                          className={cn(
                            'h-4 shrink-0 px-1.5 text-[10px] font-semibold leading-none',
                            post.resolved
                              ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50 dark:bg-emerald-400/10 dark:text-emerald-200'
                              : 'bg-amber-50 text-amber-700 hover:bg-amber-50 dark:bg-amber-400/10 dark:text-amber-200',
                          )}
                        >
                          {post.resolved ? '已解决' : '未解决'}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <AuthorLine author={post.author} time={post.createdAt} compact />
                        <div className="flex shrink-0 items-center gap-1.5 text-[10px] text-slate-400">
                          <span className="inline-flex items-center gap-1">
                            <MessageSquareReply className="size-3" /> {post.answerCount}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <MessageCircle className="size-3" /> {post.commentCount}
                          </span>
                          {post.attachmentCount ? (
                            <span className="inline-flex items-center gap-1">
                              <Paperclip className="size-3" /> {post.attachmentCount}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
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
          </aside>

          <section className="min-h-0 overflow-y-auto bg-white dark:bg-slate-950">
            {selected ? (
              <div className="mx-auto w-full max-w-6xl px-5 py-5 sm:px-8 sm:py-6 lg:px-10">
                <article>
                  <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {selected.pinned ? (
                          <Badge className="bg-violet-600 text-white hover:bg-violet-600">
                            <Pin className="size-3 fill-current" />
                            {selected.isWelcome ? '论坛指南' : '置顶'}
                          </Badge>
                        ) : null}
                        <h2 className="min-w-0 text-2xl font-semibold tracking-tight sm:text-[28px]">
                          {selected.title}
                        </h2>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                      {isTeacher ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl text-xs"
                          disabled={Boolean(savingAction)}
                          onClick={() => void togglePin()}
                        >
                          {savingAction === `pin:${selected.id}` ? (
                            <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                          ) : selected.pinned ? (
                            <PinOff className="mr-1.5 size-3.5" />
                          ) : (
                            <Pin className="mr-1.5 size-3.5" />
                          )}
                          {selected.pinned ? '取消置顶' : '置顶帖子'}
                        </Button>
                      ) : null}
                      <AuthorLine
                        author={selected.author}
                        time={selected.createdAt}
                        label="提问者"
                      />
                    </div>
                  </div>
                  <div className="mt-4">
                    <ForumMarkdown>{selected.bodyMarkdown}</ForumMarkdown>
                    <ForumAttachmentGallery items={selected.attachments} />
                  </div>
                </article>

                <section className="mt-8 rounded-[24px] border border-violet-200/70 bg-violet-50/40 p-5 dark:border-violet-400/20 dark:bg-violet-400/[0.06] sm:p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-violet-600 text-white shadow-sm">
                        <MessageSquareReply className="size-4" />
                      </span>
                      <div>
                        <h3 className="text-lg font-semibold text-violet-950 dark:text-violet-100">
                          解答
                        </h3>
                        <p className="mt-1 text-sm text-violet-700/80 dark:text-violet-200/70">
                          同学可以尝试作答，老师选择最合适的答案。
                        </p>
                      </div>
                    </div>
                    <Badge className="bg-white/80 text-violet-700 hover:bg-white/80 dark:bg-white/10 dark:text-violet-200">
                      {selected.answers.length} 个解答
                    </Badge>
                  </div>

                  <div className="mt-5 space-y-4">
                    {selected.answers.map((answer) => (
                      <article
                        key={answer.id}
                        className={cn(
                          'rounded-2xl border bg-white p-5 shadow-[0_8px_24px_rgba(91,33,182,0.04)] dark:bg-slate-950/70',
                          answer.accepted
                            ? 'border-emerald-300 dark:border-emerald-400/30'
                            : 'border-violet-100 dark:border-white/10',
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <AuthorLine
                            author={answer.author}
                            time={answer.createdAt}
                            label="回答者"
                          />
                          {answer.accepted ? (
                            <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
                              <UserRoundCheck className="size-3" />
                              老师采纳
                            </Badge>
                          ) : isTeacher ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-lg text-xs"
                              disabled={Boolean(savingAction)}
                              onClick={() => void acceptAnswer(answer.id)}
                            >
                              {savingAction === `accept:${answer.id}` ? (
                                <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                              ) : (
                                <CheckCircle2 className="mr-1.5 size-3.5" />
                              )}
                              采纳此解答
                            </Button>
                          ) : null}
                        </div>
                        <div className="mt-4">
                          <ForumMarkdown>{answer.bodyMarkdown}</ForumMarkdown>
                          <ForumAttachmentGallery items={answer.attachments} />
                        </div>
                      </article>
                    ))}
                    {!selected.answers.length ? (
                      <div className="rounded-2xl border border-dashed border-violet-200 bg-white/60 px-5 py-8 text-center text-sm text-violet-700/70 dark:border-violet-400/20 dark:bg-white/5 dark:text-violet-200/70">
                        还没有解答，成为第一个回答的同学吧。
                      </div>
                    ) : null}
                  </div>

                  <div className="mt-5 rounded-2xl border border-violet-200/80 bg-white p-4 dark:border-white/10 dark:bg-slate-950/60">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <label className="text-sm font-semibold">写下你的解答</label>
                      <div className="flex flex-wrap items-center gap-2">
                        {isTeacher ? (
                          <Button
                            type="button"
                            variant="outline"
                            className="rounded-xl"
                            disabled
                            title="AI 回复功能待开放"
                          >
                            <Sparkles className="mr-1.5 size-4" />
                            生成 AI 回复
                          </Button>
                        ) : null}
                        <Button
                          className="rounded-xl bg-violet-600 hover:bg-violet-700"
                          disabled={!answerBody.trim() || Boolean(savingAction)}
                          onClick={() => void submitAnswer()}
                        >
                          {savingAction === 'answer' ? (
                            <Loader2 className="mr-1.5 size-4 animate-spin" />
                          ) : (
                            <Send className="mr-1.5 size-4" />
                          )}
                          提交解答
                        </Button>
                      </div>
                    </div>
                    <Textarea
                      value={answerBody}
                      onChange={(event) => setAnswerBody(event.target.value)}
                      placeholder="支持 Markdown、代码块和公式…"
                      className="mt-3 min-h-32 resize-y rounded-xl bg-slate-50 dark:bg-slate-950"
                    />
                  </div>
                </section>

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
                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                          用于追问、补充和澄清，不作为正式解答。
                        </p>
                      </div>
                    </div>
                    <Badge variant="outline" className="bg-white/70 dark:bg-white/5">
                      {selected.comments.length} 条
                    </Badge>
                  </div>
                  <div className="mt-5 divide-y divide-slate-200/80 overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-slate-950/55">
                    {selected.comments.map((comment) => (
                      <div key={comment.id} className="flex items-start gap-3 px-4 py-3.5">
                        <Avatar size="sm" className="mt-0.5">
                          {comment.author.image ? (
                            <AvatarImage src={comment.author.image} alt={comment.author.name} />
                          ) : null}
                          <AvatarFallback className="text-[10px]">
                            {initials(comment.author.name)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-medium text-slate-700 dark:text-slate-200">
                              {comment.author.name}
                            </span>
                            {comment.author.isTeacher ? (
                              <Badge variant="outline">老师</Badge>
                            ) : null}
                            <span className="text-slate-400">
                              {relativeTime(comment.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
                            {comment.body}
                          </p>
                        </div>
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
                    ))}
                    {!selected.comments.length ? (
                      <p className="py-6 text-center text-sm text-slate-400">暂无评论</p>
                    ) : null}
                  </div>
                  <div className="mt-4 flex gap-2">
                    <Textarea
                      value={commentBody}
                      onChange={(event) => setCommentBody(event.target.value)}
                      placeholder="补充信息或追问…"
                      className="min-h-11 flex-1 resize-none rounded-xl"
                    />
                    <Button
                      className="h-auto rounded-xl"
                      disabled={!commentBody.trim() || Boolean(savingAction)}
                      onClick={() => void submitComment()}
                    >
                      {savingAction === 'comment' ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Send className="size-4" />
                      )}
                      <span className="sr-only">发表评论</span>
                    </Button>
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
          </section>
        </div>
      </section>

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
            <ImagePicker files={postImages} onChange={setPostImages} />
          </div>
          <DialogFooter className="shrink-0 border-t border-slate-200 px-6 py-4 dark:border-white/10">
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
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CourseSpacePageFrame>
  );
}
