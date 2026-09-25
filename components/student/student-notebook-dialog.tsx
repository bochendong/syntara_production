'use client';

import { useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { BookOpen, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MessageResponse } from '@/components/ai-elements/message';
import { backendJson } from '@/lib/utils/backend-api';
import type { Scene } from '@/lib/types/stage';

const ThumbnailSlide = dynamic(
  () =>
    import('@/components/slide-renderer/components/ThumbnailSlide').then(
      (mod) => mod.ThumbnailSlide,
    ),
  { ssr: false },
);
type Section = { id: string; title: string; summary?: string; markdown?: string };
type SectionPage = { sections: Section[]; page: { hasMore: boolean; nextCursor: string | null } };
type Notebook = { id: string; title?: string; kind?: 'image' | 'markdown' };

export function StudentNotebookDialog({
  notebook,
  onClose,
  preview = false,
}: {
  notebook: Notebook;
  onClose: () => void;
  preview?: boolean;
}) {
  const [resolved, setResolved] = useState<Notebook>(notebook);
  const [metadataError, setMetadataError] = useState('');
  const [metadataRetry, setMetadataRetry] = useState(0);

  useEffect(() => {
    if (preview || (notebook.title && notebook.kind)) return;
    const controller = new AbortController();
    void backendJson<{
      notebook: { name: string; notebookKind: 'image' | 'markdown' };
    }>(`/api/notebooks/${encodeURIComponent(notebook.id)}?includeScenes=0`, {
      signal: controller.signal,
    })
      .then(({ notebook: record }) => {
        if (!controller.signal.aborted) {
          setResolved({ id: notebook.id, title: record.name, kind: record.notebookKind });
          setMetadataError('');
        }
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setMetadataError(cause instanceof Error ? cause.message : '笔记本加载失败，请重试。');
      });
    return () => controller.abort();
  }, [notebook.id, notebook.kind, notebook.title, preview, metadataRetry]);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-5 pr-14">
          <DialogTitle>{resolved.title || '课程笔记本'}</DialogTitle>
          <DialogDescription>选择章节阅读；关闭后返回刚才的位置。</DialogDescription>
        </DialogHeader>
        {resolved.kind ? (
          <NotebookReader
            key={notebook.id}
            notebook={{ id: notebook.id, title: resolved.title || '', kind: resolved.kind }}
            preview={preview}
          />
        ) : metadataError ? (
          <div role="alert" className="grid min-h-64 place-items-center px-6 text-center">
            <div>
              <p className="text-sm text-rose-700">{metadataError}</p>
              <Button
                className="mt-4"
                variant="outline"
                onClick={() => setMetadataRetry((n) => n + 1)}
              >
                重试加载
              </Button>
            </div>
          </div>
        ) : (
          <div role="status" className="grid min-h-64 place-items-center text-sm text-slate-500">
            <span className="inline-flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              正在读取笔记本…
            </span>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function NotebookReader({ notebook, preview }: { notebook: Notebook; preview: boolean }) {
  const [sections, setSections] = useState<Section[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [detail, setDetail] = useState<Section | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [retry, setRetry] = useState(0);
  const [pageCursor, setPageCursor] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(760);
  const markdown = preview || notebook.kind === 'markdown';
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(100, entry.contentRect.width)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      if (preview) {
        const items = [1, 2].map((n) => ({
          id: `preview-${n}`,
          title: `第 ${n} 章`,
          markdown: `这是课程笔记预览，可切换章节。`,
        }));
        setSections(items);
        setSelectedId(items[0].id);
        setLoading(false);
        return;
      }
      const base = `/api/notebooks/${encodeURIComponent(notebook.id)}`;
      if (markdown) {
        const params = new URLSearchParams({ limit: '20' });
        if (pageCursor) params.set('cursor', pageCursor);
        const result = await backendJson<SectionPage>(`${base}/markdown-sections?${params}`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setSections((current) =>
          pageCursor
            ? [...new Map([...current, ...result.sections].map((item) => [item.id, item])).values()]
            : result.sections,
        );
        setCursor(result.page.hasMore ? result.page.nextCursor : null);
        setSelectedId((current) => current || result.sections[0]?.id || '');
      } else {
        const result = await backendJson<{ scenes: Scene[] }>(`${base}/scenes`, {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setScenes(result.scenes);
        setSections(result.scenes.map(({ id, title }) => ({ id, title })));
        setSelectedId((current) => current || result.scenes[0]?.id || '');
      }
    };
    void load()
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : '笔记本加载失败，请重试。');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [markdown, notebook.id, pageCursor, preview, retry]);
  useEffect(() => {
    if (!markdown || !selectedId || preview) return;
    const controller = new AbortController();
    void backendJson<{ section: Section }>(
      `/api/notebooks/${encodeURIComponent(notebook.id)}/markdown-sections/${encodeURIComponent(selectedId)}`,
      { signal: controller.signal },
    )
      .then(({ section }) => {
        if (!controller.signal.aborted) setDetail(section);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setDetailError(cause instanceof Error ? cause.message : '本节加载失败，请重试。');
      });
    return () => controller.abort();
  }, [markdown, notebook.id, preview, retry, selectedId]);
  const visibleDetail = preview ? sections.find((item) => item.id === selectedId) : detail;
  const select = (id: string) => {
    setDetailError('');
    setSelectedId(id);
  };
  const reload = () => {
    setLoading(true);
    setError('');
    setDetailError('');
    setRetry((n) => n + 1);
  };
  const index = sections.findIndex((section) => section.id === selectedId);
  const scene = scenes.find((item) => item.id === selectedId);
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-slate-50 md:flex-row">
      <aside className="max-h-36 shrink-0 overflow-y-auto border-b bg-white p-3 md:max-h-none md:w-64 md:border-b-0 md:border-r">
        <p className="mb-2 px-3 text-xs font-semibold text-slate-500">章节</p>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            aria-current={selectedId === section.id ? 'page' : undefined}
            onClick={() => select(section.id)}
            className={`mb-1 w-full rounded-xl px-3 py-3 text-left text-sm ${selectedId === section.id ? 'bg-sky-50 font-semibold text-sky-700' : 'hover:bg-slate-50'}`}
          >
            {section.title}
          </button>
        ))}
        {loading ? (
          <p className="flex items-center gap-2 p-3 text-xs">
            <Loader2 className="size-4 animate-spin" />
            加载章节…
          </p>
        ) : cursor ? (
          <Button
            variant="ghost"
            onClick={() => {
              setLoading(true);
              setError('');
              setPageCursor(cursor);
            }}
          >
            更多章节
          </Button>
        ) : null}
        {error ? (
          <div role="alert" className="p-3 text-sm text-rose-700">
            {error}
            <Button variant="outline" onClick={reload}>
              重试
            </Button>
          </div>
        ) : null}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <article className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-8">
          <div ref={containerRef} className="mx-auto max-w-5xl">
            <h2 className="mb-5 text-xl font-semibold">{sections[index]?.title}</h2>
            {markdown ? (
              visibleDetail?.id === selectedId ? (
                <MessageResponse className="text-[15px] leading-8">
                  {visibleDetail.markdown || '本节暂时没有正文。'}
                </MessageResponse>
              ) : detailError ? (
                <div role="alert">
                  {detailError}
                  <Button variant="outline" onClick={reload}>
                    重试本节
                  </Button>
                </div>
              ) : selectedId ? (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <Loader2 className="size-4 animate-spin" />
                  正在读取正文…
                </p>
              ) : null
            ) : scene?.content.type === 'slide' ? (
              <ThumbnailSlide
                slide={scene.content.canvas}
                size={width}
                viewportSize={scene.content.canvas.viewportSize || 1000}
                viewportRatio={scene.content.canvas.viewportRatio || 9 / 16}
              />
            ) : scene?.content.type === 'markdown' ? (
              <MessageResponse>{scene.content.markdown}</MessageResponse>
            ) : scene ? (
              <p>此页为互动内容，请在课堂中查看。</p>
            ) : null}
            {!loading && !error && !sections.length ? (
              <p className="py-12 text-center text-slate-500">
                <BookOpen className="mx-auto mb-3" />
                这本笔记本还没有发布内容。
              </p>
            ) : null}
          </div>
        </article>
        <footer className="flex shrink-0 items-center justify-between border-t bg-white px-5 py-3">
          <Button
            variant="outline"
            disabled={index <= 0}
            onClick={() => select(sections[index - 1].id)}
          >
            <ChevronLeft className="size-4" />
            上一章
          </Button>
          <span className="text-sm text-slate-500">
            {index + 1} / {sections.length}
            {cursor ? '+' : ''}
          </span>
          <Button
            variant="outline"
            disabled={index < 0 || index >= sections.length - 1}
            onClick={() => select(sections[index + 1].id)}
          >
            下一章
            <ChevronRight className="size-4" />
          </Button>
        </footer>
      </div>
    </div>
  );
}
