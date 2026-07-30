'use client';

import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, HardDrive } from 'lucide-react';
import { MessageResponse } from '@/components/ai-elements/message';
import type { Scene, Stage as StageData } from '@/lib/types/stage';
import { cn } from '@/lib/utils';

type MarkdownNotebookReaderProps = {
  stage: StageData;
  scenes: Scene[];
  currentSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  headerActions?: ReactNode;
};

const appNotebookMarkdownClassName =
  'text-[15px] leading-[1.78] text-[#243044] [&_p]:mb-[13px] [&_h1]:mb-[0.55em] [&_h1]:mt-[1.5em] [&_h1]:text-[27px] [&_h1]:leading-tight [&_h2]:mb-[0.55em] [&_h2]:mt-[1.5em] [&_h2]:text-[22px] [&_h2]:leading-tight [&_h3]:mb-[0.55em] [&_h3]:mt-[1.5em] [&_h3]:text-lg [&_h3]:leading-tight [&_li]:mb-[7px] [&_ol]:mb-4 [&_ol]:pl-[25px] [&_ul]:mb-4 [&_ul]:pl-[25px] [&_blockquote]:my-[18px] [&_blockquote]:border-l-4 [&_blockquote]:border-blue-300 [&_blockquote]:bg-gradient-to-r [&_blockquote]:from-blue-50/70 [&_blockquote]:to-transparent [&_blockquote]:py-[3px] [&_blockquote]:pl-[17px] [&_blockquote]:text-slate-600 [&_hr]:my-7 [&_a]:text-blue-600 [&_a]:underline [&_a]:decoration-blue-600/35 [&_a]:underline-offset-3 [&_:not(pre)>code]:rounded-[5px] [&_:not(pre)>code]:border [&_:not(pre)>code]:border-slate-200 [&_:not(pre)>code]:bg-slate-50 [&_:not(pre)>code]:px-[0.38em] [&_:not(pre)>code]:py-[0.15em] [&_:not(pre)>code]:text-rose-700 [&_pre]:my-[18px] [&_pre]:overflow-auto [&_pre]:rounded-[13px] [&_pre]:bg-slate-900 [&_pre]:px-[18px] [&_pre]:py-4 [&_pre]:text-xs [&_pre]:leading-[1.65] [&_pre]:text-slate-200 [&_table]:my-[18px] [&_table]:w-full [&_table]:overflow-hidden [&_table]:rounded-[11px] [&_table]:border [&_table]:border-slate-200 [&_table]:text-[13px] [&_th]:bg-slate-50 [&_th]:font-bold [&_th]:text-slate-700 [&_td]:border-b [&_td]:border-r [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-[9px] [&_th]:border-b [&_th]:border-r [&_th]:border-slate-200 [&_th]:px-3 [&_th]:py-[9px] [&_[data-streamdown=image-wrapper]]:my-[22px] [&_[data-streamdown=image]]:mx-auto [&_[data-streamdown=image]]:max-h-[72vh] [&_[data-streamdown=image]]:max-w-full [&_[data-streamdown=image]]:rounded-xl [&_[data-streamdown=image]]:object-contain dark:text-slate-100 dark:[&_blockquote]:from-blue-400/10 dark:[&_blockquote]:text-slate-300 dark:[&_:not(pre)>code]:border-white/10 dark:[&_:not(pre)>code]:bg-white/5 dark:[&_:not(pre)>code]:text-rose-300';

