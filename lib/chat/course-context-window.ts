export const COURSE_CONTEXT_TOKEN_BUDGET = 16_000;

/**
 * Conservative mixed Chinese/Latin token estimate for the course conversation
 * history. This is a soft context-budget estimate, not provider billing usage.
 */
export function estimateCourseContextTextTokens(text: string): number {
  const normalized = text.normalize('NFKC');
  const hanLike =
    normalized.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)?.length ?? 0;
  const other = Math.max(0, normalized.length - hanLike);
  return Math.ceil(hanLike * 1.15 + other / 4);
}
