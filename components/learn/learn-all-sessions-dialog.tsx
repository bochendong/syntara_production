'use client';

import { useId, useMemo, useState } from 'react';
import { Loader2, MessageCircle, MoreHorizontal, Search, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  SYNTARA_ACTION_DIALOG_CONTENT_CLASS,
  SYNTARA_DIALOG_HEADER_CLASS,
} from '@/components/ui/syntara-dialog-style';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type LearnAllSessionsDialogSession = {
  id: string;
  title: string;
  updatedAt: number;
  deleting?: boolean;
  deleteDisabled?: boolean;
};

export type LearnAllSessionsDialogProps = {
  sessions: readonly LearnAllSessionsDialogSession[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  activeSessionId?: string | null;
  totalCount: number;
  loading?: boolean;
  loadingMore?: boolean;
  hasMore?: boolean;
  error?: string | null;
  onSelect: (session: LearnAllSessionsDialogSession) => void;
  onDelete: (session: LearnAllSessionsDialogSession) => void | Promise<void>;
  onLoadMore: () => void | Promise<void>;
};

type SessionGroupKey = 'today' | 'recent' | 'older';

type SessionGroup = {
  key: SessionGroupKey;
  label: string;
  sessions: LearnAllSessionsDialogSession[];
};

const SESSION_GROUP_ORDER: ReadonlyArray<{
  key: SessionGroupKey;
  label: string;
}> = [
  { key: 'today', label: '今天' },
  { key: 'recent', label: '最近 7 天' },
  { key: 'older', label: '更早' },
];

const timeFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const weekdayTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

const olderDateTimeFormatter = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

function localDayStart(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function recentSevenDayStart(timestamp: number) {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - 6);
  return date.getTime();
}

function sessionGroupKey(
  timestamp: number,
  todayStart: number,
  sevenDayStart: number,
): SessionGroupKey {
  if (!Number.isFinite(timestamp) || timestamp < sevenDayStart) return 'older';
  if (timestamp >= todayStart) return 'today';
  return 'recent';
}

function formatSessionTimestamp(timestamp: number, group: SessionGroupKey) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '时间未知';

  const value = new Date(timestamp);
  if (Number.isNaN(value.getTime())) return '时间未知';

  if (group === 'today') return `今天 ${timeFormatter.format(value)}`;
  if (group === 'recent') return weekdayTimeFormatter.format(value);
  return olderDateTimeFormatter.format(value);
}

