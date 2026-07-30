'use client';

import {
  SourceLibraryListCardFace,
  type SourceLibraryTile,
} from '@/components/learn/learn-page-client';

const SAMPLE_NOTEBOOKS: SourceLibraryTile[] = [
  {
    id: 'notebook-riemann',
    courseId: 'mat136',
    tileKind: 'notebook',
    title: '01 - 定积分：从矩形到基本定理',
    subtitle: '8 章节',
    dateLabel: '2026/7/29 18:30',
    coverImagePath: null,
    placeholderLabel: 'NOTEBOOK',
    typeLabel: 'Markdown',
    updatedAt: 0,
    isProblemBank: false,
    status: null,
    error: null,
    sourceHash: null,
    textNotebookIds: [],
    textSectionIds: [],
    textBlocks: [],
  },
  {
    id: 'notebook-volume',
    courseId: 'mat136',
    tileKind: 'notebook',
    title: '04 - 面积与体积：从曲线间面积到切片法',
    subtitle: '6 章节',
    dateLabel: '2026/7/28 14:10',
    coverImagePath: null,
    placeholderLabel: 'NOTEBOOK',
    typeLabel: '讲义',
    updatedAt: 0,
    isProblemBank: false,
    status: null,
    error: null,
    sourceHash: null,
    textNotebookIds: [],
    textSectionIds: [],
    textBlocks: [],
  },
];

export function NotebookLibraryParityMock() {
  return (
    <main className="min-h-dvh bg-slate-50 px-6 py-8">
      <header className="mx-auto max-w-5xl border-b border-slate-200 pb-4">
        <h1 className="text-base font-semibold text-slate-900">MAT136 · 笔记本库</h1>
        <p className="mt-1 text-xs text-slate-500">App 视觉基线回归</p>
      </header>
      <div className="mx-auto mt-6 grid max-w-5xl grid-cols-[repeat(auto-fill,minmax(168px,1fr))] content-start gap-x-10 gap-y-11">
        {SAMPLE_NOTEBOOKS.map((tile) => (
          <button
            key={tile.id}
            type="button"
            className="group relative mx-auto block aspect-[3/4] min-h-[220px] w-full max-w-[210px] text-left transition duration-150 hover:-translate-y-1 hover:-rotate-[0.6deg]"
          >
            <SourceLibraryListCardFace tile={tile} />
          </button>
        ))}
      </div>
    </main>
  );
}
