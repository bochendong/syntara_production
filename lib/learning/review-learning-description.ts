/** Render legacy reward copy as learning guidance without changing stored history. */
export function reviewLearningDescription(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  if (/奖励积分|奖励币|算力积分|购买积分|充值|提现|倍率|[+＋]?\d+\s*积分/.test(value))
    return fallback;
  return value.trim();
}
