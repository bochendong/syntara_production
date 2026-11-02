import assert from 'node:assert/strict';
import test from 'node:test';
import {
  allPublicTestsPassed,
  codePassedPublicTests,
  codeReadyToSubmit,
} from '../../apps/native/src/data/public-test-gate.ts';

const code = 'def area(a, b): return a * b';
const tests = [{ id: 'small' }, { id: 'large' }];
const passed = { code, passed: true };

test('unrun, failed and in-flight tests do not permit submission', () => {
  assert.equal(codePassedPublicTests(undefined, code), false);
  assert.equal(codePassedPublicTests({ code, passed: false }, code), false);
});

test('every public case must pass, including separately executed cases', () => {
  assert.equal(allPublicTestsPassed(tests, { small: passed }, code), false);
  assert.equal(allPublicTestsPassed(tests, { small: passed, large: passed }, code), true);
  assert.equal(
    allPublicTestsPassed(tests, { small: passed, large: { code, passed: false } }, code),
    false,
  );
});

test('code edits invalidate previous results and mixed revisions cannot pass', () => {
  const edited = code + '\nprint("edited")';
  assert.equal(codePassedPublicTests(passed, edited), false);
  assert.equal(
    allPublicTestsPassed(tests, { small: passed, large: { code: edited, passed: true } }, edited),
    false,
  );
});

test('empty or missing public cases cannot produce a passing receipt', () => {
  assert.equal(allPublicTestsPassed([], {}, code), false);
  assert.equal(allPublicTestsPassed(tests, {}, code), false);
});

test('hidden or custom case results cannot satisfy the public test list', () => {
  assert.equal(allPublicTestsPassed(tests, { hidden: passed, custom: passed }, code), false);
});

test('a failing rerun revokes a previously passing receipt', () => {
  const results = { small: passed, large: passed };
  assert.equal(allPublicTestsPassed(tests, results, code), true);
  results.small = { code, passed: false };
  assert.equal(allPublicTestsPassed(tests, results, code), false);
});

test('Racket design-recipe questions can submit without nonexistent public tests', () => {
  assert.equal(codeReadyToSubmit({ language: 'racket', publicTests: [] }, undefined, code), true);
  assert.equal(codeReadyToSubmit({ language: 'python', publicTests: [] }, undefined, code), false);
});

test('ordinary Racket cases and test files still require passing the current source', () => {
  for (const content of [
    { language: 'racket', publicTests: tests },
    { language: 'racket', publicTests: [], publicTestCode: '(check-expect (f 1) 2)' },
  ]) {
    assert.equal(codeReadyToSubmit(content, undefined, code), false);
    assert.equal(codeReadyToSubmit(content, passed, code), true);
    assert.equal(codeReadyToSubmit(content, passed, code + ' changed'), false);
  }
});
