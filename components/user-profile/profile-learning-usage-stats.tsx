'use client';

import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { listRemoteLearnSessionsPage } from '@/features/learn-conversations/client/remote-conversation-api';
import { listCoursesOrThrow } from '@/lib/utils/course-storage';

type LearningUsageStats = {
  courses: number;
  notebooks: number;
  problems: number;
  conversations: number;
};

const EMPTY_STATS: LearningUsageStats = {
  courses: 0,
  notebooks: 0,
  problems: 0,
  conversations: 0,
};

export function ProfileLearningUsageStats() {
  const [stats, setStats] = useState<LearningUsageStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [partial, setPartial] = useState(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setPartial(false);

    try {
      const courses = await listCoursesOrThrow();
      const conversationPages = await Promise.allSettled(
        courses.map((course) =>
          listRemoteLearnSessionsPage(course.id, {
            limit: 100,
          }),
        ),
      );

      setStats({
        courses: courses.length,
        notebooks: courses.reduce((total, course) => total + (course.notebookCount ?? 0), 0),
        problems: courses.reduce((total, course) => total + (course.problemCount ?? 0), 0),
        conversations: conversationPages.reduce(
          (total, result) =>
            result.status === 'fulfilled' && result.value
              ? total + result.value.sessions.length
              : total,
          0,
        ),
      });
      setPartial(
        conversationPages.some((result) => result.status === 'rejected' || result.value === null),
      );
    } catch {
      setStats(EMPTY_STATS);
      setPartial(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const items = [
    { label: '课程', value: stats.courses },
    { label: '笔记本', value: stats.notebooks },
    { label: '题目', value: stats.problems },
    { label: '会话', value: stats.conversations },
  ];

  return (
    <section
      className="mt-5 rounded-[18px] border border-slate-200 bg-white/80 p-2.5 shadow-sm"
      aria-label="学习用量统计"
    >
      <header className="mb-2 flex items-center justify-between gap-2 px-1">
        <div>
          <p className="text-[10px] font-bold tracking-[0.08em] text-slate-400">学习用量</p>
          {partial ? <p className="mt-0.5 text-[9px] text-amber-600">部分数据暂不可用</p> : null}
        </div>
        <button
          type="button"
          onClick={() => void loadStats()}
          disabled={loading}
          className="grid size-7 place-items-center rounded-full border border-slate-200 bg-white text-slate-400 transition hover:text-slate-700 disabled:opacity-50"
          aria-label="刷新学习用量"
          title="刷新学习用量"
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </header>

      <div className="grid grid-cols-4 gap-1 max-[1100px]:grid-cols-2 max-[860px]:grid-cols-4 max-[520px]:grid-cols-2">
        {items.map((item) => (
          <div
            key={item.label}
            className="grid min-h-[58px] place-items-center rounded-[12px] bg-slate-50 px-1.5 py-2 text-center"
          >
            <strong className="text-base font-bold tabular-nums text-slate-950">
              {loading ? '—' : item.value.toLocaleString('zh-CN')}
            </strong>
            <small className="text-[9px] font-medium text-slate-500">{item.label}</small>
          </div>
        ))}
      </div>
    </section>
  );
}
