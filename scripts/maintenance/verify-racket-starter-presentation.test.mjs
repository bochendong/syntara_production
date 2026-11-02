import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanRacketStarterInstructions as clean } from '../../lib/problem-bank/racket-starter-presentation.ts';

test('remove duplicate task blocks while retaining types, interpretations, purposes and stubs', () => {
  const instructions =
    '#|\nConsider the following PARTIAL data definition.\nYou must complete the template.\n|#\n';
  const documentation =
    ';; Peat is one of:\n;; - false\n;; - (make-crim Integer Peat)\n;; interp. an example value\n;; CONSTRAINT: k is positive\n';
  const source = `(require spd/tags)\n${instructions}(@htdd Peat)\n${documentation};; produce an image\n;(define (render p) empty-image) ;stub\n`;
  const result = clean(source);
  assert(!result.code.includes(instructions));
  assert(result.code.includes(documentation));
  assert(result.code.includes(';; produce an image'));
  assert(result.code.includes(';stub'));
  assert.deepEqual(result.removedComments, [instructions]);
  assert.equal(clean(result.code).code, result.code);
});

test('comment-like text in strings, character literals and nested documentation is preserved', () => {
  const source = String.raw`(define S "#| Consider the following PARTIAL data definition. |#")
(define T ";; Design a function that returns a string")
(define C #\;)
#| Documentation about the data. #| Nested detail |# Keep this description. |#
;; NOTE: Together these types form an ancestor tree.
;; All children represent upstream rivers.
(define (f x) x) ; Design a function appears in an inline note
`;
  assert.equal(clean(source).code, source);
});

test('draft migration removes only exact known source comments and preserves student notes and edits', () => {
  const original = ';; Design a function called f.\n';
  const edited = `;; Design a function with a student-written idea.\n${original}(define (f x) (+ x 9))\n`;
  const result = clean(edited, [original]);
  assert.equal(
    result.code,
    ';; Design a function with a student-written idea.\n(define (f x) (+ x 9))\n',
  );
  assert.equal(clean(edited, []).code, edited);
});
