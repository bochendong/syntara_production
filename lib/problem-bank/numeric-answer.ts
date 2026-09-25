function unwrapMath(value: string): string {
  const trimmed = value.trim();
  if (/^\$[^$]+\$$/.test(trimmed)) return trimmed.slice(1, -1).trim();
  return trimmed;
}

/** Parse only a complete scalar; never take the first number from prose or a tuple. */
export function parseNumericScalar(value: string): number | null {
  const raw = unwrapMath(value).replace(/\\,/g, '').replace(/\{,\}/g, ',').trim();
  const fraction = raw.match(/^([+-]?)\\(?:d?frac)\{([+-]?\d+)\}\{([+-]?\d+)\}$/);
  if (fraction) {
    const denominator = Number(fraction[3]);
    if (denominator === 0) return null;
    return (fraction[1] === '-' ? -1 : 1) * (Number(fraction[2]) / denominator);
  }
  const compactFraction = raw.match(/^([+-]?)\\(?:d?frac)(\d)(\d)$/);
  if (compactFraction) {
    const denominator = Number(compactFraction[3]);
    if (denominator === 0) return null;
    return (compactFraction[1] === '-' ? -1 : 1) * (Number(compactFraction[2]) / denominator);
  }
  if (!/^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(raw)) return null;
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** Parse a complete ordered pair of numeric scalars, including simple LaTeX fractions. */
export function parseNumericPair(value: string): [number, number] | null {
  const raw = unwrapMath(value)
    .replace(/\\left|\\right/g, '')
    .trim();
  if (!raw.startsWith('(') || !raw.endsWith(')')) return null;
  const parts = raw.slice(1, -1).split(',');
  if (parts.length !== 2) return null;
  const left = parseNumericScalar(parts[0]);
  const right = parseNumericScalar(parts[1]);
  return left === null || right === null ? null : [left, right];
}
