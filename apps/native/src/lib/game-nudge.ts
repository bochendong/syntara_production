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

/* ---------- 学习奖励提示：能解锁限定奖励、能免费单抽时各提示一次 ---------- */

const STUDY_SEEN_KEY = 'syntara.game-nudge.study.v1';

export type GameStudyStatus = {
  day: string;
  streak: number;
  pendingPoints: number;
  claimable: Array<{ id: string; days: number; label: string }>;
  freeDraw: boolean;
  next: { days: number; label: string } | null;
};

/** 已经提示过的：每个限定奖励一次，免费单抽每天一次。 */
export type GameStudySeen = { rewards: string[]; drawDay: string };

export type GameStudyPrompt = {
  key: string;
  kind: 'reward' | 'draw';
  eyebrow: string;
  title: string;
};

export function nextGameStudyPrompt(
  status: GameStudyStatus | null,
  seen: GameStudySeen,
): GameStudyPrompt | null {
  if (!status) return null;
  const reward = [...status.claimable]
    .sort((a, b) => b.days - a.days)
    .find((item) => !seen.rewards.includes(item.id));
  if (reward)
    return {
      key: reward.id,
      kind: 'reward',
      eyebrow: `连续学习 ${reward.days} 天`,
      title: `去领${reward.label}`,
    };
  if (status.freeDraw && seen.drawDay !== status.day)
    return {
      key: `draw:${status.day}`,
      kind: 'draw',
      eyebrow: '今天做对题了',
      title: '免费抽一次',
    };
  return null;
}

/** 一次提示把同时能领的都算作提示过，免得连着弹。 */
export function markGameStudyPromptSeen(
  status: GameStudyStatus,
  seen: GameStudySeen,
): GameStudySeen {
  return {
    rewards: [...new Set([...seen.rewards, ...status.claimable.map((item) => item.id)])],
    drawDay: status.freeDraw ? status.day : seen.drawDay,
  };
}

/** 庆祝卡片上的一行小字：离下一个限定奖励还差几天。 */
export function gameStreakHint(status: GameStudyStatus | null) {
  if (!status?.next || status.streak < 1) return null;
  const left = Math.max(1, status.next.days - status.streak);
  return `连续学习 ${status.streak} 天 · 再 ${left} 天解锁${status.next.label}`;
}

export function readGameStudySeen(): GameStudySeen {
  try {
    const stored = JSON.parse(localStorage.getItem(STUDY_SEEN_KEY) || 'null');
    if (stored && Array.isArray(stored.rewards))
      return {
        rewards: stored.rewards.filter((id: unknown) => typeof id === 'string'),
        drawDay: typeof stored.drawDay === 'string' ? stored.drawDay : '',
      };
  } catch {
    // 读不到就当没提示过。
  }
  return { rewards: [], drawDay: '' };
}

export function writeGameStudySeen(seen: GameStudySeen) {
  try {
    localStorage.setItem(STUDY_SEEN_KEY, JSON.stringify(seen));
  } catch {
    // 存不了时，刷新后可能再提示一次。
  }
}
