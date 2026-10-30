import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { practiceLaunchForResults, adjacentPracticeProblem } = jiti(
  '../../apps/native/src/data/problem-practice-scope.ts',
);
const { matchesProblemFilters } = jiti('../../apps/native/src/data/problem-bank-filters.ts');
const rows = [
  {
    id: 'function-a1',
    chapterId: 'functions',
    difficulty: 'medium',
    type: 'choice',
    tags: ['TT1模拟A卷'],
  },
  {
    id: 'function-b',
    chapterId: 'functions',
    difficulty: 'medium',
    type: 'choice',
    tags: ['TT1模拟B卷'],
  },
  {
    id: 'function-a2',
    chapterId: 'functions',
    difficulty: 'hard',
    type: 'proof',
    tags: ['TT1模拟A卷'],
  },
  {
    id: 'relation-a1',
    chapterId: 'relations',
    difficulty: 'medium',
    type: 'choice',
    tags: ['TT1模拟A卷'],
  },
  {
    id: 'relation-a2',
    chapterId: 'relations',
    difficulty: 'hard',
    type: 'proof',
    tags: ['TT1模拟A卷'],
  },
].map((row) => ({ title: row.id, publicContent: {}, ...row }));
const base = { query: '', chapter: 'all', difficulty: 'all', type: 'all', series: '' };

test('series launch captures the visible sequence across chapters and excludes other series', () => {
  const visible = rows.filter((row) =>
    matchesProblemFilters(row, { ...base, series: 'TT1模拟A卷' }),
  );
  const launch = practiceLaunchForResults(visible, 'function-a2', 'TT1模拟A卷');
  assert.deepEqual(launch.problemIds, ['function-a1', 'function-a2', 'relation-a1', 'relation-a2']);
  assert.deepEqual(launch.numbers, {
    'function-a1': 1,
    'function-a2': 2,
    'relation-a1': 3,
    'relation-a2': 4,
  });
  assert.equal(launch.title, 'TT1模拟A卷');
  assert.equal(launch.initialProblemId, 'function-a2');
  assert.equal(adjacentPracticeProblem(launch.problemIds, 'function-a2', 1), 'relation-a1');
  visible.reverse();
  assert.equal(launch.problemIds[0], 'function-a1');
});

test('difficulty, type, chapter and series intersections define the entire practice scope', () => {
  for (const filters of [
    { difficulty: 'medium' },
    { difficulty: 'hard' },
    { type: 'proof' },
    { series: 'TT1模拟A卷', difficulty: 'medium', type: 'choice' },
    { chapter: 'relations', series: 'TT1模拟A卷', difficulty: 'hard', type: 'proof' },
  ]) {
    const visible = rows.filter((row) => matchesProblemFilters(row, { ...base, ...filters }));
    const launch = practiceLaunchForResults(visible, visible[0]?.id, '筛选结果');
    assert.deepEqual(
      launch.problemIds,
      visible.map((row) => row.id),
    );
    for (let i = 0; i < visible.length; i++) {
      assert.equal(
        adjacentPracticeProblem(launch.problemIds, visible[i].id, 1),
        visible[i + 1]?.id ?? null,
      );
      assert.equal(
        adjacentPracticeProblem(launch.problemIds, visible[i].id, -1),
        visible[i - 1]?.id ?? null,
      );
    }
  }
});

test('next never skips a completed question, wraps at the end or expands an unknown scope', () => {
  const ids = ['first', 'already-passed', 'third'];
  assert.equal(adjacentPracticeProblem(ids, 'first', 1), 'already-passed');
  assert.equal(adjacentPracticeProblem(ids, 'third', 1), null);
  assert.equal(adjacentPracticeProblem(ids, 'first', -1), null);
  assert.equal(adjacentPracticeProblem(ids, 'not-in-scope', 1), null);
  assert.equal(practiceLaunchForResults([], undefined, 'empty'), null);
  assert.equal(
    practiceLaunchForResults([{ id: 'first' }], 'absent', 'one').initialProblemId,
    'first',
  );
});
