'use client';

import Link from 'next/link';
import { LayoutGrid, LogOut, UserRound } from 'lucide-react';
import { SyntaraMark } from '@/components/brand/syntara-mark';
import { Button } from '@/components/ui/button';
import { useAuthSignOut } from '@/lib/hooks/use-auth-sign-out';
import { useAuthStore } from '@/lib/store/auth';

export function StudentPortalHeader({
  compact = false,
  homeHref = '/learn',
  previewMode = false,
}: {
  compact?: boolean;
  homeHref?: string;
  previewMode?: boolean;
}) {
  const name = useAuthStore((state) => state.name);
  const signOut = useAuthSignOut();

  return (
    <header className="flex min-h-14 items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/88 px-4 py-2.5 shadow-[0_14px_34px_rgba(15,23,42,0.055)] backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/70">
      <div className="flex min-w-0 items-center gap-3">
        <Link href={homeHref} aria-label="返回学生桌面">
          <SyntaraMark className="size-9 rounded-xl shadow-sm" />
        </Link>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950 dark:text-white">
            {compact ? '学习桌面' : 'Syntara 学习桌面'}
          </p>
          <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
            课程与 AI 学习空间
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href={homeHref}
          className="hidden h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-100 sm:flex dark:text-slate-300 dark:hover:bg-white/10"
        >
          <LayoutGrid className="size-4" />
          学生桌面
        </Link>
        <span className="hidden items-center gap-1.5 text-xs text-slate-500 md:flex dark:text-slate-400">
          <UserRound className="size-3.5" />
          {name || '学生'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            if (previewMode) {
              void fetch('/api/admin/students/preview', { method: 'DELETE' }).finally(() => {
                window.location.assign('/admin?section=students');
              });
              return;
            }
            void signOut();
          }}
        >
          <LogOut className="mr-1.5 size-4" />
          {previewMode ? '退出预览' : '退出'}
        </Button>
      </div>
    </header>
  );
}
