'use client';

import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export type LearnPageShellSkeletonProps = {
  error?: string | null;
  loadingLabel?: string;
  onRetry?: () => void;
};

function SkeletonBlock({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'animate-pulse rounded-full bg-slate-200/80 motion-reduce:animate-none dark:bg-white/10',
        className,
      )}
    />
  );
}

function LearnRailSkeleton({ side }: { side: 'left' | 'right' }) {
  if (side === 'left') {
    return (
      <aside
        aria-hidden="true"
        className="hidden min-h-0 flex-col overflow-hidden border-r border-slate-200/80 bg-slate-50 px-4 py-5 lg:flex dark:border-white/10 dark:bg-slate-950"
      >
        <SkeletonBlock className="h-9 w-32 rounded-[13px]" />
        <div className="mt-5 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <SkeletonBlock className="h-4 w-28 rounded-md" />
            <SkeletonBlock className="h-3 w-20 rounded-md" />
          </div>
          <SkeletonBlock className="size-9 shrink-0" />
        </div>
        <SkeletonBlock className="mt-4 h-9 w-full rounded-[13px]" />
        <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-hidden">
          {Array.from({ length: 5 }).map((_, index) => (
            <div
              key={index}
              className="flex h-10 items-center gap-3 rounded-[14px] border border-slate-200/70 bg-white/60 px-3 dark:border-white/10 dark:bg-white/5"
            >
              <SkeletonBlock className="h-3 flex-1 rounded-md" />
              <SkeletonBlock className="size-6 shrink-0" />
            </div>
          ))}
        </div>
        <div className="mt-4 border-t border-slate-200/80 pt-4 dark:border-white/10">
          <SkeletonBlock className="h-4 w-24 rounded-md" />
          <div className="mt-3 space-y-2">
            <SkeletonBlock className="h-12 w-full rounded-[14px]" />
            <SkeletonBlock className="h-12 w-full rounded-[14px]" />
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside
      aria-hidden="true"
      className="hidden min-h-0 flex-col overflow-hidden border-l border-slate-200/80 bg-slate-50 px-4 py-5 lg:flex dark:border-white/10 dark:bg-slate-950"
    >
      <div className="grid h-9 grid-cols-2 gap-1 rounded-[18px] bg-slate-200/60 p-1 dark:bg-white/5">
        <SkeletonBlock className="h-7 w-full rounded-[13px] bg-white dark:bg-white/10" />
        <SkeletonBlock className="h-7 w-full rounded-[13px]" />
      </div>
      <div className="mt-4 rounded-[20px] border border-slate-200/80 bg-white/80 p-3 dark:border-white/10 dark:bg-white/5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2">
            <SkeletonBlock className="h-4 w-24 rounded-md" />
            <SkeletonBlock className="h-3 w-16 rounded-md" />
          </div>
          <SkeletonBlock className="h-8 w-20 rounded-full" />
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1">
          {Array.from({ length: 42 }).map((_, index) => (
            <SkeletonBlock key={index} className="aspect-square w-full rounded-[8px]" />
          ))}
        </div>
      </div>
      <div className="mt-4 rounded-[20px] border border-slate-200/80 bg-white/80 p-3 dark:border-white/10 dark:bg-white/5">
        <SkeletonBlock className="h-4 w-24 rounded-md" />
        <div className="mt-3 space-y-2">
          <SkeletonBlock className="h-12 w-full rounded-[14px]" />
          <SkeletonBlock className="h-12 w-full rounded-[14px]" />
          <SkeletonBlock className="h-12 w-full rounded-[14px]" />
        </div>
      </div>
    </aside>
  );
}

function LearnComposerSkeleton() {
  return (
    <footer
      aria-hidden="true"
      className="shrink-0 border-t border-transparent bg-white px-6 py-3 sm:px-8 lg:px-10 dark:bg-slate-950"
    >
      <div className="mx-auto max-w-[52rem] rounded-[22px] border border-slate-200/70 px-2.5 py-2 dark:border-white/10">
        <div className="flex min-h-10 items-center gap-2">
          <SkeletonBlock className="size-9 shrink-0" />
          <SkeletonBlock className="h-3 min-w-0 flex-1 rounded-md" />
          <SkeletonBlock className="h-8 w-10 shrink-0 sm:w-[148px]" />
          <SkeletonBlock className="size-9 shrink-0" />
        </div>
      </div>
    </footer>
  );
}

export function LearnPageShellSkeleton({
  error,
  loadingLabel = '正在加载课程与会话…',
  onRetry,
}: LearnPageShellSkeletonProps) {
  const errorMessage = error?.trim() || '';
  const hasError = errorMessage.length > 0;

  return (
    <div
      className="grid h-full min-h-[70dvh] overflow-hidden bg-slate-50 text-foreground lg:grid-cols-[280px_minmax(0,1fr)_320px] dark:bg-slate-950"
      aria-busy={!hasError}
    >
      <LearnRailSkeleton side="left" />

      <main className="flex min-h-[70dvh] min-w-0 flex-col overflow-hidden bg-white lg:min-h-0 dark:bg-slate-950">
        <header
          aria-hidden="true"
          className="shrink-0 border-b border-slate-200/80 bg-white/95 px-6 py-3 sm:px-8 lg:px-10 dark:border-white/10 dark:bg-slate-950/95"
        >
          <div className="mx-auto flex w-full max-w-[52rem] items-center justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <SkeletonBlock className="h-4 w-36 rounded-md" />
              <SkeletonBlock className="h-2.5 w-20 rounded-md" />
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <SkeletonBlock className="h-8 w-20 rounded-[10px]" />
              <SkeletonBlock className="hidden h-8 w-20 rounded-[10px] sm:block" />
              <SkeletonBlock className="size-9" />
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-hidden px-6 py-5 sm:px-8 lg:px-10">
          <div className="mx-auto flex h-full w-full max-w-[52rem] flex-col">
            {hasError ? (
              <div className="grid min-h-0 flex-1 place-items-center py-8">
                <div
                  className="w-full max-w-md rounded-[24px] border border-amber-200/80 bg-amber-50/90 px-6 py-7 text-center shadow-[0_18px_48px_rgba(15,23,42,0.08)] dark:border-amber-300/20 dark:bg-amber-400/10"
                  role="alert"
                  aria-live="assertive"
                >
                  <span className="mx-auto grid size-11 place-items-center rounded-full bg-white text-amber-700 shadow-sm dark:bg-white/10 dark:text-amber-200">
                    <AlertTriangle className="size-5" aria-hidden="true" />
                  </span>
                  <h1 className="mt-4 text-lg font-semibold text-slate-950 dark:text-white">
                    学习页暂时无法加载
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    {errorMessage}
                  </p>
                  {onRetry ? (
                    <Button type="button" className="mt-5 rounded-full px-5" onClick={onRetry}>
                      <RotateCcw className="size-4" aria-hidden="true" />
                      重新加载学习页
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : (
              <div
                className="flex min-h-0 flex-1 flex-col"
                role="status"
                aria-live="polite"
                aria-label={loadingLabel}
              >
                <div className="inline-flex w-fit items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 dark:border-sky-300/20 dark:bg-sky-400/10 dark:text-sky-100">
                  <Loader2
                    className="size-3.5 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                  {loadingLabel}
                </div>
                <div className="mt-8 flex items-start gap-3" aria-hidden="true">
                  <SkeletonBlock className="size-8 shrink-0 rounded-[10px]" />
                  <div className="min-w-0 flex-1 space-y-3 pt-1">
                    <SkeletonBlock className="h-3 w-5/6 rounded-md" />
                    <SkeletonBlock className="h-3 w-full rounded-md" />
                    <SkeletonBlock className="h-3 w-3/4 rounded-md" />
                    <SkeletonBlock className="h-24 w-full rounded-[18px]" />
                  </div>
                </div>
                <div className="mt-7 ml-auto w-2/3 space-y-2" aria-hidden="true">
                  <SkeletonBlock className="h-16 w-full rounded-[24px]" />
                </div>
              </div>
            )}
          </div>
        </div>

        <LearnComposerSkeleton />
      </main>

      <LearnRailSkeleton side="right" />
    </div>
  );
}
