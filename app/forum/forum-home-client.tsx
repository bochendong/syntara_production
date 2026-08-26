'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  MessageCircle,
  MessageSquareReply,
  Paperclip,
  PenLine,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import { DirectMessageInboxButton } from '@/components/course-forum/direct-messages/direct-message-inbox-button';
import { StartDirectMessageButton } from '@/components/course-forum/direct-messages/start-direct-message-button';
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
import { normalizeForumMarkdownForDisplay } from '@/lib/course-forum/markdown';
import { AVATAR_OPTIONS, useUserProfileStore } from '@/lib/store/user-profile';
import { backendFetch, backendJson } from '@/lib/utils/backend-api';

type ForumPostItem = {
  id: string;
  title: string;
  bodyPreviewMarkdown: string;
  author: {
    id: string;
    name: string;
    image: string | null;
    forumRole?: 'student' | 'teacher' | 'admin';
    forumRoleLabel?: '学生' | '老师' | '管理员';
  };
  community: { slug: string; name: string } | null;
  course: { courseCode: string | null; name: string } | null;
  attachments: Array<{ id: string; fileName: string; url: string }>;
  comments: Array<{
    id: string;
    body: string;
    createdAt: string;
    author: {
      id: string;
      name: string;
      image: string | null;
      forumRole?: 'student' | 'teacher' | 'admin';
      forumRoleLabel?: '学生' | '老师' | '管理员';
    };
  }>;
  bodyMarkdown: string;
  commentCount: number;
  attachmentCount: number;
  createdAt: string;
};

type ForumPostCommentItem = ForumPostItem['comments'][number];

type ForumCommunityItem = {
  id: string;
  slug: string;
  name: string;
  avatarUrl: string | null;
  memberCount: number;
  postCount: number;
};

type ForumPublicCommunityItem = ForumCommunityItem & {
  description: string | null;
  bannerUrl: string | null;
  isJoined: boolean;
};

type ForumViewer = {
  id: string;
  name: string;
  image: string | null;
  role: string | null;
};

type ForumMemberProfile = {
  viewerId: string;
  userId: string;
  canMessage: boolean;
  author: {
    id: string;
    name: string;
    image: string | null;
    forumRole?: 'student' | 'teacher' | 'admin';
    forumRoleLabel?: '学生' | '老师' | '管理员';
  };
  displayName: string;
  joinedText: string;
  forumHeading: string;
  counts: { posts: number; answers: number; comments: number };
  recentPosts: Array<{
    id: string;
    title: string;
    bodyPreview: string;
    createdAt: string;
    answerCount: number;
    commentCount: number;
  }>;
};

function initials(name: string) {
  return name.trim().slice(0, 2).toUpperCase() || '同学';
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

function roleBadgeClass(role: ForumPostItem['author']['forumRole']) {
  if (role === 'admin') return 'bg-amber-50 text-amber-700 hover:bg-amber-50';
  if (role === 'teacher') return 'bg-sky-50 text-sky-700 hover:bg-sky-50';
  return 'bg-emerald-50 text-emerald-700 hover:bg-emerald-50';
}

async function requestError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  return payload.error || fallback;
}

