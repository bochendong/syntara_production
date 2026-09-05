'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const LEARN_CONFIRMATION_SURFACE_CLASS =
  'overflow-hidden rounded-2xl border border-slate-200/90 bg-white text-slate-900 shadow-[0_4px_16px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-slate-900 dark:text-slate-100';
export const LEARN_CONFIRMATION_PRIMARY_CLASS =
  'h-8 shrink-0 gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white shadow-sm hover:bg-slate-700 focus-visible:ring-sky-400/40 dark:bg-sky-300 dark:text-slate-950 dark:hover:bg-sky-200';
export const LEARN_CONFIRMATION_SECONDARY_CLASS =
  'h-8 shrink-0 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 dark:border-white/15 dark:bg-transparent dark:text-slate-300 dark:hover:bg-white/5';

/** Shared presentation for chat proposals; each caller owns its confirmation behavior. */
export function LearnConfirmationCard({
  title,
  description,
  icon,
  badge,
  actions,
  children,
  className,
  busy = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  icon: ReactNode;
  badge?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
  busy?: boolean;
}) {
  return (
    <section
      data-learn-confirmation-card
      aria-busy={busy || undefined}
      className={cn(LEARN_CONFIRMATION_SURFACE_CLASS, 'w-full p-3.5', className)}
    >
      <div className="grid grid-cols-[32px_minmax(0,1fr)] items-start gap-x-3 gap-y-3 sm:grid-cols-[32px_minmax(0,1fr)_auto]">
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-xl bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-100 dark:bg-sky-400/10 dark:text-sky-200 dark:ring-sky-300/15"
        >
          {icon}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[13px] font-semibold leading-5 tracking-[-0.01em]">{title}</h3>
            {badge ? (
              <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-white/10 dark:text-slate-300">
                {badge}
              </span>
            ) : null}
          </div>
          {description ? (
            <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">
              {description}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div className="col-start-2 flex flex-wrap items-center gap-2 sm:col-start-3 sm:row-start-1 sm:self-center">
            {actions}
          </div>
        ) : null}
      </div>
      {children ? (
        <div className="mt-3 border-t border-slate-100 pt-3 dark:border-white/10">{children}</div>
      ) : null}
    </section>
  );
}
