#!/usr/bin/env node
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = dirname(fileURLToPath(import.meta.url));
const { parseNumericPair, parseNumericScalar } = createJiti(import.meta.url, {
  interopDefault: true,
})(join(here, '../../lib/problem-bank/numeric-answer.ts'));
const { evaluateNotebookNonCodeProblem } = createJiti(import.meta.url, {
  interopDefault: true,
  alias: { '@': join(here, '../..') },
})(join(here, '../../lib/server/notebook-problems/evaluate.ts'));

assert.equal(parseNumericScalar('$15{,}360$'), 15360);
assert.equal(parseNumericScalar('$-\\frac{50}{2}$'), -25);
assert.equal(parseNumericScalar('$-\\frac53$'), -5 / 3);
assert.equal(parseNumericScalar('$\\frac{3675}{16}$'), 3675 / 16);
assert.equal(parseNumericScalar('4080'), 4080);
assert.equal(parseNumericScalar('$(40,80)$'), null);
assert.equal(parseNumericScalar('result: 640'), null);
assert.equal(parseNumericScalar('15,36'), null);
assert.deepEqual(parseNumericPair('$(40,80)$'), [40, 80]);
assert.deepEqual(parseNumericPair('$\\left(\\frac{128}{9},\\frac{220}{9}\\right)$'), [
  128 / 9,
  220 / 9,
]);
assert.equal(parseNumericPair('4080'), null);
assert.equal(parseNumericPair('(40,80,100)'), null);
const calculation = (referenceAnswer, acceptedForms, tolerance = 0) => ({
  type: 'calculation',
  points: 100,
  publicContent: { type: 'calculation', stem: 'Calculate.' },
  grading: { type: 'calculation', referenceAnswer, acceptedForms, tolerance },
});
const grade = async (problem, text) =>
  evaluateNotebookNonCodeProblem({ problem, answer: { text }, language: 'en-US' });
assert.equal((await grade(calculation('$(40,80)$', ['$(40,80)$']), '4080')).status, 'failed');
assert.equal((await grade(calculation('$(40,80)$', ['$(40,80)$']), '(40,80)')).status, 'passed');
assert.equal((await grade(calculation('$(40,80)$', ['$(40,80)$']), '(40,81)')).status, 'failed');
assert.equal(
  (
    await grade(
      calculation('$\\left(\\frac{128}{9},\\frac{220}{9}\\right)$', [], 0.02),
      '(14.22,24.44)',
    )
  ).status,
  'passed',
);
assert.equal((await grade(calculation('$-25$', ['$-\\frac{50}{2}$']), '50')).status, 'failed');
assert.equal((await grade(calculation('$-25$', ['$-\\frac{50}{2}$']), '-25')).status, 'passed');
assert.equal((await grade(calculation('$15{,}360$', []), '15')).status, 'failed');
assert.equal((await grade(calculation('$15{,}360$', []), '15360')).status, 'passed');
assert.equal((await grade(calculation('$\\frac{3675}{16}$', []), '3675')).status, 'failed');
console.log('numeric scalar and pair parsing: complete-value regression checks passed');
