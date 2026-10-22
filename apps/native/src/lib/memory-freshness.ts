import type { LocalStudyMemory } from '../domain/models';

/**
 * 记忆的“温度”：刚存或刚复习过的是 1，越久没碰越接近 0。
 * 在手机上点开一条记忆读一遍，就算复习过一次；复习时间会经服务器在三端之间同步。
 */

const REVIEWED_KEY = 'syntara.memory-reviewed.v1';
const DAY_MS = 24 * 60 * 60 * 1000;
/** 3 天内都算新鲜，之后大约 6 周慢慢变雾。 */
const FRESH_DAYS = 3;
const FADE_DAYS = 42;
export const STALE_FRESHNESS = 0.34;

export type ReviewedMap = Record<string, number>;

export function readReviewedMap(): ReviewedMap {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(REVIEWED_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? (parsed as ReviewedMap) : {};
  } catch {
    return {};
  }
}

export function markMemoryReviewed(memoryId: string, now = Date.now()): ReviewedMap {
  const map = { ...readReviewedMap(), [memoryId]: now };
  try {
    localStorage.setItem(REVIEWED_KEY, JSON.stringify(map));
  } catch {
    // 存不下也没关系，只是下次打开时弹珠还是雾的。
  }
  return map;
}

/** 别的设备上的复习时间（经服务器同步过来）并进本机，每条取较晚的那次。 */
export function mergeReviewedMap(incoming: ReviewedMap): ReviewedMap {
  const map = { ...readReviewedMap() };
  let changed = false;
  for (const [memoryId, at] of Object.entries(incoming)) {
    if (typeof at === 'number' && at > (map[memoryId] ?? 0)) {
      map[memoryId] = at;
      changed = true;
    }
  }
  if (changed) {
    try {
      localStorage.setItem(REVIEWED_KEY, JSON.stringify(map));
    } catch {
      // 同上：存不下只影响弹珠的雾。
    }
  }
  return map;
}

export function memoryFreshness(
  memory: Pick<LocalStudyMemory, 'id' | 'updatedAt'>,
  reviewed: ReviewedMap,
  now = Date.now(),
): number {
  const last = Math.max(memory.updatedAt || 0, reviewed[memory.id] ?? 0);
  const ageDays = (now - last) / DAY_MS;
  return Math.max(0, Math.min(1, 1 - (ageDays - FRESH_DAYS) / FADE_DAYS));
}
