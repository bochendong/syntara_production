import assert from 'node:assert/strict';
import test from 'node:test';
import { racketBracketPairs, racketBracketAtCaret } from '../../lib/problem-bank/racket-editor.ts';

test('nested parentheses, square brackets and braces pair in both directions', () => {
  assert.deepEqual(
    [...racketBracketPairs('([{}])')].sort((a, b) => a[0] - b[0]),
    [
      [0, 5],
      [1, 4],
      [2, 3],
      [3, 2],
      [4, 1],
      [5, 0],
    ],
  );
});

test('extra, missing and mismatched brackets are marked unmatched', () => {
  assert.deepEqual(
    [...racketBracketPairs(')(')],
    [
      [0, -1],
      [1, -1],
    ],
  );
  assert.deepEqual(
    [...racketBracketPairs('(]')],
    [
      [1, -1],
      [0, -1],
    ],
  );
  assert.ok([...racketBracketPairs('([)]').values()].every((partner) => partner === -1));
});

test('strings, escaped quotes, line comments, nested block comments and character literals are skipped', () => {
  for (const ignored of [
    '"([)]"',
    '"a\\\"[b"',
    '; ([)]\n',
    '#| ( #| [ |# ) |#',
    '#\\(',
    '#\\)',
    '#\\space',
  ]) {
    const source = `${ignored} (x)`;
    assert.equal(racketBracketPairs(source).size, 2, ignored);
    const open = source.lastIndexOf('(x)');
    assert.equal(racketBracketPairs(source).get(open), open + 2, ignored);
  }
  assert.equal(racketBracketPairs('"unfinished (').size, 0);
  assert.equal(racketBracketPairs('#| unfinished (').size, 0);
});

test('caret prioritizes the just-closed expression and uses UTF-16 textarea offsets', () => {
  assert.deepEqual(racketBracketAtCaret('()(x)', 2), { open: 0, close: 1, matched: true });
  assert.deepEqual(racketBracketAtCaret('(x)', 0), { open: 0, close: 2, matched: true });
  assert.deepEqual(racketBracketAtCaret('(x)', 1), { open: 0, close: 2, matched: true });
  assert.deepEqual(racketBracketAtCaret('(x)', 2), { open: 0, close: 2, matched: true });
  assert.deepEqual(racketBracketAtCaret('(x)', 3), { open: 0, close: 2, matched: true });
  assert.deepEqual(racketBracketAtCaret('中文😀 (x)', 5), { open: 5, close: 7, matched: true });
  assert.deepEqual(racketBracketAtCaret('(', 1), { open: 0, close: 0, matched: false });
  assert.equal(racketBracketAtCaret('name', 2), null);
  assert.equal(racketBracketAtCaret('; (', 3), null);
  assert.equal(racketBracketAtCaret('"("', 2), null);
});
