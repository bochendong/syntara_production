'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, Sparkles, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { toast } from '@/lib/notifications/client-toast';
import { cn } from '@/lib/utils';
import { backendJson } from '@/lib/utils/backend-api';

/**
 * 加入的机构课程分两层：发布者的公有层、自己的私有层。
 * 网页题库 / 笔记用的小部件：「新」弹珠、「题目已更新」、已隐藏列表、有更新提示、发布新版本。
 */

export type CourseContentTarget = { targetType: 'notebook' | 'problem'; targetId: string };

type HiddenItem = CourseContentTarget & { title: string; hiddenAt: number };

type LearnerLayers = {
  role: 'enrolled';
  hidden: HiddenItem[];
  newNotebookIds: string[];
  privateNotebookIds: string[];
  update: { text: string } | null;
};

type OwnerLayers = {
  role: 'owner';
  contentVersion: number;
  lastReleasedAt: number | null;
  canRelease: boolean;
};

type CourseLayers = LearnerLayers | OwnerLayers;

const layersPath = (courseId: string) => `/api/courses/${encodeURIComponent(courseId)}/layers`;

export function useCourseLayers(courseId: string, enabled: boolean) {
  const [layers, setLayers] = useState<CourseLayers | null>(null);
  const refresh = useCallback(async () => {
    if (!enabled || !courseId) return null;
    const next = await backendJson<CourseLayers>(layersPath(courseId)).catch(() => null);
    setLayers(next);
    return next;
  }, [courseId, enabled]);
  useEffect(() => {
    if (!enabled || !courseId) return;
    let cancelled = false;
    void backendJson<CourseLayers>(layersPath(courseId))
      .then((next) => {
        if (!cancelled) setLayers(next);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [courseId, enabled]);

  const act = useCallback(
    async (action: 'remove' | 'restore' | 'copy', target: CourseContentTarget) => {
      const result = await backendJson<{ result?: 'hidden' | 'deleted'; id?: string }>(
        layersPath(courseId),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ...target }),
        },
      );
      await refresh();
      return result;
    },
    [courseId, refresh],
  );
  return { layers, refresh, act };
}

/** 一颗小玻璃珠（网页没有弹珠图，用渐变画）。 */
function GlassDot({ tone, className }: { tone: 'blue' | 'amber' | 'purple'; className?: string }) {
  const tones = {
    blue: 'from-sky-200 via-sky-400 to-blue-600',
    amber: 'from-amber-100 via-amber-400 to-orange-600',
    purple: 'from-violet-200 via-violet-400 to-purple-600',
  } as const;
  return (
    <span
      aria-hidden
      className={cn(
        'relative inline-block size-3 shrink-0 rounded-full bg-gradient-to-br shadow-[0_1px_2px_rgb(15_23_42/0.25)]',
        tones[tone],
        className,
      )}
    >
      <span className="absolute left-[22%] top-[16%] h-[30%] w-[38%] rounded-full bg-white/80" />
    </span>
  );
}

export function LayerBadges({
  isNew,
  contentUpdated,
  mine,
}: {
  isNew?: boolean;
  contentUpdated?: boolean;
  mine?: boolean;
}) {
  if (!isNew && !contentUpdated && !mine) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1">
      {isNew ? (
        <span className="inline-flex h-[18px] items-center gap-1 rounded-full bg-sky-100 pl-0.5 pr-1.5 text-[11px] font-bold text-blue-700 dark:bg-sky-500/15 dark:text-sky-300">
          <GlassDot tone="blue" />新
        </span>
      ) : null}
      {contentUpdated ? (
        <span className="inline-flex h-[18px] items-center rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
          题目已更新
        </span>
      ) : null}
      {mine ? (
        <span className="inline-flex h-[18px] items-center rounded-full bg-emerald-100 px-1.5 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          我的
        </span>
      ) : null}
    </span>
  );
}

/** 「已隐藏 N」：自己删掉的公有内容，点开可以恢复。 */
export function HiddenContentButton({
  items,
  onRestore,
}: {
  items: HiddenItem[];
  onRestore: (item: HiddenItem) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  if (!items.length) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
          <span className="flex -space-x-1">
            {items.slice(0, 3).map((item) => (
              <GlassDot key={item.targetId} tone="purple" className="opacity-60" />
            ))}
          </span>
          已隐藏 {items.length}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 rounded-2xl p-2">
        <ul className="grid max-h-80 gap-1 overflow-y-auto">
          {items.map((item) => (
            <li
              key={`${item.targetType}:${item.targetId}`}
              className="flex items-center gap-2.5 rounded-xl px-2 py-1.5 hover:bg-slate-50 dark:hover:bg-white/5"
            >
              <GlassDot tone="purple" className="size-4 opacity-60" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-900 dark:text-white">
                  {item.title}
                </span>
                <span className="block text-[11px] text-slate-400">
                  {item.targetType === 'notebook' ? '笔记' : '题目'}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 rounded-full px-2.5 text-blue-700 dark:text-sky-300"
                disabled={busyId !== null}
                onClick={() => {
                  setBusyId(item.targetId);
                  void onRestore(item)
                    .catch((error) =>
                      toast.error(error instanceof Error ? error.message : '没能恢复'),
                    )
                    .finally(() => setBusyId(null));
                }}
              >
                {busyId === item.targetId ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="size-3.5" />
                )}
                恢复
              </Button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

/** 打开加入的课时：机构发了新版就亮一下摘要，看过即熄灭（下次打开不再出现）。 */
export function CourseUpdatePill({ courseId, text }: { courseId: string; text: string }) {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    void backendJson(layersPath(courseId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'seen' }),
    }).catch(() => undefined);
  }, [courseId]);
  if (!open) return null;
  return (
    <span
      role="status"
      className="inline-flex h-8 items-center gap-2 rounded-full border border-amber-200/80 bg-gradient-to-r from-amber-50 to-white pl-2 pr-1 text-xs text-slate-700 shadow-sm dark:border-amber-500/20 dark:from-amber-500/10 dark:to-transparent dark:text-slate-200"
    >
      <GlassDot tone="amber" className="size-4" />
      <b className="font-semibold text-amber-800 dark:text-amber-300">有更新</b>
      <span className="max-w-[18rem] truncate">{text}</span>
      <button
        type="button"
        aria-label="知道了"
        className="grid size-6 place-items-center rounded-full text-slate-400 hover:bg-slate-900/5"
        onClick={() => setOpen(false)}
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}

/** 发布者：把改过的内容打包成新版本，学员那边出现「有更新」和「新」。 */
export function CourseReleaseButton({
  courseId,
  layers,
  onReleased,
}: {
  courseId: string;
  layers: OwnerLayers;
  onReleased: () => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!layers.canRelease) return null;
  return (
    <Button
      size="sm"
      variant="outline"
      className="gap-1.5 rounded-full"
      disabled={busy}
      title={`当前第 ${layers.contentVersion} 版`}
      onClick={async () => {
        setBusy(true);
        try {
          const result = await backendJson<{ version: number; text: string }>(
            layersPath(courseId),
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'release' }),
            },
          );
          toast.success(
            result.text
              ? `已发布第 ${result.version} 版：${result.text}`
              : `已发布第 ${result.version} 版`,
          );
          onReleased();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '发布失败');
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
      发布新版本
    </Button>
  );
}

export type { CourseLayers, HiddenItem, LearnerLayers, OwnerLayers };
