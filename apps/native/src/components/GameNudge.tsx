import { useCallback, useEffect, useRef, useState } from 'react';
import { Gift, Sparkles, X } from 'lucide-react';
import { getBrawlStudyStatus, type BrawlStudyStatus } from '../data/brawl-study';
import { marbleImages } from '../lib/learning-action-marbles';
import {
  markGameStudyPromptSeen,
  nextGameStudyPrompt,
  readGameStudySeen,
  writeGameStudySeen,
  type GameStudySeen,
} from '../lib/game-nudge';
import './game-nudge.css';

const VISIBLE_MS = 14_000;

/**
 * 学习奖励：连续学习解锁了限定奖励、或今天能免费单抽时提示一次。
 * `refreshKey` 变了就重新问服务器（做完题、从游戏回来之后）。
 */
export function useGameStudy({
  enabled,
  blocked,
  refreshKey,
}: {
  enabled: boolean;
  blocked: boolean;
  refreshKey: number;
}) {
  const [status, setStatus] = useState<BrawlStudyStatus | null>(null);
  const [seen, setSeen] = useState<GameStudySeen>(() => readGameStudySeen());
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const load = () => {
      if (document.visibilityState !== 'visible') return;
      getBrawlStudyStatus()
        .then((next) => {
          if (!cancelled) setStatus(next);
        })
        .catch((cause) => console.warn('[game-study] deferred', cause));
    };
    load();
    document.addEventListener('visibilitychange', load);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', load);
    };
  }, [enabled, refreshKey]);

  const prompt = enabled && !blocked ? nextGameStudyPrompt(status, seen) : null;
  const markSeen = useCallback(() => {
    if (!status) return;
    setSeen((previous) => markGameStudyPromptSeen(status, previous));
  }, [status]);
  useEffect(() => {
    writeGameStudySeen(seen);
  }, [seen]);
  const latestMarkSeen = useRef(markSeen);
  useEffect(() => {
    latestMarkSeen.current = markSeen;
  });
  const promptKey = prompt?.key;
  useEffect(() => {
    if (!promptKey) return;
    const timer = window.setTimeout(() => latestMarkSeen.current(), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [promptKey]);

  return {
    status: enabled ? status : null,
    prompt,
    /** 有东西还没去游戏里领：导航栏「游戏」上留小点。 */
    hint: enabled && !!status && (status.claimable.length > 0 || status.freeDraw),
    markSeen,
  };
}

export function GameNudge({
  eyebrow,
  title,
  kind,
  onPlay,
  onDismiss,
}: {
  eyebrow: string;
  title: string;
  kind: 'reward' | 'draw';
  onPlay: () => void;
  onDismiss: () => void;
}) {
  const Icon = kind === 'reward' ? Gift : Sparkles;
  return (
    <div className={`game-nudge is-${kind}`} role="status">
      <button type="button" className="game-nudge-play" onClick={onPlay}>
        <span className="game-nudge-marble" aria-hidden="true">
          <img src={marbleImages[kind === 'reward' ? 'amber' : 'pink']} alt="" />
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <span className="game-nudge-text">
          <small>{eyebrow}</small>
          <strong>{title}</strong>
        </span>
      </button>
      <button type="button" className="game-nudge-close" onClick={onDismiss} aria-label="关闭">
        <X size={13} />
      </button>
    </div>
  );
}
