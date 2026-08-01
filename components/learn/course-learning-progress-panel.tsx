'use client';

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { StageListItem } from '@/lib/utils/stage-storage';

function notebookCourseOrder(notebook: Pick<StageListItem, 'id' | 'name' | 'createdAt'>): number {
  const candidates = [notebook.name, notebook.id];
  for (const candidate of candidates) {
    const match = candidate.match(/(?:^|[-_\s])0?(\d{1,2})(?:\s*[-–—_:]|[-_\s]|$)/);
    if (match) return Number(match[1]);
  }
  return Number.MAX_SAFE_INTEGER;
}

export function orderCourseNotebooksForProgress<
  T extends Pick<StageListItem, 'id' | 'name' | 'createdAt'>,
>(notebooks: T[]): T[] {
  return notebooks.slice().sort((a, b) => {
    const orderA = notebookCourseOrder(a);
    const orderB = notebookCourseOrder(b);
    if (orderA !== orderB) return orderA - orderB;
    return a.createdAt - b.createdAt || a.name.localeCompare(b.name);
  });
}

export function completedCountFromProgressSelection(
  selection: string,
  orderedNotebooks: Array<Pick<StageListItem, 'id'>>,
  notStartedToken: string,
  completedAllToken: string,
): number {
  if (!selection || selection === notStartedToken) return 0;
  if (selection === completedAllToken) return orderedNotebooks.length;
  const index = orderedNotebooks.findIndex((notebook) => notebook.id === selection);
  return index >= 0 ? index + 1 : 0;
}

export function progressSelectionFromCompletedCount(
  count: number,
  orderedNotebooks: Array<Pick<StageListItem, 'id'>>,
  notStartedToken: string,
  completedAllToken: string,
): string {
  const next = Math.min(orderedNotebooks.length, Math.max(0, Math.round(count)));
  if (next <= 0) return notStartedToken;
  if (next >= orderedNotebooks.length) return completedAllToken;
  return orderedNotebooks[next - 1]?.id || notStartedToken;
}

type CourseLearningProgressPanelProps = {
  notebooks: StageListItem[];
  /** Notebook id / special tokens representing current progress. */
  selection: string;
  notStartedToken: string;
  completedAllToken: string;
  onProgressChange: (selection: string) => void;
  onOpenNotebook?: (notebook: StageListItem) => void;
  loading?: boolean;
  className?: string;
};

