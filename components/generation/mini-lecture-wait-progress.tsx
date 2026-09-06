'use client';

import { useState } from 'react';
import type { MiniLectureJob } from '@/features/learn-core/client-mini-lecture-jobs';
import { estimateTaskProgress } from '@/lib/ai-progress/estimate';
import { useProgressClock } from '@/lib/ai-progress/use-progress-clock';

export function MiniLectureWaitProgress({ job }: { job?: MiniLectureJob }) {
  const status = job?.status ?? 'queued';
  const [startedAt] = useState(() => Date.now());
  const now = useProgressClock(true);
  const view = estimateTaskProgress(
    {
      status: status === 'completed' ? 'running' : status,
      kind: 'mini-lecture',
      stage: 'generating',
      createdAt: startedAt,
      updatedAt: startedAt,
    },
    now,
  );
  // Completion of the server job precedes local media hydration; 100% belongs to the ready card.
  const percent = status === 'completed' ? 96 : view.percent;
  return (
    <div className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
      <div className="flex justify-between gap-3">
        <span>
          {status === 'queued'
            ? '等待生成资源'
            : status === 'completed'
              ? '正在准备课堂播放'
              : '正在生成图片、讲解与语音'}
        </span>
        <span className="shrink-0 tabular-nums">约 {percent}%</span>
      </div>
      <div
        role="progressbar"
        aria-label="课堂讲解生成进度（估算）"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent ?? undefined}
        className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10"
      >
        <div
          className="h-full rounded-full bg-sky-500 transition-[width] duration-1000 motion-reduce:transition-none"
          style={{ width: `${percent ?? 0}%` }}
        />
      </div>
      <p>{view.hint}。可以继续聊天，完成后此卡片会自动更新。</p>
    </div>
  );
}
