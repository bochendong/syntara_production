import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { sortMistakes, mistakeSnippet } = jiti('../../apps/native/src/data/mistake-book.ts');

const problem = (id, extra = {}) => ({
  id,
  title: id,
  type: 'choice',
  publicContent: { options: [{ id: 'x' }, { id: 'y' }, { id: 'z' }] },
  grading: { correctOptionIds: ['z'] },
  ...extra,
});
const row = (problemId, status, lastAttemptAt, attemptedCount = 2, passedCount = 0) => ({
  problemId,
  status,
  lastAttemptAt,
  attemptedCount,
  passedCount,
});

test('mistakes stay after a correct redo and leave only when the student removes them', () => {
  const problems = [
    problem('wrong'),
    problem('fixed'),
    problem('removed'),
    problem('back'),
    problem('never'),
  ];
  const records = new Map(
    [
      row('wrong', 'failed', 10),
      row('fixed', 'passed', 20, 2, 1),
      row('removed', 'passed', 30, 2, 1),
      row('back', 'failed', 50, 3, 1),
      row('never', 'passed', 5, 1, 1),
    ].map((r) => [r.problemId, r]),
  );
  const mistakes = new Set(['wrong', 'fixed', 'removed', 'back']);
  const removed = { removed: 40, back: 40 };
  const tabs = Object.fromEntries(
    sortMistakes(problems, mistakes, records, removed).map((e) => [e.problem.id, e.tab]),
  );
  assert.deepEqual(tabs, { wrong: 'todo', fixed: 'fixed', removed: 'removed', back: 'todo' });
});

test('a currently failed problem counts even before its attempt history loads', () => {
  const entries = sortMistakes(
    [problem('p')],
    new Set(),
    new Map([['p', row('p', 'partial', 1, 1)]]),
    {},
  );
  assert.equal(entries[0].tab, 'todo');
});

test('snippets show the chosen and correct option letters and failing tests', () => {
  assert.deepEqual(
    mistakeSnippet(problem('c'), { answer: { selectedOptionIds: ['y'] }, result: null }),
    {
      mine: '你选了 B',
      detail: '正确 C',
    },
  );
  const code = mistakeSnippet(problem('k', { type: 'code' }), {
    answer: { code: 'x' },
    result: {
      publicSummary: { passed: 3, total: 5 },
      caseResults: [
        { id: '1', description: '空字符串', passed: false },
        { id: '2', description: '普通', passed: true },
      ],
    },
  });
  assert.deepEqual(code, { mine: '没过：空字符串', detail: '3/5 测试通过' });
});
