import assert from 'node:assert/strict';
import test from 'node:test';
import {
  problemCodeDraftKey,
  readProblemCodeDraft,
  saveProblemCodeDraft,
} from '../../apps/native/src/data/problem-code-draft.ts';
function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}
test('drafts survive reopening and reset replaces previous code, including empty code', () => {
  const store = storage();
  const key = problemCodeDraftKey('account-a', 'course', 'question');
  assert.equal(readProblemCodeDraft(store, key), null);
  for (const code of ['print("你好")', '', 'def solve():\n    pass']) {
    saveProblemCodeDraft(store, key, code);
    assert.equal(readProblemCodeDraft(store, key), code);
  }
});
test('accounts, courses and questions have separate drafts', () => {
  const store = storage();
  const keys = [
    ['a', 'c', 'p'],
    ['b', 'c', 'p'],
    ['a', 'd', 'p'],
    ['a', 'c', 'q'],
  ].map((args) => problemCodeDraftKey(...args));
  keys.forEach((key, i) => saveProblemCodeDraft(store, key, String(i)));
  assert.deepEqual(
    keys.map((key) => readProblemCodeDraft(store, key)),
    ['0', '1', '2', '3'],
  );
});
test('invalid drafts fall back and storage failures remain observable', () => {
  const store = storage();
  for (const value of ['{', 'null', '{"code":3}']) {
    store.setItem('key', value);
    assert.equal(readProblemCodeDraft(store, 'key'), null);
  }
  assert.throws(
    () =>
      saveProblemCodeDraft(
        {
          setItem() {
            throw new Error('full');
          },
        },
        'key',
        'code',
      ),
    /full/,
  );
});
