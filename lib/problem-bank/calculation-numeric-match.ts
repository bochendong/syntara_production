import { parseNumericScalar } from './numeric-answer';

type NumericTolerance = {
  tolerance?: number;
  relativeTolerance?: number;
};

/** Parse a complete scalar for calculation answers, including plain integer fractions. */
function parseCalculationScalar(value: string): number | null {
  const original = value.trim();
  const raw = /^\$[^$]+\$$/.test(original) ? original.slice(1, -1).trim() : original;
  const fraction = raw.match(/^([+-]?\d+)\s*\/\s*([+-]?\d+)$/);
  const latexFraction = raw.match(/^([+-]?)\\(?:d?frac)\{([+-]?\d+)\}\{([+-]?\d+)\}$/);
  if (latexFraction) {
    const numerator = Number(latexFraction[2]);
    const denominator = Number(latexFraction[3]);
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0)
      return null;
    return (latexFraction[1] === '-' ? -1 : 1) * (numerator / denominator);
  }
  if (!fraction) {
    // Avoid treating distinct high-precision decimals as equal after IEEE-754 rounding.
    const decimal = raw.replace(/\\,/g, '').replace(/\{,\}/g, ',').replace(/,/g, '');
    if (/^[+-]?\d+\.\d+$/.test(decimal)) {
      const significant = decimal
        .replace(/^[+-]/, '')
        .replace('.', '')
        .replace(/^0+/, '')
        .replace(/0+$/, '');
      if (significant.length > 15) return null;
    }
    const parsed = parseNumericScalar(value);
    return parsed !== null && Number.isFinite(parsed) && Math.abs(parsed) <= Number.MAX_SAFE_INTEGER
      ? parsed
      : null;
  }
  const numerator = Number(fraction[1]);
  const denominator = Number(fraction[2]);
  if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || denominator === 0)
    return null;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : null;
}

function parseCalculationPair(value: string): [number, number] | null {
  const original = value.trim();
  const raw = (/^\$[^$]+\$$/.test(original) ? original.slice(1, -1) : original)
    .replace(/\\left|\\right/g, '')
    .trim();
  if (!raw.startsWith('(') || !raw.endsWith(')')) return null;
  const parts = raw.slice(1, -1).split(',');
  if (parts.length !== 2) return null;
  const left = parseCalculationScalar(parts[0]);
  const right = parseCalculationScalar(parts[1]);
  return left === null || right === null ? null : [left, right];
}

/** Apply the server's explicit numeric tolerance rules without accepting partial text. */
export function calculationNumericMatches(
  submitted: string,
  candidates: string[],
  grading: NumericTolerance,
): boolean {
  if (
    !(typeof grading.tolerance === 'number' && Number.isFinite(grading.tolerance)) &&
    !(typeof grading.relativeTolerance === 'number' && Number.isFinite(grading.relativeTolerance))
  )
    return false;
  const userNumeric = parseCalculationScalar(submitted);
  const userPair = parseCalculationPair(submitted);
  return candidates.some((candidate) => {
    const expectedPair = parseCalculationPair(candidate);
    const expectedNumeric = expectedPair ? null : parseCalculationScalar(candidate);
    const values: Array<[number, number]> =
      userPair && expectedPair
        ? [
            [userPair[0], expectedPair[0]],
            [userPair[1], expectedPair[1]],
          ]
        : userNumeric !== null && expectedNumeric !== null
          ? [[userNumeric, expectedNumeric]]
          : [];
    return (
      values.length > 0 &&
      values.every(([actual, expected]) => {
        if (
          !Number.isFinite(actual) ||
          !Number.isFinite(expected) ||
          Math.abs(actual) > Number.MAX_SAFE_INTEGER ||
          Math.abs(expected) > Number.MAX_SAFE_INTEGER
        )
          return false;
        const difference = Math.abs(actual - expected);
        return (
          (typeof grading.tolerance === 'number' &&
            Number.isFinite(grading.tolerance) &&
            grading.tolerance >= 0 &&
            difference <= grading.tolerance) ||
          (typeof grading.relativeTolerance === 'number' &&
            Number.isFinite(grading.relativeTolerance) &&
            grading.relativeTolerance >= 0 &&
            difference <= Math.abs(expected) * grading.relativeTolerance)
        );
      })
    );
  });
}
