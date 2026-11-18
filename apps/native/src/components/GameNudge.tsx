import { useEffect, useRef, useState } from 'react';
import { Gamepad2, Gift, Sparkles, X } from 'lucide-react';
import { getBrawlStudyStatus, type BrawlStudyStatus } from '../data/brawl-study';
import { marbleImages } from '../lib/learning-action-marbles';
import {
  GAME_NUDGE_IDLE_MS,
  addGameNudgeActiveTime,
  gameNudgeDay,
  gameNudgeDue,
  markGameNudgeDismissed,
  markGameNudgeShown,
  markGamePlayed,
  markGameStudyPromptSeen,
  nextGameStudyPrompt,
  readGameStudySeen,
  writeGameStudySeen,
  type GameStudySeen,
  readGameNudgeState,
  writeGameNudgeState,
  type GameNudgeState,
} from '../lib/game-nudge';
import './game-nudge.css';

const TICK_MS = 15_000;
const VISIBLE_MS = 14_000;

/**
 * 停留时间到了就亮出「去玩一把」胶囊。
 * `enabled`：这台设备有游戏入口、且是学生。`blocked`：现在不适合打扰（做题中、上课中、已在游戏里）。
 * 被挡住时时间照常累计，等不再被挡住才弹。
 */
export function useGameNudge({
  enabled,
  blocked,
  playing,
}: {
  enabled: boolean;
  blocked: boolean;
  playing: boolean;
}) {
  const [state, setState] = useState<GameNudgeState>(() => readGameNudgeState());
  const [minutes, setMinutes] = useState<number | null>(null);
  const lastInput = useRef(0);
  const live = useRef({ state, blocked });
  useEffect(() => {
    live.current = { state, blocked };
    writeGameNudgeState(state);
  }, [state, blocked]);

  useEffect(() => {
    if (!enabled) return;
    const touch = () => {
      lastInput.current = Date.now();
    };
    touch();
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of events) window.addEventListener(name, touch, { passive: true });
    return () => {
      for (const name of events) window.removeEventListener(name, touch);
    };
  }, [enabled]);

  // 在游戏里不算学习时间。被挡住时照常累计，下一拍发现不挡了再弹。
  useEffect(() => {
    if (!enabled || playing) return;
    const timer = window.setInterval(() => {
      const day = gameNudgeDay();
      const active =
        document.visibilityState === 'visible' &&
        Date.now() - lastInput.current <= GAME_NUDGE_IDLE_MS;
      let next = active
        ? addGameNudgeActiveTime(live.current.state, day, TICK_MS)
        : live.current.state;
      if (!live.current.blocked && gameNudgeDue(next, day)) {
        setMinutes(Math.max(1, Math.round(next.activeMs / 60_000)));
        next = markGameNudgeShown(next, day);
      }
      if (next === live.current.state) return;
      live.current.state = next;
      setState(next);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [enabled, playing]);

  // 没点也没关：过一会儿自己收起，导航栏上的小点留着。
  useEffect(() => {
    if (minutes === null) return;
    const timer = window.setTimeout(() => setMinutes(null), VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [minutes]);

  const change = (apply: (state: GameNudgeState, day: string) => GameNudgeState) => {
    setMinutes(null);
    const next = apply(live.current.state, gameNudgeDay());
    live.current.state = next;
    setState(next);
  };

  return {
    /** 胶囊上显示的学习分钟数；null 表示现在不显示。 */
    minutes: enabled && !blocked ? minutes : null,
    hint: enabled && state.hint,
    /** 学生点了关闭：今天不再弹。 */
    dismiss: () => change(markGameNudgeDismissed),
    /** 学生进了游戏（从哪进都算）：重新计时。 */
    played: () => change(markGamePlayed),
  };
}

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
  const markSeen = () => {
    if (!status) return;
    const next = markGameStudyPromptSeen(status, seen);
    writeGameStudySeen(next);
    setSeen(next);
  };
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
  kind = 'time',
  onPlay,
  onDismiss,
}: {
  eyebrow: string;
  title: string;
  kind?: 'time' | 'reward' | 'draw';
  onPlay: () => void;
  onDismiss: () => void;
}) {
  const Icon = kind === 'reward' ? Gift : kind === 'draw' ? Sparkles : Gamepad2;
  return (
    <div className={`game-nudge is-${kind}`} role="status">
      <button type="button" className="game-nudge-play" onClick={onPlay}>
        <span className="game-nudge-marble" aria-hidden="true">
          <img
            src={marbleImages[kind === 'reward' ? 'amber' : kind === 'draw' ? 'pink' : 'purple']}
            alt=""
          />
          <Icon size={15} strokeWidth={2.2} />
        </span>
        <span className="game-nudge-text">
          <small>{eyebrow}</small>
          <strong>{title}</strong>
        </span>
      </button>
      <button
        type="button"
        className="game-nudge-close"
        onClick={onDismiss}
        aria-label={kind === 'time' ? '今天不再提醒' : '关闭'}
      >
        <X size={13} />
      </button>
    </div>
  );
}
