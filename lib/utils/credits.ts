export const DEFAULT_USER_CASH_CREDITS = 0;
export const DEFAULT_USER_COMPUTE_CREDITS = 200;
export const DEFAULT_USER_PURCHASE_CREDITS = 300;
export const DEFAULT_USER_CREDITS = DEFAULT_USER_CASH_CREDITS;
export const CREDITS_PER_USD = 100;
export const USD_PER_CREDIT = 1 / CREDITS_PER_USD;
export const TOKENS_PER_CREDIT = 5000;

const USD_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const USD_PRECISE_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 4,
  maximumFractionDigits: 4,
});

function toSafeInt(value: number | null | undefined): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(0, Math.round(value));
}

export function creditsFromPriceCents(priceCents: number | null | undefined): number {
  return toSafeInt(priceCents);
}

export function priceCentsFromCredits(credits: number | null | undefined): number {
  return toSafeInt(credits);
}

export function usdFromCredits(credits: number | null | undefined): number {
  return toSafeInt(credits) * USD_PER_CREDIT;
}

export function creditsFromUsd(
  usd: number | null | undefined,
  rounding: 'round' | 'ceil' = 'round',
): number {
  if (typeof usd !== 'number' || Number.isNaN(usd) || usd <= 0) return 0;
  const rawCredits = usd * CREDITS_PER_USD;
  return rounding === 'ceil' ? Math.ceil(rawCredits) : Math.round(rawCredits);
}

export function creditsFromTokenUsage(totalTokens: number | null | undefined): number {
  const tokens = toSafeInt(totalTokens);
  if (tokens <= 0) return 0;
  return Math.max(1, Math.ceil(tokens / TOKENS_PER_CREDIT));
}

export function formatUsdLabel(usd: number | null | undefined): string {
  if (typeof usd !== 'number' || Number.isNaN(usd) || usd <= 0) return USD_FORMATTER.format(0);
  if (usd < 0.01) return USD_PRECISE_FORMATTER.format(usd);
  return USD_FORMATTER.format(usd);
}

export function formatCreditsLabel(credits: number): string {
  return `${toSafeInt(credits)} credits`;
}

export function formatCashCreditsLabel(credits: number): string {
  return `${toSafeInt(credits)} 现金积分`;
}

export function formatComputeCreditsLabel(credits: number): string {
  return `${toSafeInt(credits)} 算力积分`;
}

export function formatPurchaseCreditsLabel(credits: number): string {
  return `${toSafeInt(credits)} 购买积分`;
}

export function formatCreditsUsdLabel(credits: number): string {
  const safeCredits = toSafeInt(credits);
  return `${safeCredits} credits (${formatUsdLabel(usdFromCredits(safeCredits))})`;
}

export function formatCreditsUsdCompactLabel(credits: number): string {
  const safeCredits = toSafeInt(credits);
  return `${safeCredits} cr · ${formatUsdLabel(usdFromCredits(safeCredits))}`;
}
