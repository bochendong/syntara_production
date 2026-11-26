/**
 * 做题时弹的游戏通知：做对一题后，比较做题前后服务器给的游戏状态，算出这次该弹什么。
 *
 * 积分以服务器为准（做对一道没做对过的公开题：简单 3 / 中等 5 / 难 8，见
 * lib/server/brawl-practice-points.ts），所以「+N」是两次状态的差，不是本地估的。
 * 抽卡价格跟游戏 game.js 的 GACHA 一致。
 */
export const GAME_SINGLE_DRAW = 30;
export const GAME_TEN_DRAW = 270;
/** 换算「还差几道题」时按中等题算。 */
export const GAME_POINTS_PER_PROBLEM = 5;

export type PracticeGameStatus = {
  gamePoints: number;
  pendingPoints: number;
  freeDraw: boolean;
  claimable: Array<{ id: string; days: number; name: string; label: string }>;
  streak: number;
};

/** 学生下次进游戏时手里的总积分。 */
export function gameWallet(status: Pick<PracticeGameStatus, 'gamePoints' | 'pendingPoints'>) {
  return Math.max(0, (status.gamePoints || 0) + (status.pendingPoints || 0));
}

export function problemsForPoints(points: number) {
  return Math.max(1, Math.ceil(Math.max(0, points) / GAME_POINTS_PER_PROBLEM));
}

/** 顶部积分条：离下一次单抽还差多少。 */
export function gameDrawProgress(total: number) {
  const points = Math.max(0, Math.floor(total));
  const draws = Math.floor(points / GAME_SINGLE_DRAW);
  const into = points % GAME_SINGLE_DRAW;
  const missing = GAME_SINGLE_DRAW - into;
  return {
    total: points,
    draws,
    into,
    ratio: into / GAME_SINGLE_DRAW,
    problemsLeft: problemsForPoints(missing),
    label:
      draws > 0
        ? `能抽 ${draws} 次 · 再 ${problemsForPoints(missing)} 题多一次`
        : `再 ${problemsForPoints(missing)} 题就能抽一次`,
  };
}

export type PracticeGameBanner = {
  key: string;
  kind: 'draw' | 'ten' | 'free';
  title: string;
  detail: string;
};

export type PracticeGameReward = {
  key: string;
  days: number;
  name: string;
  label: string;
};

export type PracticeGameEvents = {
  /** 这次新到账的积分；0 表示没有。 */
  gained: number;
  banner: PracticeGameBanner | null;
  reward: PracticeGameReward | null;
};

const NONE: PracticeGameEvents = { gained: 0, banner: null, reward: null };

/**
 * 两次服务器状态之间发生了什么。`before` 为 null（第一次拿到状态）时什么都不弹，
 * 免得一打开做题页就把早就有的东西当新消息。
 */
export function practiceGameEvents(
  before: PracticeGameStatus | null,
  after: PracticeGameStatus | null,
): PracticeGameEvents {
  if (!before || !after) return NONE;
  const from = gameWallet(before);
  const to = gameWallet(after);
  const gained = Math.max(0, to - from);

  const known = new Set(before.claimable.map((item) => item.id));
  const fresh = [...after.claimable]
    .filter((item) => !known.has(item.id))
    .sort((a, b) => b.days - a.days)[0];
  const reward = fresh
    ? { key: `reward:${fresh.id}`, days: fresh.days, name: fresh.name, label: fresh.label }
    : null;

  let banner: PracticeGameBanner | null = null;
  if (after.freeDraw && !before.freeDraw)
    banner = {
      key: 'free',
      kind: 'free',
      title: '免费单抽到账了',
      detail: '今天第一次做对题，送你一次',
    };
  else if (from < GAME_TEN_DRAW && to >= GAME_TEN_DRAW)
    banner = {
      key: `ten:${to}`,
      kind: 'ten',
      title: '够十连了！',
      detail: `攒了 ${to} 游戏积分`,
    };
  else if (Math.floor(to / GAME_SINGLE_DRAW) > Math.floor(from / GAME_SINGLE_DRAW))
    banner = {
      key: `draw:${Math.floor(to / GAME_SINGLE_DRAW)}`,
      kind: 'draw',
      title: Math.floor(to / GAME_SINGLE_DRAW) > 1 ? '又够抽一次了！' : '够抽一次了！',
      detail: `攒了 ${to} 游戏积分`,
    };

  return { gained, banner, reward };
}
