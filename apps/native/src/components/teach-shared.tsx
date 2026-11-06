import { useCallback, useEffect, useState } from 'react';

import type { TeachAttemptStatus } from '../data/platform-api-client';
import { marbleImages } from '../lib/learning-action-marbles';

/** 老师端共用：弹珠颜色、题名、静默刷新。绿首次做对、紫多次做对、粉错、琥珀部分对或待批改、灰没交。 */
export const STATUS: Record<TeachAttemptStatus | 'none', { label: string; marble: string | null }> =
  {
    passed: { label: '首次做对', marble: marbleImages.green },
    partial: { label: '部分对', marble: marbleImages.amber },
    pending: { label: '待批改', marble: marbleImages.amber },
    failed: { label: '错了', marble: marbleImages.pink },
    error: { label: '出错', marble: marbleImages.pink },
    none: { label: '没交', marble: null },
  };

/** 只用已提交的作答次数区分通过；运行测试不计入课堂 attempts。 */
export function teachResultStatus(status: TeachAttemptStatus | 'none', attempts = 0) {
  return status === 'passed' && attempts > 1
    ? { label: '多次做对', marble: marbleImages.purple }
    : STATUS[status];
}

export function Marble({
  status,
  attempts = 0,
  size = 22,
}: {
  status: TeachAttemptStatus | 'none';
  attempts?: number;
  size?: number;
}) {
  const marble = teachResultStatus(status, attempts).marble;
  return marble ? (
    <img className="tp-marble" src={marble} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="tp-marble is-empty" style={{ width: size, height: size }} aria-hidden />
  );
}

export function Legend() {
  const rows = [
    ['passed', 1, '首次做对'],
    ['passed', 2, '多次做对'],
    ['partial', 0, '部分对 / 待批改'],
    ['failed', 0, '错了'],
    ['none', 0, '没交'],
  ] as const;
  return (
    <div className="tp-legend">
      {rows.map(([status, attempts, label]) => (
        <span key={label}>
          <Marble status={status} attempts={attempts} size={14} />
          {label}
        </span>
      ))}
    </div>
  );
}

export function problemName(problem: { number: number | null; title: string }) {
  return problem.number ? `${problem.number}. ${problem.title}` : problem.title;
}

export function courseLabel(course: { courseCode: string | null; name: string }) {
  return course.name.trim() || course.courseCode?.trim() || '';
}

export function clock(timestamp: number) {
  return new Date(timestamp).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 读一次，之后静默刷新（页面在后台时不刷）。 */
export function usePolled<T>(load: () => Promise<T>, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  // load 要是稳定的函数（模块函数或 useCallback），换了就重新读。
  const reload = useCallback(async () => {
    try {
      setData(await load());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取失败');
    }
  }, [load]);
  useEffect(() => {
    const first = window.setTimeout(() => void reload(), 0);
    const timer = intervalMs
      ? window.setInterval(() => {
          if (document.visibilityState === 'visible') void reload();
        }, intervalMs)
      : 0;
    return () => {
      window.clearTimeout(first);
      if (timer) window.clearInterval(timer);
    };
  }, [intervalMs, reload]);
  return { data, setData, error, setError, reload };
}
