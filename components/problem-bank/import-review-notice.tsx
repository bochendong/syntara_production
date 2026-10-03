'use client';

import { AlertTriangle } from 'lucide-react';

type ReviewIssue = { code?: unknown; message?: unknown };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Shows teachers why an imported problem was held back (missing figure, broken math,
 * answer disagreement, ...). Data comes from sourceMeta.importReview written at import.
 * Students never see this; render it only for editors.
 */
export function ImportReviewNotice({
  sourceMeta,
  locale,
  className,
}: {
  sourceMeta: unknown;
  locale: string;
  className?: string;
}) {
  const review = asRecord(asRecord(sourceMeta).importReview);
  if (review.status !== 'needs_review') return null;
  const issues = (Array.isArray(review.issues) ? (review.issues as ReviewIssue[]) : [])
    .map((issue) => (typeof issue.message === 'string' ? issue.message : ''))
    .filter(Boolean);
  const zh = locale === 'zh-CN';
  const acknowledged = typeof review.acknowledgedAt === 'string';
  return (
    <div
      className={`rounded-lg border px-3 py-2.5 text-sm leading-6 ${
        acknowledged
          ? 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-300'
          : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-100'
      } ${className ?? ''}`}
      role="note"
    >
      <div className="flex items-center gap-1.5 font-medium">
        <AlertTriangle className="size-4 shrink-0" />
        {acknowledged
          ? zh
            ? '导入质检提示（已核对）'
            : 'Import check notes (reviewed)'
          : zh
            ? '导入质检提示：请对照原资料核对题目内容'
            : 'Import check notes: compare the problem with its source'}
      </div>
      {issues.length ? (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5">
          {issues.slice(0, 12).map((message, index) => (
            <li key={index}>{message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