export function LearnAllSessionsDialog({
  sessions,
  open,
  onOpenChange,
  activeSessionId,
  totalCount,
  loading = false,
  loadingMore = false,
  hasMore = false,
  error,
  onSelect,
  onDelete,
  onLoadMore,
}: LearnAllSessionsDialogProps) {
  const searchInputId = useId();
  const [searchQuery, setSearchQuery] = useState('');
  const [groupingAnchor, setGroupingAnchor] = useState(Date.now);
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('zh-CN');
  const safeTotalCount = Math.max(totalCount, sessions.length);

  const groups = useMemo<SessionGroup[]>(() => {
    const todayStart = localDayStart(groupingAnchor);
    const sevenDayStart = recentSevenDayStart(groupingAnchor);
    const grouped = new Map<SessionGroupKey, LearnAllSessionsDialogSession[]>(
      SESSION_GROUP_ORDER.map(({ key }) => [key, []]),
    );

    [...sessions]
      .filter((session) =>
        normalizedQuery ? session.title.toLocaleLowerCase('zh-CN').includes(normalizedQuery) : true,
      )
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .forEach((session) => {
        const key = sessionGroupKey(session.updatedAt, todayStart, sevenDayStart);
        grouped.get(key)?.push(session);
      });

    return SESSION_GROUP_ORDER.map(({ key, label }) => ({
      key,
      label,
      sessions: grouped.get(key) ?? [],
    })).filter((group) => group.sessions.length > 0);
  }, [groupingAnchor, normalizedQuery, sessions]);

  const visibleSessionCount = groups.reduce((count, group) => count + group.sessions.length, 0);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSearchQuery('');
      setGroupingAnchor(Date.now());
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className={cn(
          SYNTARA_ACTION_DIALOG_CONTENT_CLASS,
          'max-h-[70dvh] min-h-[360px] max-w-[480px] gap-0 p-0',
        )}
      >
        <DialogHeader className={SYNTARA_DIALOG_HEADER_CLASS}>
          <div className="flex min-w-0 items-baseline gap-2">
            <DialogTitle className="truncate text-[18px] font-semibold tracking-[-0.02em] text-slate-950 dark:text-white">
              全部会话
            </DialogTitle>
            <span className="shrink-0 text-xs font-medium tabular-nums text-slate-400">
              {hasMore ? `已加载 ${sessions.length}+ 条` : `${safeTotalCount} 个会话`}
            </span>
          </div>
          <DialogDescription className="sr-only">
            搜索、打开或删除当前课程的全部会话。
          </DialogDescription>

          <div className="relative mt-3">
            <label htmlFor={searchInputId} className="sr-only">
              搜索会话
            </label>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              strokeWidth={1.8}
              aria-hidden="true"
            />
            <Input
              id={searchInputId}
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索会话"
              autoComplete="off"
              className="h-9 rounded-[10px] border-slate-200 bg-slate-50/80 pl-9 pr-3 text-[13px] shadow-none focus-visible:border-sky-300 focus-visible:ring-sky-200/60 dark:border-white/10 dark:bg-white/[0.05] dark:focus-visible:border-sky-300/40 dark:focus-visible:ring-sky-300/20"
            />
          </div>
        </DialogHeader>

        <div
          className="min-h-0 flex-1 overflow-y-auto px-3 py-3"
          aria-busy={loading || loadingMore}
        >
          {loading && sessions.length === 0 ? (
            <div
              className="flex min-h-48 items-center justify-center gap-2 text-sm text-slate-400"
              role="status"
            >
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
              正在加载会话…
            </div>
          ) : groups.length ? (
            <div className="space-y-4">
              {groups.map((group) => (
                <section key={group.key} aria-labelledby={`${searchInputId}-${group.key}`}>
                  <h3
                    id={`${searchInputId}-${group.key}`}
                    className="px-2 pb-1.5 text-[11px] font-semibold text-slate-400"
                  >
                    {group.label}
                  </h3>
                  <div className="space-y-0.5">
                    {group.sessions.map((session) => {
                      const active = session.id === activeSessionId;
                      const deleteDisabled =
                        session.deleting || session.deleteDisabled || loadingMore;
                      const timestampLabel = formatSessionTimestamp(session.updatedAt, group.key);

                      return (
                        <div
                          key={session.id}
                          className={cn(
                            'group flex min-h-[52px] min-w-0 items-center rounded-[12px] text-slate-600 transition-colors hover:bg-slate-50 focus-within:bg-slate-50 dark:text-slate-300 dark:hover:bg-white/[0.05] dark:focus-within:bg-white/[0.05]',
                            active &&
                              'bg-slate-100 text-slate-950 dark:bg-white/[0.08] dark:text-white',
                          )}
                        >
                          <button
                            type="button"
                            onClick={() => onSelect(session)}
                            aria-current={active ? 'page' : undefined}
                            className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 rounded-[12px] px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-300 dark:focus-visible:ring-sky-300/30"
                          >
                            <MessageCircle
                              className="size-4 shrink-0 text-slate-400"
                              strokeWidth={1.65}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1">
                              <span
                                className="block truncate text-[13px] font-medium"
                                title={session.title}
                              >
                                {session.title}
                              </span>
                              <span className="mt-0.5 block truncate text-[10px] font-medium text-slate-400">
                                {timestampLabel}
                              </span>
                            </span>
                            {active ? (
                              <span className="shrink-0 rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-semibold text-sky-700 ring-1 ring-sky-100 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-300/15">
                                当前
                              </span>
                            ) : null}
                          </button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-sm"
                                className="mr-2 rounded-full text-slate-400 opacity-70 hover:bg-slate-100 hover:text-slate-700 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-white/[0.08] dark:hover:text-white"
                                aria-label={`打开会话“${session.title}”的操作菜单`}
                              >
                                {session.deleting ? (
                                  <Loader2
                                    className="size-3.5 animate-spin motion-reduce:animate-none"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <MoreHorizontal className="size-4" aria-hidden="true" />
                                )}
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-36 rounded-[10px] p-1.5">
                              <DropdownMenuItem
                                variant="destructive"
                                disabled={deleteDisabled}
                                onSelect={() => void onDelete(session)}
                                className="rounded-[8px] text-xs"
                              >
                                {session.deleting ? (
                                  <Loader2
                                    className="size-3.5 animate-spin motion-reduce:animate-none"
                                    aria-hidden="true"
                                  />
                                ) : (
                                  <Trash2 className="size-3.5" aria-hidden="true" />
                                )}
                                {session.deleting ? '正在删除' : '删除会话'}
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="flex min-h-40 items-center justify-center px-6 text-center text-sm leading-6 text-slate-400">
              {normalizedQuery ? `没有找到“${searchQuery.trim()}”` : '还没有会话。'}
            </div>
          )}

          <div className="mt-3 border-t border-slate-200/80 px-2 pb-1 pt-3 dark:border-white/10">
            <div className="min-h-5" aria-live="polite">
              {error ? (
                <p className="text-center text-xs leading-5 text-rose-600 dark:text-rose-300">
                  {error}
                </p>
              ) : loadingMore ? (
                <p className="text-center text-xs text-slate-400">正在加载更多会话…</p>
              ) : loading && sessions.length > 0 ? (
                <p className="text-center text-xs text-slate-400">正在刷新会话…</p>
              ) : normalizedQuery ? (
                <p className="text-center text-[11px] text-slate-400">
                  当前已加载会话中找到 {visibleSessionCount} 条
                </p>
              ) : null}
            </div>

            {hasMore || Boolean(error) ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => void onLoadMore()}
                disabled={loadingMore}
                className="mt-2 h-9 w-full rounded-[10px] bg-white text-xs font-semibold shadow-none dark:bg-white/[0.04]"
              >
                {loadingMore ? (
                  <Loader2
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : null}
                {loadingMore ? '正在加载' : error ? '重试加载' : '加载更多'}
              </Button>
            ) : !loading && !error && sessions.length > 0 ? (
              <p className="py-1 text-center text-[11px] text-slate-400">已经到底了</p>
            ) : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