export function MarkdownNotebookReader({
  stage,
  scenes,
  currentSceneId,
  onSelectScene,
  headerActions,
}: MarkdownNotebookReaderProps) {
  const sections = useMemo(
    () => scenes.filter((scene) => scene.content.type === 'markdown'),
    [scenes],
  );
  const selectedIndex = Math.max(
    0,
    currentSceneId ? sections.findIndex((section) => section.id === currentSceneId) : 0,
  );
  const selected = sections[selectedIndex] || null;
  const courseHref = stage.courseId
    ? `/learn?courseId=${encodeURIComponent(stage.courseId)}`
    : '/learn';

  const selectIndex = (index: number) => {
    const next = sections[index];
    if (next) onSelectScene(next.id);
  };

  return (
    <section
      className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-50"
      aria-label={`${stage.name} 阅读器`}
    >
      <header className="grid min-h-16 shrink-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-4 border-b border-slate-200 bg-slate-50/95 px-[18px] py-2.5 min-[561px]:min-h-[72px] min-[561px]:py-3 min-[821px]:grid-cols-[minmax(150px,0.7fr)_minmax(240px,1.6fr)_minmax(150px,0.7fr)] dark:border-white/10 dark:bg-white/[0.04]">
        <Link
          href={courseHref}
          className="inline-flex size-11 items-center justify-center gap-[7px] justify-self-start rounded-xl text-xs font-semibold text-slate-600 transition hover:bg-slate-200 hover:text-slate-950 min-[561px]:w-auto min-[561px]:px-3 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-white"
        >
          <ArrowLeft className="size-[18px]" />
          <span className="hidden min-[561px]:inline">返回课程</span>
        </Link>

        <div className="min-w-0 text-left min-[821px]:text-center">
          <span className="text-[10px] font-bold tracking-[0.1em] text-sky-600 dark:text-sky-300">
            本地笔记本
          </span>
          <h1 className="mt-[3px] truncate text-[17px] font-semibold">{stage.name}</h1>
        </div>

        <div className="hidden min-w-0 items-center justify-end gap-2 justify-self-end text-[11px] text-slate-500 min-[821px]:flex dark:text-slate-400">
          {headerActions}
          <span className="inline-flex items-center gap-[7px]">
            <HardDrive className="size-3.5" />
            {sections.length} 个离线章节
          </span>
        </div>
      </header>

      <div className="grid min-h-0 min-w-0 flex-1 grid-rows-[auto_minmax(0,1fr)] min-[821px]:grid-cols-[242px_minmax(0,1fr)] min-[821px]:grid-rows-none">
        <nav
          aria-label="笔记章节"
          className="flex max-h-[70px] gap-[7px] overflow-x-auto overflow-y-hidden border-b border-slate-200 bg-slate-50 px-3 py-[9px] min-[821px]:block min-[821px]:max-h-none min-[821px]:overflow-auto min-[821px]:border-b-0 min-[821px]:border-r min-[821px]:px-3 min-[821px]:py-[15px] dark:border-white/10 dark:bg-white/[0.035]"
        >
          {sections.map((section, index) => {
            const active = index === selectedIndex;
            return (
              <button
                key={section.id}
                type="button"
                className={cn(
                  'grid min-h-12 w-[min(230px,62vw)] min-w-[min(230px,62vw)] grid-cols-[27px_minmax(0,1fr)] items-center gap-[7px] rounded-[11px] border px-2.5 py-2 text-left text-slate-500 transition min-[821px]:mb-[5px] min-[821px]:min-h-[46px] min-[821px]:w-full min-[821px]:min-w-0',
                  active
                    ? 'border-sky-200 bg-white text-slate-950 dark:border-sky-300/30 dark:bg-white/10 dark:text-white'
                    : 'border-transparent hover:border-sky-200 hover:bg-white hover:text-slate-950 dark:hover:border-white/10 dark:hover:bg-white/5 dark:hover:text-white',
                )}
                onClick={() => selectIndex(index)}
              >
                <span
                  className={cn(
                    'grid size-[23px] place-items-center rounded-lg bg-slate-200 text-[9px] font-bold text-slate-500',
                    active && 'bg-sky-600 text-white',
                  )}
                >
                  {index + 1}
                </span>
                <strong className="truncate text-[11px] font-semibold">{section.title}</strong>
              </button>
            );
          })}
        </nav>

        <main className="min-h-0 min-w-0 overflow-auto bg-white px-[18px] pb-24 pt-6 overscroll-contain min-[821px]:px-[clamp(24px,6vw,78px)] min-[821px]:pb-[88px] min-[821px]:pt-[30px] dark:bg-slate-950">
          {selected && selected.content.type === 'markdown' ? (
            <>
              <div className="mx-auto mb-6 w-full max-w-[900px]">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                  <FileText className="size-[15px]" />
                  {selectedIndex + 1} / {sections.length}
                </span>
                <h2 className="mt-[7px] text-[22px] font-semibold leading-[1.18] tracking-[-0.035em] min-[561px]:text-[clamp(23px,3vw,34px)]">
                  {selected.title}
                </h2>
              </div>
              <MessageResponse
                className={cn('mx-auto w-full max-w-[900px]', appNotebookMarkdownClassName)}
              >
                {selected.content.markdown}
              </MessageResponse>
            </>
          ) : (
            <div className="grid min-h-[250px] place-content-center justify-items-center gap-2 text-center text-slate-400">
              <FileText className="size-7" />
              <strong className="text-slate-600 dark:text-slate-300">笔记本还没有内容</strong>
              <span className="max-w-[360px] text-xs leading-[1.55]">
                当前笔记本没有找到可阅读的 Markdown 章节。
              </span>
            </div>
          )}
        </main>
      </div>

      {sections.length > 1 ? (
        <footer className="absolute bottom-[18px] left-2.5 right-2.5 flex items-center justify-between gap-2.5 rounded-[14px] border border-slate-200 bg-white/95 p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.12)] backdrop-blur-[18px] min-[561px]:left-auto min-[561px]:right-6 dark:border-white/10 dark:bg-slate-900/95">
          <button
            type="button"
            disabled={selectedIndex === 0}
            className="inline-flex min-h-[38px] items-center gap-[7px] rounded-[9px] bg-slate-100 px-3 text-xs text-slate-700 disabled:opacity-40 dark:bg-white/10 dark:text-slate-200"
            onClick={() => selectIndex(Math.max(0, selectedIndex - 1))}
          >
            <ChevronLeft className="size-[17px]" />
            上一节
          </button>
          <span className="min-w-[54px] text-center text-[10px] text-slate-500 dark:text-slate-400">
            {selectedIndex + 1} / {sections.length}
          </span>
          <button
            type="button"
            disabled={selectedIndex >= sections.length - 1}
            className="inline-flex min-h-[38px] items-center gap-[7px] rounded-[9px] bg-slate-100 px-3 text-xs text-slate-700 disabled:opacity-40 dark:bg-white/10 dark:text-slate-200"
            onClick={() => selectIndex(Math.min(sections.length - 1, selectedIndex + 1))}
          >
            下一节
            <ChevronRight className="size-[17px]" />
          </button>
        </footer>
      ) : null}
    </section>
  );
}
