'use client';

import { useState } from 'react';
import { CheckCircle2, ChevronDown, Circle, Lightbulb, Loader2, XCircle } from 'lucide-react';
import type { PublicReplyProgressStep } from '@/lib/types/chat';
import { cn } from '@/lib/utils';

interface PublicReplyProgressProps {
  readonly statusText?: string | null;
  readonly steps?: PublicReplyProgressStep[];
  readonly compact?: boolean;
  readonly className?: string;
}

function formatMs(ms: number): string {
  if (ms < 1000) return '<1s';
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}m${whole % 60 ? `${whole % 60}s` : ''}`;
}

function stepDuration(step: PublicReplyProgressStep): string | null {
  if (step.startedAt == null || step.endedAt == null) return null;
  return formatMs(Math.max(0, step.endedAt - step.startedAt));
}

/** "检索题库、检索笔记本 · 1 项失败 · 用时 6s" built only from the steps we have. */
function collapsedSummary(steps: PublicReplyProgressStep[]): string {
  const tools = steps.filter((step) => step.kind === 'tool');
  const labels = Array.from(new Set(tools.map((step) => step.label))).slice(0, 3);
  const failed = steps.filter((step) => step.failed).length;
  const starts = steps.map((step) => step.startedAt).filter((v): v is number => v != null);
  const ends = steps.map((step) => step.endedAt).filter((v): v is number => v != null);
  const elapsed =
    starts.length && ends.length ? Math.max(...ends) - Math.min(...starts) : undefined;
  return [
    labels.length ? labels.join('、') : tools.length ? '' : '未调用工具',
    tools.length > labels.length ? `共 ${tools.length} 次查询` : '',
    failed ? `${failed} 项失败` : '',
    elapsed != null && elapsed > 0 ? `用时 ${formatMs(elapsed)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function StepIcon({ step }: { step: PublicReplyProgressStep }) {
  if (step.failed) return <XCircle className="size-3.5 text-rose-600 dark:text-rose-300" />;
  if (step.status === 'active') {
    return step.kind === 'reasoning' ? (
      <Lightbulb className="size-3.5 animate-pulse text-amber-500 motion-reduce:animate-none dark:text-amber-300" />
    ) : (
      <Loader2 className="size-3.5 animate-spin text-sky-600 motion-reduce:animate-none dark:text-sky-200" />
    );
  }
  if (step.status === 'complete') {
    return step.kind === 'reasoning' ? (
      <Lightbulb className="size-3.5 text-amber-500/80 dark:text-amber-300/80" />
    ) : (
      <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-300" />
    );
  }
  return <Circle className="size-3 text-slate-300 dark:text-slate-500" />;
}

function ReasoningBody({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false);
  const expanded = open || active;
  return (
    <span className="block">
      <span
        className={cn(
          'block whitespace-pre-line text-[11px] leading-4 text-slate-500 dark:text-slate-400',
          !expanded && 'line-clamp-1',
        )}
      >
        {text}
      </span>
      {!active ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-0.5 text-[10px] text-sky-700 hover:underline dark:text-sky-200"
          aria-expanded={expanded}
        >
          {expanded ? '收起思路' : '展开思路'}
        </button>
      ) : null}
    </span>
  );
}

