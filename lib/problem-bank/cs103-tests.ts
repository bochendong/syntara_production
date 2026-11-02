/**
 * Hidden tests for UBC CPSC 103 problems, built from the `expect(actual, expected)` calls a
 * reference solution already contains. Each expect becomes one unittest case that runs against
 * the student's file and compares with the same `_same` equality the cs103 module uses.
 */
import { usesCs103 } from './cs103-python';

export type Cs103Expect = { actual: string; expected: string; line: number };

export type Cs103DerivedTests = {
  publicTestCode: string;
  secretTestCode: string;
  sampleIO: { input: string; output: string }[];
  publicCount: number;
  secretCount: number;
};

/** Index of the last character of the string literal or comment starting at `at`. */
function tokenEnd(source: string, at: number): number {
  if (source[at] === '#') {
    const newline = source.indexOf('\n', at);
    return newline < 0 ? source.length - 1 : newline - 1;
  }
  const quote = source.startsWith(source[at].repeat(3), at) ? source[at].repeat(3) : source[at];
  let i = at + quote.length;
  while (i < source.length && !source.startsWith(quote, i)) {
    if (source[i] === '\\') i += 1;
    else if (quote.length === 1 && source[i] === '\n') return i - 1;
    i += 1;
  }
  return Math.min(i + quote.length - 1, source.length - 1);
}

/** End index (exclusive) of the bracketed group opened at `open`, skipping strings and comments. */
function closingIndex(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '#' || ch === '"' || ch === "'") {
      i = tokenEnd(source, i);
    } else if ('([{'.includes(ch)) {
      depth += 1;
    } else if (')]}'.includes(ch)) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Splits `a, b` at its top-level commas (outside brackets, strings and comments). */
function splitArguments(args: string): string[] {
  const parts: string[] = [];
  let start = 0;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (ch === '#' || ch === '"' || ch === "'") {
      i = tokenEnd(args, i);
    } else if ('([{'.includes(ch)) {
      const end = closingIndex(args, i);
      if (end < 0) return [];
      i = end - 1;
    } else if (ch === ',') {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts.map((part) => withoutComments(part).trim()).filter(Boolean);
}

/** The text with its `#` comments removed (strings are left alone). */
function withoutComments(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === '#' || text[i] === '"' || text[i] === "'") {
      const end = tokenEnd(text, i);
      if (text[i] !== '#') out += text.slice(i, end + 1);
      i = end;
    } else {
      out += text[i];
    }
  }
  return out;
}

/** The top-level (unindented) `expect(actual, expected)` calls in a cs103 file, in order. */
export function extractCs103Expects(source: string): Cs103Expect[] {
  const expects: Cs103Expect[] = [];
  const pattern = /^expect\s*\(/gm;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const open = match.index + match[0].length - 1;
    const close = closingIndex(source, open);
    if (close < 0) break;
    const args = splitArguments(source.slice(open + 1, close - 1));
    if (args.length === 2) {
      const line = source.slice(0, match.index).split('\n').length;
      expects.push({ actual: args[0], expected: args[1], line });
    }
    pattern.lastIndex = close;
  }
  return expects;
}

function expectKey(item: Cs103Expect): string {
  return `${item.actual.replace(/\s+/g, '')}\u0000${item.expected.replace(/\s+/g, '')}`;
}

/** A unittest module with one case per expect, comparing with cs103's `_same`. */
export function cs103UnittestSuite(expects: Cs103Expect[], className: string): string {
  const used = new Map<string, number>();
  const methods = expects.map((item) => {
    const callee = item.actual.match(/^([A-Za-z_]\w*)\s*\(/)?.[1] ?? 'value';
    const count = (used.get(callee) ?? 0) + 1;
    used.set(callee, count);
    return [
      `    def test_${callee}_${count}(self):`,
      `        ${JSON.stringify(`expect(${item.actual.replace(/\s+/g, ' ')}, ${item.expected.replace(/\s+/g, ' ')})`)}`,
      `        actual = (${item.actual})`,
      `        expected = (${item.expected})`,
      '        self.assertTrue(_same(actual, expected), "got %r but expected %r" % (actual, expected))',
    ].join('\n');
  });
  return [
    'import unittest',
    'from cs103 import _same',
    'from submission import *',
    '',
    '',
    `class ${className}(unittest.TestCase):`,
    methods.join('\n\n'),
    '',
  ].join('\n');
}

/**
 * True when `expected` can serve as a sampleIO output: examples are compared after evaluating the
 * output without builtins or the student's names, so only literals without floats qualify.
 */
function literalExpected(expected: string): boolean {
  const withoutStrings = expected.replace(/(['"])(?:\\.|(?!\1).)*\1/g, '""');
  return (
    !/\d\.\d|\de/i.test(withoutStrings) &&
    (withoutStrings.match(/[A-Za-z_]\w*/g) ?? []).every((name) =>
      ['True', 'False', 'None'].includes(name),
    )
  );
}

/**
 * Public and hidden suites for a cs103 problem. The expects already in the starter are public
 * (the student sees them), topped up from the reference to two. The reference's other expects
 * are hidden, or all of them when fewer than three are left. Returns null when the reference has
 * no expects.
 */
export function cs103TestsFromReference(args: {
  solutionCode: string;
  starterCode?: string;
}): Cs103DerivedTests | null {
  const reference = extractCs103Expects(args.solutionCode);
  if (!reference.length) return null;
  const visible = extractCs103Expects(args.starterCode ?? '');
  for (const item of reference) {
    if (visible.length >= 2) break;
    if (!visible.some((other) => expectKey(other) === expectKey(item))) visible.push(item);
  }
  const visibleKeys = new Set(visible.map(expectKey));
  const remaining = reference.filter((item) => !visibleKeys.has(expectKey(item)));
  const hidden = remaining.length >= 3 ? remaining : reference;
  const samples = [...visible, ...hidden]
    .filter((item) => literalExpected(item.expected))
    .filter((item, index, all) => all.findIndex((other) => other.actual === item.actual) === index)
    .slice(0, Math.max(2, visible.length))
    .map((item) => ({ input: item.actual, output: item.expected }));
  return {
    publicTestCode: cs103UnittestSuite(visible, 'PublicTests'),
    secretTestCode: cs103UnittestSuite(hidden, 'HiddenTests'),
    sampleIO: samples,
    publicCount: visible.length,
    secretCount: hidden.length,
  };
}

/** True when a Python code problem is written against cs103 and could get derived tests. */
export function isCs103Problem(language: string | undefined, ...sources: (string | undefined)[]) {
  return (language ?? 'python').toLowerCase() === 'python' && sources.some(usesCs103);
}
