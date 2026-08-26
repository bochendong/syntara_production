'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, ImagePlus, Loader2, Paperclip, RefreshCw, Send, X } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CourseForumAuthor } from '@/features/course-forum/domain/course-forum';
import { backendFetch, backendJson } from '@/lib/utils/backend-api';
import { cn } from '@/lib/utils';

type DirectMessageAttachment = {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  url: string;
  downloadUrl: string;
};

type DirectMessageAuthor = CourseForumAuthor;

type DirectMessageItem = {
  id: string;
  senderId: string;
  sender: DirectMessageAuthor;
  body: string;
  attachments: DirectMessageAttachment[];
  createdAt: string;
  mine: boolean;
};

type DirectMessageThreadResponse = {
  thread: {
    id: string;
    courseId: string | null;
    viewer: DirectMessageAuthor;
    recipient: DirectMessageAuthor;
  };
  messages: DirectMessageItem[];
};

type DirectMessageSendResponse = {
  message: DirectMessageItem;
};

function initials(name: string) {
  const compact = name.trim();
  return compact.slice(0, 2).toUpperCase() || '同学';
}

function roleBadgeClass(role: CourseForumAuthor['forumRole']) {
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
  return new Date(value).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function parseCommunityInvite(body: string) {
  const match = body
    .trim()
    .match(/^邀请你加入(?:\s+community)?「(.+?)」：\/communities\/([a-z0-9-]+)$/i);
  if (!match) return null;
  return { name: match[1], slug: match[2] };
}

function DirectMessageBubble({
  message,
  acceptingInviteSlug,
  onAcceptInvite,
}: {
  message: DirectMessageItem;
  acceptingInviteSlug: string | null;
  onAcceptInvite: (slug: string) => Promise<void>;
}) {
  const invite = message.body ? parseCommunityInvite(message.body) : null;
  const accepting = invite ? acceptingInviteSlug === invite.slug : false;

  return (
    <div className={cn('flex items-end gap-2', message.mine && 'justify-end')}>
      {!message.mine ? (
        <Avatar size="sm" className="mb-5">
          {message.sender.image ? (
            <AvatarImage src={message.sender.image} alt={message.sender.name} />
          ) : null}
          <AvatarFallback>{initials(message.sender.name)}</AvatarFallback>
        </Avatar>
      ) : null}
      <div className={cn('max-w-[78%]', message.mine && 'items-end text-right')}>
        <div
          className={cn(
            'rounded-2xl px-4 py-3 text-left text-sm leading-6 shadow-sm',
            message.mine
              ? 'rounded-br-md bg-violet-600 text-white'
              : 'rounded-bl-md border border-slate-200 bg-white text-slate-700 dark:border-white/10 dark:bg-slate-950 dark:text-slate-200',
          )}
        >
          {invite ? (
            <div className="w-64 max-w-full rounded-xl border border-violet-100 bg-white p-3 text-slate-900 shadow-sm dark:border-violet-400/20 dark:bg-slate-900 dark:text-slate-50">
              <p className="text-xs font-medium text-slate-500 dark:text-slate-400">邀请你加入</p>
              <p className="mt-1 truncate text-base font-semibold">{invite.name}</p>
              <Button
                type="button"
                size="sm"
                className="mt-3 w-full rounded-lg bg-violet-600 hover:bg-violet-700"
                disabled={accepting}
                onClick={() => void onAcceptInvite(invite.slug)}
              >
                {accepting ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
                点击接受邀请
              </Button>
            </div>
          ) : message.body ? (
            <p className="whitespace-pre-wrap break-words">{message.body}</p>
          ) : null}
          {message.attachments.length ? (
            <div className={cn('grid gap-2', message.body && 'mt-3')}>
              {message.attachments.map((attachment) => (
                <a
                  key={attachment.id}
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block overflow-hidden rounded-xl bg-black/5 ring-1 ring-black/10 dark:bg-white/5 dark:ring-white/10"
                  title={attachment.fileName}
                >
                  <img
                    src={attachment.url}
                    alt={attachment.fileName}
                    className="max-h-72 w-full object-cover"
                  />
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <p className="mt-1 px-1 text-xs text-slate-400">
          {message.mine ? '我' : message.sender.name} · {relativeTime(message.createdAt)}
        </p>
      </div>
    </div>
  );
}

export function DirectMessageThreadClient({
  courseId,
  threadId,
}: {
  courseId?: string;
  threadId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from');
  const returnTo = searchParams.get('returnTo');
  const forumHref = !courseId
    ? returnTo || '/forum'
    : from === 'home'
      ? `/course/${encodeURIComponent(courseId)}/forum?from=home`
      : `/course/${encodeURIComponent(courseId)}/forum`;
  const threadApiBase = courseId
    ? `/api/course-forum/${encodeURIComponent(courseId)}/direct-messages/${encodeURIComponent(
        threadId,
      )}`
    : `/api/forum/direct-messages/${encodeURIComponent(threadId)}`;
  const [thread, setThread] = useState<DirectMessageThreadResponse['thread'] | null>(null);
  const [messages, setMessages] = useState<DirectMessageItem[]>([]);
  const [draft, setDraft] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [acceptingInviteSlug, setAcceptingInviteSlug] = useState<string | null>(null);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const payload = await backendJson<DirectMessageThreadResponse>(threadApiBase, {
        timeoutMs: 20_000,
      });
      setThread(payload.thread);
      setMessages(payload.messages);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '私信加载失败');
    } finally {
      setLoading(false);
    }
  }, [threadApiBase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const send = async () => {
    const body = draft.trim();
    if ((!body && !images.length) || sending) return;
    setSending(true);
    setError('');
    try {
      const form = new FormData();
      form.set('body', body);
      images.forEach((file) => form.append('images', file));
      const response = await backendFetch(threadApiBase, {
        method: 'POST',
        body: form,
        timeoutMs: 30_000,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error || '私信发送失败');
      }
      const payload = (await response.json()) as DirectMessageSendResponse;
      setMessages((current) => [...current, payload.message]);
      setDraft('');
      setImages([]);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : '私信发送失败');
    } finally {
      setSending(false);
    }
  };

  const acceptInvite = async (slug: string) => {
    if (acceptingInviteSlug) return;
    setAcceptingInviteSlug(slug);
    setError('');
    try {
      const payload = await backendJson<{ community: { href: string } }>(
        `/api/communities/${encodeURIComponent(slug)}/join`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ invited: true }),
          timeoutMs: 20_000,
        },
      );
      router.push(payload.community.href);
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : '接受邀请失败');
    } finally {
      setAcceptingInviteSlug(null);
    }
  };

  return (
    <main className="min-h-dvh bg-slate-50 p-4 text-slate-950 dark:bg-slate-950 dark:text-white">
      <div className="mx-auto flex h-[calc(100dvh-32px)] max-w-4xl flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.08)] dark:border-white/10 dark:bg-slate-950">
        <header className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-white/10 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Button asChild variant="ghost" size="icon" className="rounded-xl">
              <Link href={forumHref} aria-label="返回论坛">
                <ArrowLeft className="size-5" />
              </Link>
            </Button>
            {thread ? (
              <div className="flex min-w-0 items-center gap-3">
                <Avatar className="size-10">
                  {thread.recipient.image ? (
                    <AvatarImage src={thread.recipient.image} alt={thread.recipient.name} />
                  ) : null}
                  <AvatarFallback className="bg-violet-50 font-semibold text-violet-700">
                    {initials(thread.recipient.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-base font-semibold">{thread.recipient.name}</h1>
                    {thread.recipient.forumRoleLabel ? (
                      <Badge className={roleBadgeClass(thread.recipient.forumRole)}>
                        {thread.recipient.forumRoleLabel}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="text-xs text-slate-400">论坛私信</p>
                </div>
              </div>
            ) : (
              <div>
                <h1 className="text-base font-semibold">私信</h1>
                <p className="text-xs text-slate-400">正在打开会话</p>
              </div>
            )}
          </div>
          <Button
            variant="outline"
            className="rounded-xl"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={cn('mr-1.5 size-4', loading && 'animate-spin')} />
            刷新
          </Button>
        </header>

        {error ? (
          <div className="shrink-0 border-b border-rose-200 bg-rose-50 px-5 py-3 text-sm text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <section className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-4 py-5 dark:bg-white/[0.025] sm:px-6">
          {loading && !messages.length ? (
            <div className="grid h-full place-items-center text-sm text-slate-500">
              <span className="inline-flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" />
                正在加载私信…
              </span>
            </div>
          ) : messages.length ? (
            <div className="space-y-4">
              {messages.map((message) => (
                <DirectMessageBubble
                  key={message.id}
                  message={message}
                  acceptingInviteSlug={acceptingInviteSlug}
                  onAcceptInvite={acceptInvite}
                />
              ))}
              <div ref={bottomRef} />
            </div>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-slate-500">
              <div>
                <p className="font-medium text-slate-700 dark:text-slate-200">还没有私信</p>
                <p className="mt-1">发送第一条消息开始交流。</p>
              </div>
            </div>
          )}
        </section>

        <footer className="shrink-0 border-t border-slate-200 bg-white p-3 dark:border-white/10 dark:bg-slate-950 sm:p-4">
          <div className="mb-3 rounded-xl border border-dashed border-slate-300 bg-slate-50/70 p-3 dark:border-white/15 dark:bg-white/5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 transition hover:text-violet-700 dark:text-slate-300 dark:hover:text-violet-200"
              >
                <ImagePlus className="size-4 text-violet-600" />
                添加图片
              </button>
              <span className="text-xs text-slate-400">最多 5 张，单张不超过 5 MB</span>
            </div>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              multiple
              className="sr-only"
              onChange={(event) => {
                const selected = Array.from(event.currentTarget.files || []);
                setImages((current) => {
                  const seen = new Set(
                    current.map((file) => `${file.name}:${file.size}:${file.lastModified}`),
                  );
                  const next = [...current];
                  for (const file of selected) {
                    const key = `${file.name}:${file.size}:${file.lastModified}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    next.push(file);
                    if (next.length >= 5) break;
                  }
                  return next;
                });
                event.currentTarget.value = '';
              }}
            />
            {images.length ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {images.map((file, index) => (
                  <button
                    type="button"
                    key={`${file.name}-${file.size}-${index}`}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-slate-600 shadow-sm dark:bg-white/10 dark:text-slate-200"
                    onClick={() => setImages(images.filter((_, fileIndex) => fileIndex !== index))}
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
          <div className="flex gap-2">
            <Textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="输入私信内容…"
              maxLength={4000}
              className="max-h-40 min-h-11 flex-1 resize-y rounded-xl"
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <Button
              className="h-auto rounded-xl bg-violet-600 hover:bg-violet-700"
              disabled={(!draft.trim() && !images.length) || sending}
              onClick={() => void send()}
            >
              {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              <span className="sr-only">发送私信</span>
            </Button>
          </div>
        </footer>
      </div>
    </main>
  );
}
