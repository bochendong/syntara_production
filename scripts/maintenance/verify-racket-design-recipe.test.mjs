import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
const { runRacketDesignRecipe } = await jiti.import('../../lib/server/racket-runner.ts');
const starter = `(require spd/tags)
(@htdf twice)
(define (twice x) 0)
`;
const reference = `(require spd/tags)
(@htdf twice)
(@signature Number -> Number)
(check-expect (twice 0) 0)
(check-expect (twice 3) 6)
(@template-origin Number)
(@template (define (twice x) (... x)))
(define (twice x) (* 2 x))
`;
const check = (studentCode) =>
  runRacketDesignRecipe({
    studentCode,
    referenceCode: reference,
    starterCode: starter,
    level: 'beginner',
    recipe: { checkTemplate: true, weight: 30, thoroughness: [] },
    timeoutMs: 5000,
  });

test('reference passes the real design recipe driver and starter is rejected', async () => {
  const good = await check(reference);
  assert(good.length > 0);
  assert(
    good.every((item) => item.passed),
    JSON.stringify(good),
  );
  const empty = await check(starter);
  assert(
    empty.some((item) => !item.passed),
    JSON.stringify(empty),
  );
});

test('renamed function parameters preserve equivalent templates', async () => {
  const result = await check(
    reference
      .replaceAll('(twice x)', '(twice y)')
      .replaceAll('... x', '... y')
      .replaceAll('* 2 x', '* 2 y'),
  );
  assert(
    result.every((item) => item.passed),
    JSON.stringify(result),
  );
});

test('incorrect signatures are rejected', async () => {
  const result = await check(reference.replace('Number -> Number', 'Number -> String'));
  assert(
    result.some((item) => !item.passed && /signature/.test(item.id)),
    JSON.stringify(result),
  );
});

test('templates missing the parameter are rejected', async () => {
  const result = await check(reference.replace('(... x)', '(... 1)'));
  assert(
    result.some((item) => !item.passed && /template/.test(item.id)),
    JSON.stringify(result),
  );
});

test('student tests are checked against the reference implementation', async () => {
  const result = await check(reference.replace('(twice 3) 6', '(twice 3) 7'));
  assert(
    result.some((item) => !item.passed),
    JSON.stringify(result),
  );
});
