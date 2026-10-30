import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const { createJiti } = require('jiti');
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const { evaluateNotebookNonCodeProblem } = jiti(`${root}/lib/server/notebook-problems/evaluate.ts`);
const { gradeLocalProblem } = jiti(`${root}/apps/native/src/data/local-problem-grading.ts`);
const { notebookProblemGradingSchema } = jiti(`${root}/lib/problem-bank/schema.ts`);

async function results(text, grading) {
  const problem = {
    type: 'calculation',
    points: 100,
    publicContent: { type: 'calculation', stem: 'Calculate' },
    grading: {
      type: 'calculation',
      graderKind: 'numeric_or_exact',
      referenceAnswer: '229.6875',
      acceptedForms: [],
      ...grading,
    },
  };
  const web = await evaluateNotebookNonCodeProblem({
    problem,
    answer: { text },
    language: 'en-US',
  });
  const native = gradeLocalProblem(problem, { kind: 'text', text });
  return [web.status, native.status];
}

test('explicit opt-in applies the declared tolerance on both surfaces', async () => {
  const grading = { numericEquivalenceVersion: 'scalar-v1', tolerance: 0.000001 };
  for (const text of ['3675 / 16', '229.687500', '229.6875005', '$\\frac{3675}{16}$']) {
    assert.deepEqual(await results(text, grading), ['passed', 'passed'], text);
  }
  for (const text of ['-229.6875', '229.688', '3675/0', 'answer 229.6875']) {
    assert.deepEqual(await results(text, grading), ['failed', 'failed'], text);
  }
});

test('without opt-in the preexisting web and native behavior stays unchanged', async () => {
  assert.deepEqual(await results('229.687500', { tolerance: 0.000001 }), ['passed', 'failed']);
  assert.deepEqual(await results('3675 / 16', { tolerance: 0.000001 }), ['failed', 'failed']);
  assert.deepEqual(await results('229.6875', {}), ['passed', 'passed']);
  assert.deepEqual(await results('229.687500', {}), ['failed', 'failed']);
});

test('opt-in does not implicitly enable numeric matching without a tolerance', async () => {
  assert.deepEqual(await results('229.687500', { numericEquivalenceVersion: 'scalar-v1' }), [
    'failed',
    'failed',
  ]);
});

test('zero and relative tolerance are applied without dropping signs', async () => {
  assert.deepEqual(
    await results('-3675 / 16', {
      numericEquivalenceVersion: 'scalar-v1',
      referenceAnswer: '-229.6875',
      tolerance: 0,
    }),
    ['passed', 'passed'],
  );
  assert.deepEqual(
    await results('3675 / -16', {
      numericEquivalenceVersion: 'scalar-v1',
      referenceAnswer: '-229.6875',
      tolerance: 0,
    }),
    ['passed', 'passed'],
  );
  assert.deepEqual(
    await results('230', { numericEquivalenceVersion: 'scalar-v1', relativeTolerance: 0.002 }),
    ['passed', 'passed'],
  );
  assert.deepEqual(
    await results('231', { numericEquivalenceVersion: 'scalar-v1', relativeTolerance: 0.002 }),
    ['failed', 'failed'],
  );
});

test('units, scientific notation, expressions and unsafe fraction operands are not newly parsed', async () => {
  const grading = { numericEquivalenceVersion: 'scalar-v1', tolerance: 0.000001 };
  for (const text of [
    '229.6875 kg',
    '2.296875e2',
    '229+0.6875',
    '1/1/1',
    '9007199254740993 / 39215686274510',
    '229.6875000000000001',
    '999999999999999999999999999999999999999999',
    '\\frac{999999999999999999999999999999999999999}{1}',
  ]) {
    assert.deepEqual(await results(text, grading), ['failed', 'failed'], text);
  }
});

test('opted-in pair grading checks both components with the same tolerance', async () => {
  const grading = {
    numericEquivalenceVersion: 'scalar-v1',
    referenceAnswer: '(1,2)',
    tolerance: 0.00001,
  };
  for (const [text, expected] of [
    ['(1,2)', 'passed'],
    ['(1.000000,2)', 'passed'],
    ['(1,2.001)', 'failed'],
    ['(1,2,3)', 'failed'],
  ]) {
    assert.deepEqual(await results(text, grading), [expected, expected], text);
  }
});

test('explicit accepted strings still work even when not numeric', async () => {
  assert.deepEqual(
    await results('about 230', {
      numericEquivalenceVersion: 'scalar-v1',
      tolerance: 0.000001,
      acceptedForms: ['about 230'],
    }),
    ['passed', 'passed'],
  );
  const units = {
    numericEquivalenceVersion: 'scalar-v1',
    tolerance: 0,
    referenceAnswer: '3 kg',
  };
  assert.deepEqual(await results('3 kg', units), ['passed', 'passed']);
  assert.deepEqual(await results('3', units), ['failed', 'failed']);
  const scientific = {
    numericEquivalenceVersion: 'scalar-v1',
    tolerance: 0,
    referenceAnswer: '1e3',
  };
  assert.deepEqual(await results('1e3', scientific), ['passed', 'passed']);
  assert.deepEqual(await results('1000', scientific), ['failed', 'failed']);
});

test('calculation flag survives schema parsing; invalid versions are rejected', () => {
  const grading = { type: 'calculation', numericEquivalenceVersion: 'scalar-v1' };
  assert.equal(notebookProblemGradingSchema.parse(grading).numericEquivalenceVersion, 'scalar-v1');
  assert.equal(
    notebookProblemGradingSchema.safeParse({ ...grading, numericEquivalenceVersion: 'other' })
      .success,
    false,
  );
});

test('fill blanks retain the existing numeric parser semantics', async () => {
  const problem = {
    type: 'fill_blank',
    points: 100,
    publicContent: { type: 'fill_blank', stemTemplate: '{{x}}', blanks: [{ id: 'x' }] },
    grading: {
      type: 'fill_blank',
      blanks: [{ id: 'x', matcher: 'numeric_tolerance', acceptedAnswers: ['1'], tolerance: 0 }],
    },
  };
  const web = await evaluateNotebookNonCodeProblem({
    problem,
    answer: { blanks: { x: '1/1' } },
    language: 'en-US',
  });
  const native = gradeLocalProblem(problem, { kind: 'blanks', blanks: { x: '1/1' } });
  assert.notEqual(web.status, 'passed');
  assert.notEqual(native.status, 'passed');
});