export function PublicReplyProgress({
  statusText,
  steps = [],
  compact = false,
  className,
}: PublicReplyProgressProps) {
  const [expandedByUser, setExpandedByUser] = useState<boolean | null>(null);
  const visibleStatusText = statusText?.trim();
  if (!visibleStatusText && steps.length === 0) return null;

  const hasTimeline = steps.some((step) => step.kind != null);
  // Once the answer is streaming, fold the timeline into one line (user can reopen it).
  const answerStarted = steps.some(
    (step) => step.kind === 'answer' && (step.status === 'active' || step.status === 'complete'),
  );
  const collapsed = hasTimeline && (expandedByUser == null ? answerStarted : !expandedByUser);
  const anyFailed = steps.some((step) => step.failed);
  const busy =
    steps.some((step) => step.status === 'active') || (!hasTimeline && !!visibleStatusText);

  return (
    <div
      className={cn(
        'mt-3 rounded-2xl border border-sky-200/70 bg-sky-50/70 px-3 py-2 text-xs text-slate-600 shadow-sm dark:border-sky-400/20 dark:bg-sky-400/10 dark:text-slate-200',
        compact && 'rounded-xl px-2.5 py-2 text-[11px]',
        className,
      )}
      aria-live="polite"
    >
      {visibleStatusText || hasTimeline ? (
        <div className="flex min-w-0 items-center gap-2 font-medium text-sky-700 dark:text-sky-100">
          {busy ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          ) : anyFailed ? (
            <XCircle className="size-3.5 shrink-0 text-rose-600 dark:text-rose-300" />
          ) : (
            <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-300" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {collapsed ? collapsedSummary(steps) || visibleStatusText : visibleStatusText}
          </span>
          {hasTimeline ? (
            <button
              type="button"
              onClick={() => setExpandedByUser(collapsed)}
              className="inline-flex shrink-0 items-center gap-0.5 text-[10px] font-normal text-slate-500 hover:text-sky-700 dark:text-slate-400 dark:hover:text-sky-100"
              aria-expanded={!collapsed}
            >
              {collapsed ? '过程' : '收起'}
              <ChevronDown
                className={cn('size-3 transition-transform', !collapsed && 'rotate-180')}
              />
            </button>
          ) : null}
        </div>
      ) : null}
      {steps.length > 0 && !collapsed ? (
        <ol className={cn('relative mt-2', !visibleStatusText && !hasTimeline && 'mt-0')}>
          {steps.map((step, index) => {
            const duration = stepDuration(step);
            const isLast = index === steps.length - 1;
            const showEvidence = !compact && step.evidence && step.evidence.length > 0;
            return (
              <li key={step.id} className="relative flex min-w-0 items-start gap-2 pb-1.5">
                {hasTimeline && !isLast ? (
                  <span
                    aria-hidden
                    className="absolute top-4 bottom-0 left-[6.5px] w-px bg-sky-200 dark:bg-sky-400/20"
                  />
                ) : null}
                <span className="relative mt-0.5 inline-flex size-3.5 shrink-0 items-center justify-center bg-inherit">
                  <StepIcon step={step} />
                </span>
                <span
                  className={cn(
                    'min-w-0 flex-1 leading-5',
                    step.failed
                      ? 'text-rose-700 dark:text-rose-300'
                      : step.status === 'active'
                        ? 'font-medium text-slate-900 dark:text-slate-50'
                        : step.status === 'pending'
                          ? 'text-slate-400 dark:text-slate-500'
                          : 'text-slate-500 dark:text-slate-300',
                  )}
                >
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="min-w-0 truncate">{step.label}</span>
                    {duration ? (
                      <span className="shrink-0 text-[10px] font-normal tabular-nums text-slate-400 dark:text-slate-500">
                        {duration}
                      </span>
                    ) : null}
                  </span>
                  {!compact && step.description ? (
                    step.kind === 'reasoning' ? (
                      <ReasoningBody text={step.description} active={step.status === 'active'} />
                    ) : (
                      <span
                        className={cn(
                          'block truncate text-[11px] font-normal',
                          step.failed
                            ? 'text-rose-600/90 dark:text-rose-300/90'
                            : 'text-slate-400 dark:text-slate-500',
                        )}
                        title={step.description}
                      >
                        {step.description}
                      </span>
                    )
                  ) : null}
                  {showEvidence ? (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {step.evidence!.slice(0, 3).map((item) => (
                        <span
                          key={item}
                          className="max-w-full truncate rounded-full border border-sky-200/80 bg-white/80 px-1.5 py-px text-[10px] font-normal text-slate-600 dark:border-sky-400/20 dark:bg-white/5 dark:text-slate-300"
                          title={item}
                        >
                          {item}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </div>
  );
}
