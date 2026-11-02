'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type AttemptStatus = 'pending' | 'passed' | 'failed' | 'partial' | 'error';

export async function classroomFetch<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
  if (!response.ok || !payload) {
    const message =
      payload && typeof payload.error === 'string'
        ? payload.error
        : response.status === 401
          ? '请先登录。'
          : `请求失败 (${response.status})`;
    throw new Error(message);
  }
  return payload;
}

/** 读一次，之后每 intervalMs 静默刷新（页面在后台时不刷）。 */
export function usePolledJson<T>(path: string | null, intervalMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const pathRef = useRef(path);
  pathRef.current = path;

  const reload = useCallback(async () => {
    const current = pathRef.current;
    if (!current) return;
    try {
      const next = await classroomFetch<T>(current);
      if (pathRef.current === current) {
        setData(next);
        setError('');
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : '读取失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    void reload();
    if (!intervalMs) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void reload();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs, path, reload]);

  return { data, setData, error, loading, reload };
}

export const STATUS_STYLE: Record<
  AttemptStatus | 'none',
  { label: string; cell: string; dot: string }
> = {
  passed: {
    label: '正确',
    cell: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
    dot: 'bg-emerald-500',
  },
  partial: {
    label: '部分对',
    cell: 'bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200',
    dot: 'bg-amber-400',
  },
  failed: {
    label: '错误',
    cell: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200',
    dot: 'bg-rose-500',
  },
  error: {
    label: '出错',
    cell: 'bg-rose-100 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200',
    dot: 'bg-rose-500',
  },
  pending: {
    label: '待批改',
    cell: 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200',
    dot: 'bg-sky-400',
  },
  none: {
    label: '未交',
    cell: 'bg-slate-100 text-slate-400 dark:bg-white/5 dark:text-slate-500',
    dot: 'bg-slate-300 dark:bg-slate-600',
  },
};

export function StatusLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
      {(['passed', 'partial', 'failed', 'pending', 'none'] as const).map((status) => (
        <span key={status} className="inline-flex items-center gap-1.5">
          <span className={`size-2.5 rounded-full ${STATUS_STYLE[status].dot}`} />
          {STATUS_STYLE[status].label}
        </span>
      ))}
    </div>
  );
}

export function problemLabel(problem: { number: number | null; title: string }) {
  return problem.number ? `${problem.number}. ${problem.title}` : problem.title;
}

export function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes} 分钟`;
  return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}
