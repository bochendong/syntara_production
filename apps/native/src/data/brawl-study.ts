import { browserRequest } from './browser-platform';
import { browserApp } from './browser-runtime';

/** 服务器按做题记录算出来的「游戏里有什么可以领」。见 lib/server/brawl-study.ts。 */
export type BrawlStudyStatus = {
  day: string;
  /** 到今天为止连续学习了几天。 */
  streak: number;
  best: number;
  /** 做题赚到、还没转进游戏的积分。 */
  pendingPoints: number;
  /** 天数够了、还没进游戏领的限定奖励。 */
  claimable: Array<{ id: string; days: number; name: string; label: string }>;
  /** 今天做对过题，免费单抽还没用。 */
  freeDraw: boolean;
  next: { days: number; name: string; label: string } | null;
};

/** 只有网页版的游戏连着账号存档；电脑安装版的游戏是离线的，没有这些奖励。 */
export async function getBrawlStudyStatus(): Promise<BrawlStudyStatus | null> {
  if (!browserApp) return null;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return browserRequest<BrawlStudyStatus>(
    `/api/native/v1/games/brawl/study?${new URLSearchParams({ timeZone })}`,
  );
}
