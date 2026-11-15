/** An incomplete multipart submission is not a mistake if its graded parts all passed. */
export function problemAttemptHasMistake(attempt: { status: string; result: unknown }): boolean {
  if (attempt.status === 'failed') return true;
  if (attempt.status !== 'partial') return false;
  const result = attempt.result;
  const parts = result && typeof result === 'object' && 'parts' in result ? result.parts : null;
  if (!Array.isArray(parts) || parts.length === 0) return true;
  return parts.some(
    (part: unknown) =>
      part !== null &&
      typeof part === 'object' &&
      'status' in part &&
      (part.status === 'failed' || part.status === 'partial'),
  );
}
