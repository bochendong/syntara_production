import { useCallback, useEffect, useState } from 'react';
import { Check, Plus } from 'lucide-react';

import {
  getTeachLiveCourse,
  teachSessionAction,
  type TeachLiveCourse,
} from '../data/platform-api-client';
import { useAppNavigation } from './app-navigation-context';
import './teach-session.css';

/**
 * 题库页上课时的玻璃条和「加入这节课」。
 * 只有能教课的账号（有「教学」入口，手机上没有）才会去问这门课有没有在上。
 */
export function useTeachLiveCourse(courseId: string) {
  const enabled = Boolean(useAppNavigation()?.onOpenTeach);
  const [live, setLive] = useState<TeachLiveCourse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    if (!enabled) return;
    try {
      setLive(await getTeachLiveCourse(courseId));
    } catch {
      // 读不到就保持上一次的状态，不影响题库。
    }
  }, [courseId, enabled]);
  const isLive = Boolean(live);
  useEffect(() => {
    if (!enabled) return;
    const first = window.setTimeout(() => void refresh(), 0);
    const timer = window.setInterval(
      () => {
        if (document.visibilityState === 'visible') void refresh();
      },
      isLive ? 5_000 : 20_000,
    );
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [enabled, isLive, refresh]);

  const toggle = useCallback(
    async (problemId: string) => {
      if (!live) return;
      const added = live.problemIds.includes(problemId);
      setBusy(problemId);
      setError('');
      try {
        await teachSessionAction(
          added
            ? { action: 'remove', sessionId: live.sessionId, problemId }
            : { action: 'add', sessionId: live.sessionId, problemIds: [problemId] },
        );
        await refresh();
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : '操作失败');
      } finally {
        setBusy(null);
      }
    },
    [live, refresh],
  );

  return { live, busy, error, toggle };
}

export function TeachLiveBanner({ live, error }: { live: TeachLiveCourse | null; error: string }) {
  if (!live) return null;
  return (
    <>
      <div className="tl-banner" role="status">
        <span className="tl-dot" aria-hidden />
        正在上课 · 第 {live.number} 节 · {live.presentCount} 人在场
      </div>
      {error ? <p className="phone-page-error">{error}</p> : null}
    </>
  );
}

export function TeachSessionToggle({
  added,
  busy,
  onToggle,
}: {
  added: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      className={`tl-add${added ? ' is-added' : ''}`}
      aria-pressed={added}
      aria-label={added ? '从这节课移除' : '加入这节课'}
      title={added ? '从这节课移除' : undefined}
      disabled={busy}
      onClick={onToggle}
    >
      {added ? <Check size={15} aria-hidden /> : <Plus size={14} aria-hidden />}
      {added ? '已加入' : '加入这节课'}
    </button>
  );
}
