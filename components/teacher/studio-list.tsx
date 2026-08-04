import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils/cn';

type StudioTone = 'neutral' | 'sky' | 'emerald' | 'amber' | 'rose' | 'indigo' | 'violet';
type StudioListDensity = 'compact' | 'regular' | 'editor';

const ITEM_DENSITY_CLASS: Record<StudioListDensity, string> = {
  compact: 'px-4 py-2.5 sm:px-5',
  regular: 'p-4 sm:px-5',
  editor: 'p-4',
};

const ICON_TONE_CLASS: Record<StudioTone, string> = {
  neutral: 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-400/10 dark:text-sky-200',
  emerald: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-400/10 dark:text-emerald-200',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-400/10 dark:text-amber-200',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-400/10 dark:text-rose-200',
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-400/10 dark:text-indigo-200',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-400/10 dark:text-violet-200',
};

const TAG_TONE_CLASS: Record<StudioTone, string> = {
  neutral:
    'border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/5 dark:text-slate-300',
  sky: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-sky-200',
  emerald:
    'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-200',
  amber:
    'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-200',
  rose: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-400/20 dark:bg-rose-400/10 dark:text-rose-200',
  indigo:
    'border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-400/20 dark:bg-indigo-400/10 dark:text-indigo-200',
  violet:
    'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/20 dark:bg-violet-400/10 dark:text-violet-200',
};

const STATUS_TONE_CLASS: Record<StudioTone, string> = {
  neutral: 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-400/10 dark:text-sky-200',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-200',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-400/10 dark:text-amber-200',
  rose: 'bg-rose-50 text-rose-700 dark:bg-rose-400/10 dark:text-rose-200',
  indigo: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-400/10 dark:text-indigo-200',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-400/10 dark:text-violet-200',
};

export function StudioList({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        'divide-y divide-slate-200/80 overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.02)] dark:divide-white/10 dark:border-white/10 dark:bg-white/[0.03]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function StudioListItem({
  children,
  className,
  density = 'regular',
}: {
  children: ReactNode;
  className?: string;
  density?: StudioListDensity;
}) {
  return (
    <article
      className={cn(
        'transition-colors hover:bg-slate-50/60 dark:hover:bg-white/[0.025]',
        ITEM_DENSITY_CLASS[density],
        className,
      )}
    >
      {children}
    </article>
  );
}

export function StudioItemIcon({
  children,
  className,
  compact = false,
  round = false,
  tone = 'neutral',
}: {
  children: ReactNode;
  className?: string;
  compact?: boolean;
  round?: boolean;
  tone?: StudioTone;
}) {
  return (
    <span
      className={cn(
        'grid shrink-0 place-items-center',
        compact ? 'size-8' : 'size-10',
        round ? 'rounded-full' : 'rounded-xl',
        ICON_TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StudioItemTag({
  children,
  className,
  tone = 'neutral',
}: {
  children: ReactNode;
  className?: string;
  tone?: StudioTone;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-3.5',
        TAG_TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StudioStatusBadge({
  children,
  className,
  tone = 'neutral',
}: {
  children: ReactNode;
  className?: string;
  tone?: StudioTone;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold',
        STATUS_TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StudioPagination({
  page,
  pageCount,
  total,
  onPage,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-slate-200/80 px-4 py-3 text-xs text-slate-500 dark:border-white/10">
      <span>
        共 {total} 项 · 第 {page}/{pageCount} 页
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(Math.max(1, page - 1))}
        >
          <ChevronLeft className="size-4" />
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount}
          onClick={() => onPage(Math.min(pageCount, page + 1))}
        >
          下一页
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
