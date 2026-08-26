'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, Mail, MessageCircle, RefreshCw } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { CourseForumAuthor } from '@/features/course-forum/domain/course-forum';
import { cn } from '@/lib/utils';
import { backendJson } from '@/lib/utils/backend-api';

type DirectMessageContact = {
  user: CourseForumAuthor;
  threadId: string | null;
  lastMessageAt: string | null;
  lastMessageBody: string | null;
  lastMessageMine: boolean;
  isCourseMember: boolean;
};

type DirectMessageInboxResponse = {
  contacts: DirectMessageContact[];
};

type StartDirectMessageResponse = {
  threadId: string;
};

function initials(name: string) {
  const compact = name.trim();
  return compact.slice(0, 2).toUpperCase() || '同学';
}

function roleBadgeClass(role: CourseForumAuthor['forumRole']) {
  if (role === 'admin')
    return 'bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200';
  if (role === 'teacher') return 'bg-sky-100 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200';
  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200';
}

function relativeTime(value: string | null) {
  if (!value) return '';
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

function previewMessage(body: string) {
  const invite = body
    .trim()
    .match(/^邀请你加入(?:\s+community)?「(.+?)」：\/communities\/([a-z0-9-]+)$/i);
  if (invite) return `邀请你加入 ${invite[1]}`;
  return body;
}

export function DirectMessageInboxButton({ courseId }: { courseId?: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const from = searchParams.get('from');
  const returnTo = searchParams.get('returnTo');
  const [open, setOpen] = useState(false);
  const [contacts, setContacts] = useState<DirectMessageContact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openingUserId, setOpeningUserId] = useState<string | null>(null);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const payload = await backendJson<DirectMessageInboxResponse>('/api/forum/direct-messages', {
        timeoutMs: 20_000,
      });
      setContacts(payload.contacts);
    } catch (err) {
      setError(err instanceof Error ? err.message : '私信列表加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  const openThread = async (contact: DirectMessageContact) => {
    if (openingUserId) return;
    setOpeningUserId(contact.user.id);
    try {
      let threadId = contact.threadId;
      if (!threadId) {
        const payload = await backendJson<StartDirectMessageResponse>(
          '/api/forum/direct-messages',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ recipientId: contact.user.id }),
            timeoutMs: 20_000,
          },
        );
        threadId = payload.threadId;
      }
      router.push(
        `/forum/messages/${encodeURIComponent(threadId)}${
          courseId
            ? `?returnTo=${encodeURIComponent(
                `/course/${encodeURIComponent(courseId)}/forum${from === 'home' ? '?from=home' : ''}`,
              )}`
            : returnTo
              ? `?returnTo=${encodeURIComponent(`/forum?returnTo=${encodeURIComponent(returnTo)}`)}`
              : ''
        }`,
      );
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '打开私信失败');
    } finally {
      setOpeningUserId(null);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) void loadContacts();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="rounded-xl">
          <Mail className="mr-1.5 size-4" />
          私信
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(420px,calc(100vw-32px))] rounded-2xl p-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/10">
          <div>
            <div className="text-sm font-semibold text-slate-950 dark:text-slate-50">私信</div>
            <div className="text-xs text-slate-500">联系人和历史会话</div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 rounded-lg"
            onClick={() => void loadContacts()}
          >
            {loading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
          </Button>
        </div>

        {error ? (
          <div className="border-b border-rose-100 bg-rose-50 px-4 py-2 text-xs text-rose-600 dark:border-rose-500/20 dark:bg-rose-500/10">
            {error}
          </div>
        ) : null}

        <ScrollArea className="max-h-[420px]">
          <div className="p-2">
            {loading && contacts.length === 0 ? (
              <div className="flex h-28 items-center justify-center text-sm text-slate-500">
                <Loader2 className="mr-2 size-4 animate-spin" />
                加载私信列表...
              </div>
            ) : contacts.length === 0 ? (
              <div className="flex h-28 flex-col items-center justify-center text-sm text-slate-500">
                <MessageCircle className="mb-2 size-5" />
                暂无联系人
              </div>
            ) : (
              contacts.map((contact) => {
                const opening = openingUserId === contact.user.id;
                return (
                  <button
                    key={contact.user.id}
                    type="button"
                    className={cn(
                      'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition',
                      'hover:bg-violet-50 focus-visible:bg-violet-50 focus-visible:outline-none dark:hover:bg-white/10',
                    )}
                    onClick={() => void openThread(contact)}
                  >
                    <Avatar
                      size="sm"
                      className="size-9 ring-2 ring-violet-100 dark:ring-violet-400/20"
                    >
                      {contact.user.image ? (
                        <AvatarImage src={contact.user.image} alt={contact.user.name} />
                      ) : null}
                      <AvatarFallback className="bg-violet-50 text-xs font-semibold text-violet-700">
                        {initials(contact.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">
                          {contact.user.name}
                        </span>
                        {contact.user.forumRoleLabel ? (
                          <span
                            className={cn(
                              'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                              roleBadgeClass(contact.user.forumRole),
                            )}
                          >
                            {contact.user.forumRoleLabel}
                          </span>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {contact.lastMessageBody
                          ? `${contact.lastMessageMine ? '我：' : ''}${previewMessage(contact.lastMessageBody)}`
                          : '论坛成员'}
                      </span>
                    </span>
                    <span className="ml-2 flex shrink-0 items-center text-xs text-slate-400">
                      {opening ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        relativeTime(contact.lastMessageAt)
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
