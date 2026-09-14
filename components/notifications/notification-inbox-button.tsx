'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useNotificationStore } from '@/lib/store/notifications';

export function NotificationInboxButton() {
  const [open, setOpen] = useState(false);
  const notifications = useNotificationStore((s) => s.notifications);
  const unread = useNotificationStore((s) => s.unreadCount);
  const userId = useNotificationStore((s) => s.activeUserId);
  const reads = useNotificationStore((s) => s.readByUser);
  const read = new Set(reads[userId] ?? []);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`通知中心，${unread} 条未读`}
          className="relative grid size-8 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:text-slate-300 dark:hover:bg-white/10"
        >
          <Bell className="size-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-red-500 px-1 text-[9px] font-semibold leading-4 text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={14}
        className="w-[min(390px,calc(100vw-24px))] rounded-[26px] border-white/60 bg-white/85 p-3 shadow-[0_20px_65px_rgba(15,23,42,0.18)] backdrop-blur-2xl dark:border-white/15 dark:bg-slate-900/90"
      >
        <div className="flex items-center justify-between px-2 py-3">
          <h2 className="text-base font-semibold">通知中心</h2>
          <button
            type="button"
            disabled={!unread}
            onClick={() => useNotificationStore.getState().markAllAsRead()}
            className="flex items-center gap-1 text-xs text-slate-500 disabled:opacity-40"
          >
            <CheckCheck className="size-4" />
            全部已读
          </button>
        </div>
        <div className="max-h-[min(480px,60vh)] space-y-2 overflow-y-auto">
          {notifications.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-slate-500">
              <Bell className="mx-auto mb-3 size-7 opacity-40" />
              暂时没有新通知<p className="mt-2 text-xs">生成结果和需要处理的事项会保留在这里。</p>
            </div>
          )}
          {notifications.slice(0, 20).map((item) => (
            <Link
              key={item.id}
              href={item.href || '/notifications'}
              onClick={() => {
                useNotificationStore.getState().markAsRead(item.id);
                setOpen(false);
              }}
              className="block rounded-[18px] border border-black/5 bg-white/70 p-3 transition-colors hover:bg-white dark:border-white/5 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <div className="mb-1 flex items-center gap-2 text-[10px] text-slate-500">
                <span className="flex-1">{item.sourceLabel || 'SYNTARA'}</span>
                <time>
                  {new Date(item.createdAt).toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
                {!read.has(item.id) && <span className="size-1.5 rounded-full bg-blue-500" />}
              </div>
              <p className="text-sm font-semibold">{item.title}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {item.body}
              </p>
            </Link>
          ))}
        </div>
        <Link
          href="/notifications"
          onClick={() => setOpen(false)}
          className="mt-2 block rounded-xl py-2 text-center text-xs font-medium text-slate-500 hover:bg-black/5 dark:hover:bg-white/5"
        >
          查看全部通知
        </Link>
      </PopoverContent>
    </Popover>
  );
}
