/**
 * App 里「去游戏里领」的提示：连续学习解锁了限定奖励、今天能免费单抽时各提示一次。
 * 做题时的积分、够抽了等通知见 practice-game-notify.ts。
 */

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
