'use client';

import { useState } from 'react';
import { useReportAiActivity } from '@/lib/ai-progress/use-ai-activity';
import { Sparkles } from 'lucide-react';
import { TeacherCourseStudioClient } from '@/components/teacher/teacher-course-studio-client';
import styles from './header-light-preview.module.css';

export function HeaderLightPreview() {
  const [mode, setMode] = useState('soft');
  useReportAiActivity(mode !== 'off');
  return (
    <div className={styles.preview} data-light-mode={mode}>
      <TeacherCourseStudioClient courseId="demo-csc148" mockMode />
      <aside
        className="fixed bottom-5 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 text-slate-900 shadow-xl backdrop-blur-xl"
        aria-label="Header 动效预览控制"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-xl bg-cyan-50 text-cyan-700">
            <Sparkles className="size-4" />
          </span>
          <div>
            <p className="text-xs font-semibold">Header 光带 · 本地试映</p>
            <p className="mt-0.5 text-[11px] text-slate-500">模拟 AI 工作中 · 约 5 秒一轮</p>
          </div>
        </div>
        <div className="flex rounded-xl bg-slate-100 p-1" role="group" aria-label="光带强度">
          {(
            [
              { id: 'off', label: '关闭' },
              { id: 'soft', label: '柔和' },
              { id: 'bright', label: '明显' },
            ] as const
          ).map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-cyan-500 ${mode === id ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </aside>
    </div>
  );
}
