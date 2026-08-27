'use client';

import { useId, useMemo, useState } from 'react';
import {
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

export type LearnCourseSidebarCourse = {
  name: string;
  code?: string | null;
};

export type LearnCourseSidebarSession = {
  id: string;
  title: string;
  updatedAt: number;
  meta?: string | null;
  deleting?: boolean;
  deleteDisabled?: boolean;
};

export type LearnCourseSidebarProps = {
  course: LearnCourseSidebarCourse;
  sessions: readonly LearnCourseSidebarSession[];
  activeSessionId?: string | null;
  totalCount: number;
  loading?: boolean;
  hasMore?: boolean;
  error?: string | null;
  interactionDisabled?: boolean;
  className?: string;
  onCreateSession: () => void;
  onSelectSession: (session: LearnCourseSidebarSession) => void;
  onDeleteSession: (session: LearnCourseSidebarSession) => void | Promise<void>;
  onShowAllSessions: () => void;
  onRetry?: () => void;
};

type SessionGroupKey = 'today' | 'recent' | 'older';

const MAX_VISIBLE_SESSIONS = 5;
const SESSION_GROUPS: ReadonlyArray<{ key: SessionGroupKey; label: string }> = [
  { key: 'today', label: '今天' },
  { key: 'recent', label: '最近 7 天' },
  { key: 'older', label: '更早' },
];

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

function groupKeyForSession(
  timestamp: number,
  todayStart: number,
  sevenDayStart: number,
): SessionGroupKey {
  if (!Number.isFinite(timestamp) || timestamp < sevenDayStart) return 'older';
  if (timestamp >= todayStart) return 'today';
  return 'recent';
}

export function LearnCourseSidebar({
  course: _course,
  sessions,
  activeSessionId,
  totalCount: _totalCount,
  loading = false,
  hasMore: _hasMore = false,
  error,
  interactionDisabled = false,
  className,
  onCreateSession,
  onSelectSession,
  onDeleteSession,
  onShowAllSessions,
  onRetry,
}: LearnCourseSidebarProps) {
  const historyHeadingId = useId();
  const [groupingAnchor] = useState(Date.now);
  const visibleSessions = useMemo(() => {
    const recent = sessions.slice(0, MAX_VISIBLE_SESSIONS);
    if (!activeSessionId || recent.some((session) => session.id === activeSessionId)) return recent;
    const active = sessions.find((session) => session.id === activeSessionId);
    if (!active) return recent;
    return [...recent.slice(0, MAX_VISIBLE_SESSIONS - 1), active];
  }, [activeSessionId, sessions]);
  const groupedSessions = useMemo(() => {
    const todayStart = localDayStart(groupingAnchor);
    const sevenDayStart = recentSevenDayStart(groupingAnchor);
    const groups = new Map<SessionGroupKey, LearnCourseSidebarSession[]>(
      SESSION_GROUPS.map(({ key }) => [key, []]),
    );

    visibleSessions.forEach((session) => {
      groups.get(groupKeyForSession(session.updatedAt, todayStart, sevenDayStart))?.push(session);
    });

    return SESSION_GROUPS.map(({ key, label }) => ({
      key,
      label,
      sessions: groups.get(key) ?? [],
    })).filter((group) => group.sessions.length > 0);
  }, [groupingAnchor, visibleSessions]);

  return (
    <div
      className={cn(
        'flex h-full min-h-0 w-full flex-col bg-slate-50/90 text-slate-950 dark:bg-slate-950/80 dark:text-slate-50',
        className,
      )}
      aria-busy={loading}
    >
      <section className="shrink-0 px-3 pb-3 pt-4" aria-labelledby={historyHeadingId}>
        <div className="flex items-center justify-between gap-3 px-1">
          <div>
            <h2
              id={historyHeadingId}
              className="text-[15px] font-semibold tracking-[-0.01em] text-slate-950 dark:text-white"
            >
              会话历史
            </h2>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onShowAllSessions}
              disabled={interactionDisabled || loading}
              className="rounded-full text-slate-500 hover:bg-white hover:text-slate-950 dark:text-slate-400 dark:hover:bg-white/[0.08] dark:hover:text-white"
              aria-label="搜索全部会话"
              title="搜索全部会话"
            >
              <Search className="size-4" strokeWidth={1.8} aria-hidden="true" />
            </Button>
          </div>
        </div>

        <Button
          type="button"
          onClick={onCreateSession}
          disabled={interactionDisabled}
          className="mt-3 h-10 w-full justify-start rounded-[11px] bg-slate-950 px-4 text-[13px] font-semibold text-white shadow-sm hover:bg-slate-800 focus-visible:ring-slate-400 dark:bg-slate-100 dark:text-slate-950 dark:hover:bg-white"
        >
          <Plus className="size-4" strokeWidth={1.8} aria-hidden="true" />
          新对话
        </Button>
      </section>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2.5 pb-4" aria-label="当前课程会话历史">
        {error ? (
          <div className="mb-2 rounded-[10px] border border-amber-200/80 bg-amber-50/80 px-2.5 py-2 text-[11px] leading-4 text-amber-800 dark:border-amber-300/20 dark:bg-amber-400/10 dark:text-amber-100">
            <p>云端会话列表暂时不可用，当前显示本机记录。</p>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                className="mt-1 font-semibold underline underline-offset-2"
              >
                重新加载
              </button>
            ) : null}
          </div>
        ) : null}
        {loading ? (
          <div
            className="flex min-h-24 items-center justify-center gap-2 text-xs text-slate-400"
            role="status"
          >
            <Loader2
              className="size-3.5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            加载会话…
          </div>
        ) : groupedSessions.length ? (
          <div className="space-y-4">
            {groupedSessions.map((group) => (
              <section key={group.key} aria-labelledby={`${historyHeadingId}-${group.key}`}>
                <h3
                  id={`${historyHeadingId}-${group.key}`}
                  className="px-2 pb-1 text-[10px] font-semibold text-slate-400"
                >
                  {group.label}
                </h3>
                <div className="space-y-0.5">
                  {group.sessions.map((session) => {
                    const active = session.id === activeSessionId;
                    const deleteDisabled =
                      interactionDisabled || session.deleting || session.deleteDisabled;

                    return (
                      <div
                        key={session.id}
                        className={cn(
                          'group relative flex min-h-10 min-w-0 items-center rounded-[10px] text-[12px] text-slate-600 transition-colors hover:bg-white/80 hover:text-slate-950 focus-within:bg-white/80 dark:text-slate-300 dark:hover:bg-white/[0.06] dark:hover:text-white dark:focus-within:bg-white/[0.06]',
                          active &&
                            'bg-white font-medium text-slate-950 shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.08] dark:text-white dark:ring-white/10',
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectSession(session)}
                          disabled={interactionDisabled}
                          aria-current={active ? 'page' : undefined}
                          className="flex min-h-10 min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5 pr-12 text-left outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:pointer-events-none disabled:opacity-50 dark:focus-visible:ring-sky-300/30"
                          title={session.title}
                        >
                          <MessageCircle
                            className="size-3.5 shrink-0 text-slate-400"
                            strokeWidth={1.65}
                            aria-hidden="true"
                          />
                          <span className="min-w-0 flex-1 truncate">{session.title}</span>
                        </button>

                        <span className="pointer-events-none absolute right-2 max-w-12 truncate text-[10px] font-medium text-slate-400 transition-opacity group-hover:opacity-0 group-focus-within:opacity-0">
                          {session.meta}
                        </span>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              disabled={interactionDisabled}
                              className={cn(
                                'absolute right-1 grid size-7 place-items-center rounded-full text-slate-400 opacity-0 outline-none transition hover:bg-slate-100 hover:text-slate-700 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-sky-300 group-hover:opacity-100 group-focus-within:opacity-100 disabled:pointer-events-none dark:hover:bg-white/[0.08] dark:hover:text-white dark:focus-visible:ring-sky-300/30',
                                session.deleting && 'opacity-100',
                              )}
                              aria-label={`打开会话“${session.title}”的操作菜单`}
                            >
                              {session.deleting ? (
                                <Loader2
                                  className="size-3.5 animate-spin motion-reduce:animate-none"
                                  aria-hidden="true"
                                />
                              ) : (
                                <MoreHorizontal className="size-3.5" aria-hidden="true" />
                              )}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-36 rounded-[10px] p-1.5">
                            <DropdownMenuItem
                              variant="destructive"
                              disabled={deleteDisabled}
                              onSelect={() => void onDeleteSession(session)}
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
          <p className="px-2.5 py-6 text-xs leading-5 text-slate-400">
            还没有会话，先开始一次新的学习对话。
          </p>
        )}
      </nav>
    </div>
  );
}
