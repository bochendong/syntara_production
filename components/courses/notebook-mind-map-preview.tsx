'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { Expand, Loader2, Network, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { backendFetch } from '@/lib/utils/backend-api';

type ImageState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

export function NotebookMindMapPreview({
  courseId,
  notebookId,
  title,
}: {
  courseId: string;
  notebookId: string;
  title: string;
}) {
  const [image, setImage] = useState<ImageState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    void backendFetch(
      `/api/student/courses/${encodeURIComponent(courseId)}/notebooks/${encodeURIComponent(notebookId)}/mind-map`,
      { signal: controller.signal, timeoutMs: 20_000 },
    )
      .then(async (response) => {
        if (response.status === 404) throw new Error('思维导图暂不可用，请稍后重试。');
        if (!response.ok) throw new Error('思维导图读取失败，请重试。');
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('思维导图格式异常，请重试。');
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setImage({ status: 'ready', url: objectUrl });
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setImage({ status: 'error', message: '思维导图暂时无法显示，请重新加载。' });
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [courseId, notebookId, attempt]);

  return (
    <section aria-label="思维导图预览" className="mt-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-100">
          <Network className="size-4 text-teal-600 dark:text-teal-300" />
          思维导图
        </h3>
        <span className="text-xs text-slate-400">知识脉络，一图看懂</span>
      </div>
      {image.status === 'ready' ? (
        <Dialog onOpenChange={() => setZoom(1)}>
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label={`放大查看 ${title} 思维导图`}
              className="group relative block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-slate-200 bg-white outline-none transition hover:border-teal-400 focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 dark:border-white/15"
            >
              <Image
                src={image.url}
                alt={`${title} 思维导图`}
                fill
                unoptimized
                sizes="(min-width: 1024px) 480px, 100vw"
                className="object-contain p-3"
                onError={() =>
                  setImage({ status: 'error', message: '思维导图图片加载失败，请重试。' })
                }
              />
              <span className="absolute bottom-3 right-3 flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition group-hover:border-teal-200 group-hover:text-teal-700">
                <Expand className="size-3.5" />
                放大查看
              </span>
            </button>
          </DialogTrigger>
          <DialogContent className="flex h-[88dvh] min-h-0 w-[94vw] min-w-0 max-w-[1440px] flex-col gap-4 p-5 sm:max-w-[1440px]">
            <DialogHeader className="shrink-0 pr-10">
              <DialogTitle className="text-lg leading-7">{title}</DialogTitle>
              <DialogDescription>思维导图 · 放大后可滚动查看细节</DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-black/10">
              <div className="flex shrink-0 items-center justify-end gap-1 border-b border-slate-200 px-3 py-2 dark:border-white/10">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="缩小思维导图"
                  disabled={zoom <= 1}
                  onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
                >
                  <ZoomOut className="size-4" />
                </Button>
                <span aria-live="polite" className="w-12 text-center text-xs tabular-nums">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="放大思维导图"
                  disabled={zoom >= 3}
                  onClick={() => setZoom((value) => Math.min(3, value + 0.5))}
                >
                  <ZoomIn className="size-4" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setZoom(1)}>
                  适应窗口
                </Button>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                <div
                  className="relative bg-white"
                  style={{ width: `${zoom * 100}%`, height: `${zoom * 100}%` }}
                >
                  <Image
                    src={image.url}
                    alt={`${title} 思维导图大图`}
                    fill
                    unoptimized
                    sizes="94vw"
                    className={
                      zoom > 1 ? 'object-contain object-left-top p-4' : 'object-contain p-4'
                    }
                  />
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : (
        <div
          aria-live="polite"
          className="grid aspect-[4/3] place-items-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-5 text-center text-sm text-slate-500 dark:border-white/15 dark:bg-white/5 dark:text-slate-400"
        >
          {image.status === 'loading' ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              正在读取思维导图…
            </span>
          ) : (
            <div>
              <p>{image.message}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 rounded-lg"
                onClick={() => {
                  setImage({ status: 'loading' });
                  setAttempt((value) => value + 1);
                }}
              >
                <RotateCcw className="mr-1.5 size-3.5" />
                重新加载
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