function ImagePicker({ files, onChange }: { files: File[]; onChange: (files: File[]) => void }) {
  const addFiles = (nextFiles: File[]) => {
    const seen = new Set(files.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
    const merged = [...files];
    for (const file of nextFiles) {
      const key = `${file.name}:${file.size}:${file.lastModified}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(file);
      if (merged.length >= 5) break;
    }
    onChange(merged);
  };

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3 dark:border-white/15 dark:bg-white/5">
      <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-300">
        <ImagePlus className="size-4 text-violet-600" />
        添加图片
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif,.png,.PNG,.jpg,.JPG,.jpeg,.JPEG,.webp,.WEBP,.gif,.GIF"
          multiple
          className="sr-only"
          onChange={(event) => {
            addFiles(Array.from(event.target.files || []));
            event.currentTarget.value = '';
          }}
        />
      </label>
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
              <X className="size-3 text-slate-400" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function ForumHomeClient({
  viewer,
  communities,
  publicCommunities,
  posts,
  backHref,
}: {
  viewer: ForumViewer;
  communities: ForumCommunityItem[];
  publicCommunities: ForumPublicCommunityItem[];
  posts: ForumPostItem[];
  backHref: string;
}) {
  const router = useRouter();
  const profileUserId = useUserProfileStore((state) => state.userId);
  const profileNickname = useUserProfileStore((state) => state.nickname);
  const profileAvatar = useUserProfileStore((state) => state.avatar);
  const profileBio = useUserProfileStore((state) => state.bio);
  const setProfileUserId = useUserProfileStore((state) => state.setProfileUserId);
  const setProfileNickname = useUserProfileStore((state) => state.setNickname);
  const setProfileAvatar = useUserProfileStore((state) => state.setAvatar);
  const setProfileBio = useUserProfileStore((state) => state.setBio);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileNameDraft, setProfileNameDraft] = useState('');
  const [profileAvatarDraft, setProfileAvatarDraft] = useState('');
  const [profileBioDraft, setProfileBioDraft] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPostId, setSelectedPostId] = useState('');
  const [newPostOpen, setNewPostOpen] = useState(false);
  const [postTitle, setPostTitle] = useState('');
  const [postBody, setPostBody] = useState('');
  const [postImages, setPostImages] = useState<File[]>([]);
  const [savingAction, setSavingAction] = useState('');
  const [commentBody, setCommentBody] = useState('');
  const [memberProfileOpen, setMemberProfileOpen] = useState(false);
  const [memberProfileLoading, setMemberProfileLoading] = useState(false);
  const [memberProfile, setMemberProfile] = useState<ForumMemberProfile | null>(null);
  const [commentsByPostId, setCommentsByPostId] = useState(() => {
    const map = new Map<string, ForumPostCommentItem[]>();
    posts.forEach((post) => map.set(post.id, post.comments));
    return map;
  });
  const [error, setError] = useState('');

  const profileBelongsToViewer = profileUserId === viewer.id;
  const viewerName =
    (profileBelongsToViewer ? profileNickname.trim() : '') || viewer.name || '论坛成员';
  const viewerAvatar = (profileBelongsToViewer ? profileAvatar.trim() : '') || viewer.image || '';
  const viewerBio = profileBelongsToViewer ? profileBio.trim() : '';
  const selectedPost = posts.find((post) => post.id === selectedPostId) || null;
  const selectedComments = selectedPost
    ? commentsByPostId.get(selectedPost.id) || selectedPost.comments
    : [];
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  const searchActive = normalizedSearchQuery.length > 0;
  const filteredPublicCommunities = useMemo(() => {
    if (!searchActive) return [];
    return publicCommunities.filter((community) =>
      [community.name, community.slug, community.description || '']
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearchQuery),
    );
  }, [normalizedSearchQuery, publicCommunities, searchActive]);
  const filteredPosts = useMemo(() => {
    if (!searchActive) return posts;
    return posts.filter((post) =>
      [
        post.title,
        post.bodyMarkdown,
        post.bodyPreviewMarkdown,
        post.author.name,
        post.community?.name || '',
        post.community?.slug || '',
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearchQuery),
    );
  }, [normalizedSearchQuery, posts, searchActive]);

  useEffect(() => {
    if (!profileOpen) return;
    setProfileNameDraft(viewerName);
    setProfileAvatarDraft(viewerAvatar);
    setProfileBioDraft(viewerBio);
  }, [profileOpen, viewerAvatar, viewerBio, viewerName]);

  useEffect(() => {
    const map = new Map<string, ForumPostCommentItem[]>();
    posts.forEach((post) => map.set(post.id, post.comments));
    setCommentsByPostId(map);
  }, [posts]);

  const openMemberProfile = async (userId: string) => {
    if (!userId || memberProfileLoading) return;
    setMemberProfileOpen(true);
    setMemberProfileLoading(true);
    setMemberProfile(null);
    setError('');
    try {
      const profile = await backendJson<ForumMemberProfile>(
        `/api/forum/users/${encodeURIComponent(userId)}/profile`,
        { timeoutMs: 20_000 },
      );
      setMemberProfile(profile);
    } catch (profileError) {
      setError(profileError instanceof Error ? profileError.message : '成员介绍加载失败');
    } finally {
      setMemberProfileLoading(false);
    }
  };

  const saveProfile = async () => {
    const nextName = profileNameDraft.trim().slice(0, 60);
    const nextAvatar = profileAvatarDraft.trim().slice(0, 2000) || AVATAR_OPTIONS[0] || '';
    const nextBio = profileBioDraft.trim().slice(0, 160);
    setProfileUserId(viewer.id);
    setProfileNickname(nextName);
    setProfileAvatar(nextAvatar);
    setProfileBio(nextBio);
    setProfileOpen(false);
    try {
      await backendFetch('/api/profile/forum', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: nextName, image: nextAvatar }),
        timeoutMs: 20_000,
      });
      router.refresh();
    } catch {
      setError('个人主页已在本机保存，但同步到服务器失败。');
    }
  };

  const refresh = () => {
    setRefreshing(true);
    router.refresh();
    window.setTimeout(() => setRefreshing(false), 450);
  };

  const createPost = async () => {
    if (!postTitle.trim() || !postBody.trim() || savingAction) return;
    setSavingAction('post');
    setError('');
    try {
      const form = new FormData();
      form.set('title', postTitle.trim());
      form.set('bodyMarkdown', postBody.trim());
      postImages.forEach((file) => form.append('images', file));
      const response = await backendFetch('/api/forum/posts', {
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
      setSelectedPostId(payload.postId);
      router.refresh();
    } catch (postError) {
      setError(postError instanceof Error ? postError.message : '发布问题失败');
    } finally {
      setSavingAction('');
    }
  };

  const submitComment = async () => {
    if (!selectedPost || !commentBody.trim() || savingAction) return;
    setSavingAction('comment');
    setError('');
    try {
      const response = await backendFetch(
        `/api/forum/posts/${encodeURIComponent(selectedPost.id)}/comments`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ body: commentBody.trim() }),
          timeoutMs: 20_000,
        },
      );
      if (!response.ok) throw new Error(await requestError(response, '评论失败'));
      const payload = (await response.json()) as { comment: ForumPostCommentItem };
      setCommentsByPostId((previous) => {
        const next = new Map(previous);
        next.set(selectedPost.id, [...(next.get(selectedPost.id) || []), payload.comment]);
        return next;
      });
      setCommentBody('');
      router.refresh();
    } catch (commentError) {
      setError(commentError instanceof Error ? commentError.message : '评论失败');
    } finally {
      setSavingAction('');
    }
  };

  return (
    <main className="min-h-dvh bg-slate-50 p-3 text-slate-950 dark:bg-slate-950 dark:text-white sm:p-4">
      <section className="mx-auto flex min-h-[calc(100dvh-24px)] max-w-[1536px] flex-col overflow-hidden rounded-[28px] border border-slate-200/80 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-slate-950 sm:min-h-[calc(100dvh-32px)]">
        <header className="border-b border-slate-200/80 px-4 py-4 dark:border-white/10 sm:px-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Button asChild variant="ghost" size="icon" className="mt-0.5 shrink-0 rounded-xl">
                <Link href={backHref} aria-label="返回主界面">
                  <ArrowLeft className="size-5" />
                </Link>
              </Button>
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  Syntara Forum
                </p>
                <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">论坛</h1>
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
              <DirectMessageInboxButton />
              <Button
                variant="outline"
                className="rounded-xl"
                onClick={refresh}
                disabled={refreshing}
              >
                <RefreshCw className={`mr-1.5 size-4 ${refreshing ? 'animate-spin' : ''}`} />
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
              style={{ width: 'calc(50% - 28rem - 2rem)', minWidth: 240, maxWidth: 420 }}
            >
              <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-white/10 dark:bg-slate-950">
                <div className="h-20 bg-[radial-gradient(circle_at_18%_0%,rgba(139,92,246,0.30),transparent_34%),linear-gradient(135deg,rgba(224,242,254,0.95),rgba(245,243,255,0.95))] dark:bg-[radial-gradient(circle_at_18%_0%,rgba(139,92,246,0.34),transparent_34%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(49,46,129,0.55))]" />
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
                <div className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left">
                  <span>
                    <span className="block text-sm font-bold text-slate-950 dark:text-slate-50">
                      Communities
                    </span>
                    <span className="block text-xs text-slate-400">已加入的 community</span>
                  </span>
                </div>
                <div className="border-t border-slate-200 dark:border-white/10">
                  <div className="max-h-80 overflow-y-auto p-2">
                    {communities.length ? (
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
                      asChild
                      variant="ghost"
                      className="w-full justify-start rounded-xl text-sm"
                    >
                      <Link href="/communities">
                        <Plus className="mr-1.5 size-4" />
                        新建 Community
                      </Link>
                    </Button>
                  </div>
                </div>
              </section>
            </aside>

            <section className="mx-auto min-w-0 max-w-4xl">
              <div className="pb-4">
                <div className="relative">
                  <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="搜索标题、正文或 public community"
                    className="h-12 rounded-2xl bg-white pl-10 text-base shadow-sm dark:bg-white/5"
                  />
                  {searchQuery ? (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute top-1/2 right-3 grid size-7 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200"
                      aria-label="清空搜索"
                    >
                      <X className="size-4" />
                    </button>
                  ) : null}
                </div>
              </div>

              {searchActive && filteredPublicCommunities.length ? (
                <section className="mb-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-slate-950">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Public communities
                    </h2>
                    <span className="text-xs text-slate-400">
                      {filteredPublicCommunities.length} 个结果
                    </span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {filteredPublicCommunities.slice(0, 6).map((community) => (
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

              {filteredPosts.length ? (
                <div className="space-y-3">
                  {filteredPosts.map((post) => (
                    <article
                      key={post.id}
                      className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm dark:border-white/10 dark:bg-slate-950"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void openMemberProfile(post.author.id);
                          }}
                          className="flex min-w-0 items-center gap-2.5 rounded-xl text-left transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none dark:hover:bg-white/[0.035]"
                          aria-label={`查看 ${post.author.name} 的资料`}
                        >
                          <Avatar className="size-9">
                            {post.author.image ? (
                              <AvatarImage src={post.author.image} alt={post.author.name} />
                            ) : null}
                            <AvatarFallback className="bg-violet-50 text-[10px] font-semibold text-violet-700">
                              {initials(post.author.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">
                                {post.author.name}
                              </span>
                              <Badge
                                className={`h-4 px-1.5 text-[10px] ${roleBadgeClass(post.author.forumRole)}`}
                              >
                                {post.author.forumRoleLabel}
                              </Badge>
                            </div>
                            <span className="text-xs text-slate-400">
                              {relativeTime(post.createdAt)}
                            </span>
                          </div>
                        </button>
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          setCommentBody('');
                          setSelectedPostId(post.id);
                        }}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter' && event.key !== ' ') return;
                          event.preventDefault();
                          setCommentBody('');
                          setSelectedPostId(post.id);
                        }}
                        className="mt-4 block w-full rounded-xl text-left transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none dark:hover:bg-white/[0.035]"
                      >
                        <h2 className="line-clamp-1 text-xl font-bold tracking-tight">
                          {post.title}
                        </h2>
                        <MessageResponse className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
                          {normalizeForumMarkdownForDisplay(post.bodyPreviewMarkdown)}
                        </MessageResponse>
                        {post.attachments.length ? (
                          <div className="mt-3 grid h-28 grid-cols-2 gap-2 overflow-hidden">
                            {post.attachments.map((attachment) => (
                              <div
                                key={attachment.id}
                                className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100 dark:border-white/10 dark:bg-slate-900"
                              >
                                <img
                                  src={attachment.url}
                                  alt={attachment.fileName}
                                  className="size-full object-cover"
                                />
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        {post.community ? (
                          <Badge className="bg-sky-50 text-sky-700 hover:bg-sky-50">
                            c/{post.community.name}
                          </Badge>
                        ) : null}
                        <span className="inline-flex items-center gap-1">
                          <MessageCircle className="size-3.5" />
                          {post.commentCount}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Paperclip className="size-3.5" />
                          {post.attachmentCount}
                        </span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="grid min-h-52 place-items-center px-6 text-center text-sm text-slate-500">
                  <div>
                    <MessageCircle className="mx-auto size-7 text-slate-300" />
                    <p className="mt-3">
                      {searchActive
                        ? filteredPublicCommunities.length
                          ? '没有找到匹配的帖子'
                          : '没有找到匹配的帖子或 public community'
                        : '当前筛选下还没有帖子'}
                    </p>
                  </div>
                </div>
              )}
            </section>
          </div>
        </div>
      </section>

      <Dialog open={Boolean(selectedPost)} onOpenChange={(open) => !open && setSelectedPostId('')}>
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
            <DialogTitle>{selectedPost?.title || '帖子详情'}</DialogTitle>
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
            {selectedPost ? (
              <div className="w-full px-6 py-5 pr-16 sm:px-10 sm:py-6 sm:pr-20 lg:px-14">
                <article>
                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => void openMemberProfile(selectedPost.author.id)}
                      className="flex min-w-0 items-center gap-2.5 rounded-xl text-left transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:outline-none dark:hover:bg-white/[0.035]"
                      aria-label={`查看 ${selectedPost.author.name} 的资料`}
                    >
                      <Avatar className="size-10">
                        {selectedPost.author.image ? (
                          <AvatarImage
                            src={selectedPost.author.image}
                            alt={selectedPost.author.name}
                          />
                        ) : null}
                        <AvatarFallback className="bg-violet-50 text-xs font-semibold text-violet-700">
                          {initials(selectedPost.author.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 text-sm">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] font-medium text-slate-400">提问者</span>
                          <span className="font-semibold text-slate-700 dark:text-slate-200">
                            {selectedPost.author.name}
                          </span>
                          {selectedPost.author.forumRoleLabel ? (
                            <Badge
                              className={`h-4 px-1.5 text-[10px] ${roleBadgeClass(selectedPost.author.forumRole)}`}
                            >
                              {selectedPost.author.forumRoleLabel}
                            </Badge>
                          ) : null}
                        </div>
                        <span className="text-slate-400">
                          {relativeTime(selectedPost.createdAt)}
                        </span>
                      </div>
                    </button>
                    <h2 className="text-2xl font-semibold tracking-tight sm:text-[28px]">
                      {selectedPost.title}
                    </h2>
                  </div>
                  <MessageResponse
                    mode="static"
                    className="mt-4 text-[15px] leading-7 text-slate-700 dark:text-slate-200 [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-slate-200 [&_pre]:bg-slate-950 [&_pre]:text-slate-100 dark:[&_pre]:border-white/10"
                  >
                    {normalizeForumMarkdownForDisplay(selectedPost.bodyMarkdown)}
                  </MessageResponse>
                  {selectedPost.attachments.length ? (
                    <div className="mt-4 flex flex-wrap gap-2.5">
                      {selectedPost.attachments.map((attachment) => (
                        <a
                          key={attachment.id}
                          href={attachment.url}
                          target="_blank"
                          rel="noreferrer"
                          className="group w-[148px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:w-[168px] dark:border-white/10 dark:bg-white/5"
                        >
                          <span className="block aspect-[4/3] w-full overflow-hidden bg-slate-100 dark:bg-slate-900">
                            <img
                              src={attachment.url}
                              alt={attachment.fileName}
                              className="size-full object-cover transition duration-200 group-hover:scale-[1.02]"
                            />
                          </span>
                          <span className="block truncate px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-300">
                            {attachment.fileName}
                          </span>
                        </a>
                      ))}
                    </div>
                  ) : null}
                </article>

                <section className="mt-6 rounded-[24px] border border-slate-200 bg-slate-100/70 p-5 dark:border-white/10 dark:bg-white/[0.035] sm:p-6">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                      评论
                    </h3>
                    <Badge variant="outline" className="bg-white/70 dark:bg-white/5">
                      {selectedComments.length} 条
                    </Badge>
                  </div>
                  <div className="mt-5 divide-y divide-slate-200/80 overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:divide-white/10 dark:border-white/10 dark:bg-slate-950/55">
                    {selectedComments.map((comment) => (
                      <div key={comment.id} className="px-4 py-3.5">
                        <div className="flex items-start gap-3">
                          <Avatar size="sm" className="mt-0.5">
                            {comment.author.image ? (
                              <AvatarImage src={comment.author.image} alt={comment.author.name} />
                            ) : null}
                            <AvatarFallback className="text-[10px]">
                              {initials(comment.author.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0 flex-1 rounded-xl text-left">
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                              <span className="font-medium text-slate-700 dark:text-slate-200">
                                {comment.author.name}
                              </span>
                              {comment.author.forumRoleLabel ? (
                                <Badge
                                  className={`h-4 px-1.5 text-[10px] ${roleBadgeClass(comment.author.forumRole)}`}
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
                        </div>
                      </div>
                    ))}
                    {!selectedComments.length ? (
                      <p className="py-6 text-center text-sm text-slate-400">暂无评论</p>
                    ) : null}
                  </div>
                </section>
              </div>
            ) : null}
          </div>
          {selectedPost ? (
            <div className="shrink-0 border-t border-slate-200 bg-white/95 px-5 py-4 shadow-[0_-12px_32px_rgba(15,23,42,0.06)] dark:border-white/10 dark:bg-slate-950/95">
              <div className="flex gap-2">
                <Textarea
                  value={commentBody}
                  onChange={(event) => setCommentBody(event.target.value)}
                  placeholder="补充信息或追问…"
                  maxLength={2000}
                  className="min-h-11 flex-1 resize-none rounded-xl bg-slate-50 dark:bg-slate-900"
                />
                <Button
                  className="h-auto rounded-xl bg-violet-600 px-4 hover:bg-violet-700"
                  disabled={!commentBody.trim() || savingAction === 'comment'}
                  onClick={() => void submitComment()}
                >
                  {savingAction === 'comment' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <MessageCircle className="size-4" />
                  )}
                  <span className="sr-only">发表评论</span>
                </Button>
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={memberProfileOpen} onOpenChange={setMemberProfileOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex w-[min(94vw,1024px)] max-w-none flex-col overflow-hidden rounded-[28px] border-slate-200 p-0 shadow-[0_28px_90px_rgba(15,23,42,0.24)] dark:border-white/10"
          style={{ height: 'min(88dvh, 760px)', maxHeight: 'none' }}
        >
          <DialogHeader className="sr-only">
            <DialogTitle>成员介绍</DialogTitle>
            <DialogDescription>查看论坛成员介绍。</DialogDescription>
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

          {memberProfileLoading ? (
            <div className="grid min-h-[420px] place-items-center text-slate-500">
              <Loader2 className="size-6 animate-spin" />
            </div>
          ) : memberProfile ? (
            <>
              <header className="shrink-0 border-b border-slate-200 px-5 py-4 pr-14 dark:border-white/10 sm:px-7">
                <p className="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">
                  {memberProfile.forumHeading}
                </p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">成员介绍</h2>
              </header>

              <section className="shrink-0 border-b border-slate-200 bg-gradient-to-br from-violet-50 via-white to-sky-50 px-5 py-6 dark:border-white/10 dark:from-violet-400/10 dark:via-white/[0.04] dark:to-sky-400/10 sm:px-7">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-center gap-4">
                    <Avatar className="size-20 ring-4 ring-white dark:ring-slate-900">
                      {memberProfile.author.image ? (
                        <AvatarImage
                          src={memberProfile.author.image}
                          alt={memberProfile.author.name}
                        />
                      ) : null}
                      <AvatarFallback className="bg-violet-100 text-xl font-semibold text-violet-700">
                        {initials(memberProfile.author.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-2xl font-semibold tracking-tight">
                          {memberProfile.author.name}
                        </h3>
                        {memberProfile.author.forumRoleLabel ? (
                          <Badge className={roleBadgeClass(memberProfile.author.forumRole)}>
                            {memberProfile.author.forumRoleLabel}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-2 text-sm text-slate-500 dark:text-slate-300">
                        {memberProfile.joinedText} · 昵称来自论坛账号 {memberProfile.displayName}
                      </p>
                    </div>
                  </div>
                  {memberProfile.canMessage ? (
                    <div className="flex">
                      <StartDirectMessageButton
                        recipientId={memberProfile.userId}
                        currentUserId={memberProfile.viewerId}
                      />
                    </div>
                  ) : null}
                  <div className="grid grid-cols-3 gap-2 sm:w-72">
                    {[
                      { label: '帖子', value: memberProfile.counts.posts },
                      { label: '解答', value: memberProfile.counts.answers },
                      { label: '评论', value: memberProfile.counts.comments },
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
                {memberProfile.recentPosts.length ? (
                  <div className="space-y-3">
                    {memberProfile.recentPosts.map((post) => (
                      <article
                        key={post.id}
                        className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-white/10 dark:bg-white/[0.035]"
                      >
                        <h4 className="line-clamp-2 text-base font-semibold">{post.title}</h4>
                        <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500 dark:text-slate-400">
                          {post.bodyPreview}
                        </p>
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
                    这个成员还没有在论坛发帖。
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

      <Dialog open={newPostOpen} onOpenChange={setNewPostOpen}>
        <DialogContent
          showCloseButton={false}
          className="flex h-[96dvh] max-h-[1100px] w-[min(98vw,1540px)] max-w-none flex-col overflow-hidden p-0"
        >
          <DialogHeader className="sr-only">
            <DialogTitle>发布问题</DialogTitle>
            <DialogDescription>用 Markdown、代码块和数学公式完整描述问题。</DialogDescription>
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
            <ForumMarkdownEditor
              value={postBody}
              onChange={setPostBody}
              placeholder={'支持 Markdown，例如：\n\n```python\na = [1, 2]\nb = a\n```'}
              className="min-h-[620px] lg:h-[calc(96dvh-300px)] lg:max-h-[760px]"
            />
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
            <DialogDescription>设置你在论坛里的头像、昵称和个性签名。</DialogDescription>
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
                        className="grid place-items-center rounded-full p-1 transition hover:bg-violet-100 dark:hover:bg-violet-400/20"
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
              onClick={() => void saveProfile()}
            >
              保存个人主页
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
