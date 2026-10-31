/** Editing helpers for Racket / HtDP code: token classes for highlighting and newline indentation. */

export type RacketTokenKind =
  | 'comment'
  | 'string'
  | 'number'
  | 'keyword'
  | 'builtin'
  | 'decorator'
  | 'operator'
  | 'text';

export function isRacketLanguage(language: string | undefined | null): boolean {
  const normalized = language?.trim().toLowerCase();
  return normalized === 'racket' || normalized === 'scheme';
}

/** Forms DrRacket indents like a body (two spaces) instead of aligning arguments. */
const BODY_FORMS = new Set([
  'define',
  'define-struct',
  'lambda',
  'λ',
  'local',
  'let',
  'let*',
  'letrec',
  'cond',
  'case',
  'when',
  'unless',
  'begin',
  'shared',
  'big-bang',
  'for/list',
  'for/fold',
]);

const KEYWORDS = new Set([
  ...BODY_FORMS,
  'if',
  'else',
  'and',
  'or',
  'require',
  'quote',
  'check-expect',
  'check-within',
  'check-error',
  'check-satisfied',
  'check-random',
  'check-member-of',
  'check-range',
]);

const BUILTINS = new Set([
  'cons',
  'first',
  'rest',
  'empty',
  'empty?',
  'cons?',
  'list',
  'list?',
  'append',
  'length',
  'map',
  'filter',
  'foldr',
  'foldl',
  'build-list',
  'andmap',
  'ormap',
  'member?',
  'remove',
  'reverse',
  'not',
  'add1',
  'sub1',
  'zero?',
  'string=?',
  'string-append',
  'string-length',
  'number?',
  'string?',
  'boolean?',
  'false?',
  'image?',
  'max',
  'min',
  'abs',
  'error',
  'identity',
]);