export function CourseLearningProgressPanel({
  notebooks,
  selection,
  notStartedToken,
  completedAllToken,
  onProgressChange,
  onOpenNotebook,
  loading = false,
  className,
}: CourseLearningProgressPanelProps) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);
  const [anchorPercents, setAnchorPercents] = useState<number[]>([]);
  const [dragging, setDragging] = useState(false);

  const orderedNotebooks = useMemo(() => orderCourseNotebooksForProgress(notebooks), [notebooks]);
  const notebookCount = orderedNotebooks.length;

  const completedNotebookCount = useMemo(
    () =>
      completedCountFromProgressSelection(
        selection,
        orderedNotebooks,
        notStartedToken,
        completedAllToken,
      ),
    [completedAllToken, notStartedToken, orderedNotebooks, selection],
  );

  const commitCount = useCallback(
    (count: number) => {
      const nextSelection = progressSelectionFromCompletedCount(
        count,
        orderedNotebooks,
        notStartedToken,
        completedAllToken,
      );
      if (nextSelection === selection) return;
      onProgressChange(nextSelection);
    },
    [completedAllToken, notStartedToken, onProgressChange, orderedNotebooks, selection],
  );

  const measureAnchors = useCallback(() => {
    const track = trackRef.current;
    if (!track || notebookCount <= 0) {
      setAnchorPercents([]);
      return;
    }
    const trackRect = track.getBoundingClientRect();
    if (trackRect.height <= 0) return;
    const next = orderedNotebooks.map((_, index) => {
      const item = itemRefs.current[index];
      if (!item) return ((index + 0.5) / notebookCount) * 100;
      const itemRect = item.getBoundingClientRect();
      const centerY = itemRect.top + itemRect.height / 2;
      return ((centerY - trackRect.top) / trackRect.height) * 100;
    });
    setAnchorPercents(next);
  }, [notebookCount, orderedNotebooks]);

  useLayoutEffect(() => {
    let frameId = window.requestAnimationFrame(measureAnchors);
    const scheduleMeasurement = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measureAnchors);
    };
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(scheduleMeasurement);
    if (observer) {
      if (trackRef.current) observer.observe(trackRef.current);
      if (listRef.current) observer.observe(listRef.current);
    }
    window.addEventListener('resize', scheduleMeasurement);
    return () => {
      window.cancelAnimationFrame(frameId);
      observer?.disconnect();
      window.removeEventListener('resize', scheduleMeasurement);
    };
  }, [measureAnchors]);

  const snapCountFromClientY = useCallback(
    (clientY: number) => {
      const track = trackRef.current;
      if (!track || notebookCount <= 0) return 0;
      const trackRect = track.getBoundingClientRect();
      if (trackRect.height <= 0) return 0;
      const ratio = Math.min(1, Math.max(0, (clientY - trackRect.top) / trackRect.height));
      return Math.round(ratio * notebookCount);
    },
    [notebookCount],
  );

  const updateProgressFromClientY = useCallback(
    (clientY: number) => {
      commitCount(snapCountFromClientY(clientY));
    },
    [commitCount, snapCountFromClientY],
  );

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
    updateProgressFromClientY(event.clientY);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging && !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    updateProgressFromClientY(event.clientY);
  };

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  };

  const progressPercent =
    notebookCount <= 0 ? 0 : Math.round((completedNotebookCount / notebookCount) * 100);
  const thumbTop =
    completedNotebookCount <= 0
      ? 0
      : (anchorPercents[completedNotebookCount - 1] ??
        (completedNotebookCount / notebookCount) * 100);

  return (
    <section className={cn('min-w-0 overflow-hidden', className)} aria-label="学习进度">
      <div className="flex min-w-0 items-center gap-2">
        <BookOpen className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
        <p className="min-w-0 truncate text-sm font-semibold text-foreground">学习进度</p>
        <span className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-slate-500">
          {progressPercent}%
        </span>
      </div>

      {loading && notebookCount === 0 ? (
        <div className="mt-3 space-y-2" aria-label="正在加载课程笔记本目录">
          <div className="h-3 w-4/5 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
          <div className="h-3 w-3/5 animate-pulse rounded bg-slate-200 dark:bg-white/10" />
        </div>
      ) : notebookCount === 0 ? (
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          还没有上传笔记本。上传后会出现在这里，方便拖动进度。
        </p>
      ) : (
        <>
          <p className="mt-2 text-[11px] leading-5 text-slate-500">
            AI 只读取蓝色进度点之前的笔记本内容与对应记忆。
          </p>
          <div className="mt-3 grid min-w-0 grid-cols-[14px_minmax(0,1fr)] items-stretch gap-2.5">
            <div
              ref={trackRef}
              className={cn(
                'relative mx-[3px] h-full min-h-0 w-2 touch-none rounded-full bg-slate-200 outline-none dark:bg-white/10',
                dragging ? 'cursor-grabbing' : 'cursor-ns-resize',
              )}
              role="slider"
              aria-label="课程学习进度"
              aria-valuemin={0}
              aria-valuemax={notebookCount}
              aria-valuenow={completedNotebookCount}
              aria-valuetext={`已完成 ${completedNotebookCount} / ${notebookCount} 本 · ${progressPercent}%`}
              tabIndex={0}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              onKeyDown={(event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
                  event.preventDefault();
                  commitCount(completedNotebookCount - 1);
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  commitCount(completedNotebookCount + 1);
                } else if (event.key === 'Home') {
                  event.preventDefault();
                  commitCount(0);
                } else if (event.key === 'End') {
                  event.preventDefault();
                  commitCount(notebookCount);
                }
              }}
            >
              <span
                className="pointer-events-none absolute inset-x-0 top-0 rounded-full bg-[linear-gradient(180deg,#7dd3fc_0%,#3b82f6_48%,#1d4ed8_100%)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.18)]"
                style={{ height: `${thumbTop}%` }}
              />
              {orderedNotebooks.map((notebook, index) => (
                <span
                  key={`anchor-${notebook.id}`}
                  className={cn(
                    'pointer-events-none absolute left-1/2 z-[1] size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-300 shadow-[0_0_0_2px_#e2e8f0] dark:bg-slate-500 dark:shadow-[0_0_0_2px_rgba(15,23,42,0.8)]',
                    index < completedNotebookCount &&
                      'bg-sky-400 shadow-[0_0_0_2px_rgba(219,234,254,0.9)]',
                    index === completedNotebookCount - 1 && 'bg-blue-700 shadow-[0_0_0_2px_#fff]',
                  )}
                  style={{
                    top: `${anchorPercents[index] ?? ((index + 0.5) / notebookCount) * 100}%`,
                  }}
                />
              ))}
              <span
                className="pointer-events-none absolute left-1/2 z-[2] size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-blue-700 shadow-[0_2px_8px_rgba(29,78,216,0.35)]"
                style={{ top: `${thumbTop}%` }}
              />
            </div>

            <ul className="m-0 grid min-w-0 list-none gap-0.5 overflow-hidden p-0" ref={listRef}>
              {orderedNotebooks.map((notebook, index) => {
                const reached = index < completedNotebookCount;
                const current = index === completedNotebookCount - 1;
                return (
                  <li
                    key={notebook.id}
                    className="min-w-0"
                    ref={(node) => {
                      itemRefs.current[index] = node;
                    }}
                  >
                    <button
                      type="button"
                      title={notebook.name}
                      onClick={() => onOpenNotebook?.(notebook)}
                      className={cn(
                        'flex w-full min-w-0 items-start gap-2 overflow-hidden rounded-[10px] px-2 py-1.5 text-left transition',
                        current
                          ? 'bg-sky-50 dark:bg-sky-400/10'
                          : 'hover:bg-white dark:hover:bg-white/5',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold',
                          reached
                            ? 'bg-blue-600 text-white'
                            : 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400',
                        )}
                      >
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 overflow-hidden">
                        <strong
                          className={cn(
                            'block break-words text-xs font-semibold leading-snug [overflow-wrap:anywhere] line-clamp-2',
                            current
                              ? 'text-sky-800 dark:text-sky-100'
                              : reached
                                ? 'text-slate-700 dark:text-slate-200'
                                : 'text-slate-500 dark:text-slate-400',
                          )}
                        >
                          {notebook.name}
                        </strong>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
