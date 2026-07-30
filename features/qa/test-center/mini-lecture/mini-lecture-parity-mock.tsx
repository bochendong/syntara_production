'use client';

import { useMemo, useState } from 'react';
import { MiniLectureClassroomDialog } from '@/components/learn/learn-page-client';
import { buildMiniLectureDeck } from '@/features/learn-core/client-mini-lecture';

export function MiniLectureParityMock() {
  const [open, setOpen] = useState(true);
  const deck = useMemo(
    () =>
      buildMiniLectureDeck({
        id: 'mini-lecture-parity-prompt',
        title: '为什么黎曼和会收敛到定积分？',
        question: '为什么黎曼和会收敛到定积分？',
        answer:
          '先把区间切成许多小段，用矩形面积近似曲线下方面积。分割越来越细时，近似误差不断缩小，黎曼和就趋近于定积分。',
        courseName: 'MAT136 · Calculus II',
        createdAt: 0,
      }),
    [],
  );

  return (
    <main className="grid min-h-dvh place-items-center bg-slate-100 p-6">
      <button
        type="button"
        className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
        onClick={() => setOpen(true)}
      >
        打开小课堂
      </button>
      <MiniLectureClassroomDialog deck={deck} open={open} onOpenChange={setOpen} />
    </main>
  );
}
