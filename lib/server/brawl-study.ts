import type { Prisma } from '@/lib/server/generated-prisma';

/**
 * 做题和游戏的连接：连续学习天数解锁限定奖励，每天第一道做对的题送一次免费单抽。
 * 一天 = 学生所在时区里至少提交过一次题。奖励按「历史最长连续天数」发，断签不收回。
 * 奖励本身（皮肤配色、饰品效果）定义在游戏的 game.js 里，这里只管谁够格。
 */
export const BRAWL_STREAK_REWARDS = [
  { days: 3, kind: 'relics', id: 'attendance', name: '全勤徽章', label: '限定饰品' },
  { days: 7, kind: 'skins', id: 'scholar_s', name: '学霸 · 晨读之星', label: '限定皮肤' },
  { days: 14, kind: 'skins', id: 'brawler_s', name: '体育委员 · 全勤传说', label: '限定传说皮肤' },
] as const;

export type BrawlStreakReward = (typeof BRAWL_STREAK_REWARDS)[number];

const DEFAULT_TIME_ZONE = 'America/Toronto';
const HISTORY_DAYS = 120;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function brawlStudyTimeZone(value: unknown) {
  if (typeof value !== 'string' || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value))
    return DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: value });
    return value;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

export function brawlStudyDay(now: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const dayNumber = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/** `streak` 是到今天为止的连续天数；今天还没学时，昨天的连续天数先留着。 */
export function brawlStudyStreaks(days: string[], today: string) {
  const numbers = [...new Set(days.filter((day) => DAY.test(day)).map(dayNumber))].sort(
    (a, b) => a - b,
  );
  const current = dayNumber(today);
  let best = 0;
  let run = 0;
  let streak = 0;
  numbers.forEach((day, index) => {
    run = index > 0 && day === numbers[index - 1] + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    if (day === current || day === current - 1) streak = run;
  });
  return { streak, best, studiedToday: numbers.includes(current) };
}

export const brawlStreakRewardsFor = (best: number) =>
  BRAWL_STREAK_REWARDS.filter((reward) => best >= reward.days);

export const nextBrawlStreakReward = (best: number) =>
  BRAWL_STREAK_REWARDS.find((reward) => best < reward.days) ?? null;

export type BrawlStudy = {
  day: string;
  streak: number;
  best: number;
  passedToday: boolean;
  earned: Array<{ kind: BrawlStreakReward['kind']; id: string; days: number }>;
};

export async function readBrawlStudy(
  db: Prisma.TransactionClient,
  userId: string,
  timeZoneInput: unknown,
  now = new Date(),
): Promise<BrawlStudy> {
  const timeZone = brawlStudyTimeZone(timeZoneInput);
  const day = brawlStudyDay(now, timeZone);
  const since = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);
  const rows = await db.$queryRaw<Array<{ day: string; passed: boolean }>>`
    SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timeZone}, 'YYYY-MM-DD') AS "day",
           bool_or("status" = 'passed' AND "brawlVerified" IS DISTINCT FROM false) AS "passed"
    FROM "NotebookProblemAttempt"
    WHERE "userId" = ${userId} AND "kind" IN ('submit', 'answer') AND "createdAt" >= ${since}
    GROUP BY 1`;
  const { streak, best } = brawlStudyStreaks(
    rows.map((row) => row.day),
    day,
  );
  return {
    day,
    streak,
    best,
    passedToday: rows.some((row) => row.day === day && row.passed),
    earned: brawlStreakRewardsFor(best).map(({ kind, id, days }) => ({ kind, id, days })),
  };
}

/** App 里的提示用：还有什么没去游戏里领。`save` 是账号的游戏存档（没有就是没玩过）。 */
export function brawlStudyPrompts(
  study: BrawlStudy,
  save: { skins?: unknown; relics?: unknown; study?: { freeDay?: unknown } } | null,
) {
  const owned = (kind: string) => {
    const list = save?.[kind as 'skins' | 'relics'];
    return Array.isArray(list) ? list : [];
  };
  return {
    claimable: brawlStreakRewardsFor(study.best)
      .filter((reward) => !owned(reward.kind).includes(reward.id))
      .map(({ id, days, name, label }) => ({ id, days, name, label })),
    freeDraw:
      study.passedToday &&
      (typeof save?.study?.freeDay !== 'string' || save.study.freeDay < study.day),
    next: nextBrawlStreakReward(study.best),
  };
}