const DELIMITER = /[\s()[\]{}";]/;

function readString(line: string, start: number) {
  let end = start + 1;
  while (end < line.length) {
    if (line[end] === '\\') end += 2;
    else if (line[end] === '"') return { end: end + 1, closed: true };
    else end += 1;
  }
  return { end: line.length, closed: false };
}

/** Tokenize one line. Multi-line strings and #| |# comments are coloured line by line. */
export function racketLineTokens(
  line: string,
  state: { blockComment: boolean; string: boolean } = { blockComment: false, string: false },
): { tokens: Array<{ text: string; kind: RacketTokenKind }>; state: typeof state } {
  const tokens: Array<{ text: string; kind: RacketTokenKind }> = [];
  let index = 0;
  let { blockComment, string } = state;
  const push = (text: string, kind: RacketTokenKind) => {
    if (text) tokens.push({ text, kind });
  };
  while (index < line.length) {
    if (blockComment) {
      const end = line.indexOf('|#', index);
      push(line.slice(index, end === -1 ? line.length : end + 2), 'comment');
      index = end === -1 ? line.length : end + 2;
      blockComment = end === -1;
      continue;
    }
    if (string) {
      let end = index;
      while (end < line.length && line[end] !== '"') end += line[end] === '\\' ? 2 : 1;
      push(line.slice(index, Math.min(end + 1, line.length)), 'string');
      string = end >= line.length;
      index = end + 1;
      continue;
    }
    const char = line[index];
    if (char === ';') {
      push(line.slice(index), 'comment');
      break;
    }
    if (line.startsWith('#|', index)) {
      blockComment = true;
      continue;
    }
    if (line.startsWith('#;', index)) {
      push('#;', 'comment');
      index += 2;
      continue;
    }
    if (char === '"') {
      const { end, closed } = readString(line, index);
      push(line.slice(index, end), 'string');
      string = !closed;
      index = end;
      continue;
    }
    if ('()[]{}'.includes(char) || char === "'" || char === '`' || char === ',') {
      push(char, 'operator');
      index += 1;
      continue;
    }
    if (/\s/.test(char)) {
      let end = index;
      while (end < line.length && /\s/.test(line[end])) end += 1;
      push(line.slice(index, end), 'text');
      index = end;
      continue;
    }
    let end = index;
    while (end < line.length && !DELIMITER.test(line[end])) end += 1;
    const atom = line.slice(index, end);
    push(
      atom,
      /^[-+]?(\d+\/\d+|\d*\.?\d+(e[-+]?\d+)?)$/i.test(atom) ||
        /^#(t|f|true|false)$/.test(atom) ||
        atom === 'true' ||
        atom === 'false'
        ? 'number'
        : atom.startsWith('@')
          ? 'decorator'
          : KEYWORDS.has(atom)
            ? 'keyword'
            : BUILTINS.has(atom)
              ? 'builtin'
              : 'text',
    );
    index = end;
  }
  return { tokens, state: { blockComment, string } };
}

/**
 * Newline with DrRacket-style indentation: inside an open paren, body forms indent two
 * columns past the paren; other calls align with their first argument when it is on the
 * same line, otherwise one column past the paren. At top level the new line starts at 0.
 */
export function racketNewlineEdit(value: string, start: number, end = start) {
  const prefix = value.slice(0, start);
  const open: number[] = [];
  let inString = false;
  let lineComment = false;
  let blockDepth = 0;
  for (let i = 0; i < prefix.length; i += 1) {
    const char = prefix[i];
    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockDepth) {
      if (prefix.startsWith('|#', i)) {
        blockDepth -= 1;
        i += 1;
      } else if (prefix.startsWith('#|', i)) {
        blockDepth += 1;
        i += 1;
      }
      continue;
    }
    if (inString) {
      if (char === '\\') i += 1;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === ';') lineComment = true;
    else if (prefix.startsWith('#|', i)) {
      blockDepth = 1;
      i += 1;
    } else if (char === '"') inString = true;
    else if (char === '(' || char === '[' || char === '{') open.push(i);
    else if ((char === ')' || char === ']' || char === '}') && open.length) open.pop();
  }

  let indent = 0;
  const bracket = open.at(-1);
  if (!inString && bracket !== undefined) {
    const lineStart = prefix.lastIndexOf('\n', bracket) + 1;
    const column = bracket - lineStart;
    const lineEnd = prefix.indexOf('\n', bracket);
    const rest = prefix.slice(bracket + 1, lineEnd === -1 ? prefix.length : lineEnd);
    const head = rest.match(/^[^\s()[\]{}";]+/)?.[0];
    if (head && BODY_FORMS.has(head)) indent = column + 2;
    else if (head) {
      const argument = rest.slice(head.length).match(/^\s+(?=\S)/);
      indent =
        argument && !rest.slice(head.length).trim().startsWith(';')
          ? column + 1 + head.length + argument[0].length
          : column + 1;
    } else indent = column + 1;
  } else if (inString) {
    indent = 0;
  }
  const insert = `\n${' '.repeat(indent)}`;
  return {
    value: `${prefix}${insert}${value.slice(end).replace(/^[ \t]+(?=\S)/, '')}`,
    caret: start + insert.length,
  };
}

const OPENERS: Record<string, string> = { '(': ')', '[': ']', '{': '}' };
const CLOSERS = new Set([')', ']', '}']);

/**
 * Pair every bracket in the source, skipping strings, comments and #\( character literals.
 * Unmatched or mismatched brackets map to -1.
 */
export function racketBracketPairs(value: string): Map<number, number> {
  const pairs = new Map<number, number>();
  const open: number[] = [];
  let i = 0;
  while (i < value.length) {
    const char = value[i];
    if (char === ';') {
      const end = value.indexOf('\n', i);
      i = end === -1 ? value.length : end;
    } else if (value.startsWith('#|', i)) {
      let depth = 1;
      i += 2;
      while (i < value.length && depth) {
        if (value.startsWith('|#', i)) {
          depth -= 1;
          i += 2;
        } else if (value.startsWith('#|', i)) {
          depth += 1;
          i += 2;
        } else i += 1;
      }
    } else if (value.startsWith('#\\', i)) {
      i += 3;
      while (i < value.length && /[A-Za-z]/.test(value[i])) i += 1;
    } else if (char === '"') {
      i += 1;
      while (i < value.length && value[i] !== '"') i += value[i] === '\\' ? 2 : 1;
      i += 1;
    } else if (OPENERS[char]) {
      open.push(i);
      i += 1;
    } else if (CLOSERS.has(char)) {
      const start = open.pop();
      if (start === undefined) pairs.set(i, -1);
      else if (OPENERS[value[start]] !== char) {
        pairs.set(i, -1);
        pairs.set(start, -1);
      } else {
        pairs.set(i, start);
        pairs.set(start, i);
      }
      i += 1;
    } else i += 1;
  }
  for (const start of open) pairs.set(start, -1);
  return pairs;
}

/**
 * The bracket pair next to the caret, DrRacket style: just after a closer wins, then just
 * before an opener, then just before a closer / just after an opener. `matched: false`
 * marks a bracket with no partner (only `open` is set, at that bracket).
 */
export function racketBracketAtCaret(
  value: string,
  caret: number,
  pairs = racketBracketPairs(value),
): { open: number; close: number; matched: boolean } | null {
  const candidates = [caret - 1, caret, caret, caret - 1];
  const wanted = [CLOSERS, OPENERS, CLOSERS, OPENERS];
  for (let index = 0; index < candidates.length; index += 1) {
    const at = candidates[index];
    const char = value[at];
    if (at < 0 || !char || !pairs.has(at)) continue;
    const isWanted = wanted[index] === CLOSERS ? CLOSERS.has(char) : Boolean(OPENERS[char]);
    if (!isWanted) continue;
    const partner = pairs.get(at)!;
    if (partner === -1) return { open: at, close: at, matched: false };
    return { open: Math.min(at, partner), close: Math.max(at, partner), matched: true };
  }
  return null;
}
