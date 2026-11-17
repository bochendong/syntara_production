/**
 * 「去玩一把」提示的节奏。只在这台设备上记，按天清零。
 *
 * 两个触发：
 * - 做题：每新通过 5 道题的庆祝卡片上带一个「去玩一把」按钮（见 PracticeCelebration）。
 * - 停留：今天累计认真用了一段时间后，弹一个小胶囊。
 *
 * 不打扰的规矩：做题页展开时、上课时、已经在游戏里时都不弹，等学生回到普通页面再出现；
 * 一天最多 3 次；学生点了关闭，今天就不再弹。
 */
export const GAME_NUDGE_FIRST_MINUTES = 25;
export const GAME_NUDGE_REPEAT_MINUTES = 40;
export const GAME_NUDGE_DAILY_LIMIT = 3;
/** 超过这么久没有操作就不算在学习。 */
export const GAME_NUDGE_IDLE_MS = 3 * 60_000;

const STORAGE_KEY = 'syntara.game-nudge.v1';

export type GameNudgeState = {
  day: string;
  /** 距离上一次提示或上一次玩游戏以来，累计的活跃毫秒数。 */
  activeMs: number;
  /** 今天已经弹过几次。 */
  shown: number;
  /** 今天学生点过关闭。 */
  muted: boolean;
  /** 弹过但还没去玩：导航栏「游戏」上留一个小点。 */
  hint: boolean;
};

export function gameNudgeDay(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${String(now.getDate()).padStart(2, '0')}`;
}

export function freshGameNudgeState(day: string): GameNudgeState {
  return { day, activeMs: 0, shown: 0, muted: false, hint: false };
}

function forDay(state: GameNudgeState, day: string) {
  return state.day === day ? state : freshGameNudgeState(day);
}

export function gameNudgeThresholdMs(state: GameNudgeState) {
  return (state.shown === 0 ? GAME_NUDGE_FIRST_MINUTES : GAME_NUDGE_REPEAT_MINUTES) * 60_000;
}

export function addGameNudgeActiveTime(state: GameNudgeState, day: string, ms: number) {
  const current = forDay(state, day);
  return { ...current, activeMs: current.activeMs + Math.max(0, ms) };
}

export function gameNudgeDue(state: GameNudgeState, day: string) {
  const current = forDay(state, day);
  return (
    !current.muted &&
    current.shown < GAME_NUDGE_DAILY_LIMIT &&
    current.activeMs >= gameNudgeThresholdMs(current)
  );
}

export function markGameNudgeShown(state: GameNudgeState, day: string): GameNudgeState {
  const current = forDay(state, day);
  return { ...current, activeMs: 0, shown: current.shown + 1, hint: true };
}

export function markGameNudgeDismissed(state: GameNudgeState, day: string): GameNudgeState {
  return { ...forDay(state, day), muted: true, hint: false };
}

/** 学生进了游戏（不管从哪进的）：重新计时，小点消失。 */
export function markGamePlayed(state: GameNudgeState, day: string): GameNudgeState {
  return { ...forDay(state, day), activeMs: 0, hint: false };
}

export function readGameNudgeState(day = gameNudgeDay()): GameNudgeState {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') as GameNudgeState | null;
    if (stored && stored.day === day && Number.isFinite(stored.activeMs))
      return {
        day,
        activeMs: Math.max(0, stored.activeMs),
        shown: Math.max(0, Math.floor(stored.shown) || 0),
        muted: stored.muted === true,
        hint: stored.hint === true,
      };
  } catch {
    // 存不了也照常用，只是刷新后重新计时。
  }
  return freshGameNudgeState(day);
}

export function writeGameNudgeState(state: GameNudgeState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 同上。
  }
}
