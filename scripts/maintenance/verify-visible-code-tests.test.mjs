import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { visibleCodeTests } = await jiti.import('../../lib/problem-bank/visible-code-tests.ts');

test('published tests take priority over unrelated sample calls', () => {
  const tests = [{ id: 'public-1', expression: 'current_part(0)', expected: 'False' }];
  assert.equal(
    visibleCodeTests({ publicTests: tests, sampleIO: [{ input: 'other_part(0)', output: '0' }] }),
    tests,
  );
});
test('older examples become runnable cases without inventing expected values', () => {
  assert.deepEqual(visibleCodeTests({ sampleIO: [{ input: 'f([])', output: '[]' }] }), [
    { id: 'sample-1', expression: 'f([])', expected: '[]', description: undefined },
  ]);
  assert.deepEqual(visibleCodeTests({}), []);
});
