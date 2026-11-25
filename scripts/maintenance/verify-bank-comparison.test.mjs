import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
const { readBankComparison } = jiti('../../lib/server/native-bank-comparison.ts');

test('store-term comparison counts eligible enrollments and scopes peer metrics to the selected group', async () => {
  const problems = [
    { id: 'shared', tags: ['UTM 2023 Final · Q1', 'TT2 模考 A · Q2'] },
    { id: 'mock', tags: ['TT2 模考 A · Q1'] },
    { id: 'practice', tags: [] },
  ].map((p) => ({ ...p, chapter: { name: '循环' } }));
  const firsts = [
    { userId: 'me', problemId: 'shared', status: 'passed' },
    { userId: 'other', problemId: 'shared', status: 'partial' },
    { userId: 'other', problemId: 'mock', status: 'pending' },
  ];
  let ownerId = 'me';
  const db = {
    course: {
      findUnique: async () => ({
        ownerId,
        managers: [{ userId: 'me' }],
        name: 'UTSG-CSC108Y',
        courseCode: 'CSC108Y',
      }),
    },
    notebook: { findMany: async () => [] },
    courseEnrollment: {
      findMany: async ({ where }) => {
        assert.equal(where.courseId, 'course');
        assert.deepEqual(where.source.in, ['store', 'approval']);
        assert.deepEqual(where.joinedAt, { gte: new Date(2026, 8, 1), lt: new Date(2027, 0, 1) });
        return [{ userId: 'me' }, { userId: 'other' }, { userId: 'new' }];
      },
    },
    notebookProblem: {
      findMany: async ({ where }) => {
        assert.ok(where.AND);
        assert.equal(where.ownerId, null);
        assert.equal(where.status, 'published');
        return problems;
      },
    },
    $queryRaw: async (sql, users, ids) => {
      assert.match(sql.join('?'), /DISTINCT ON/);
      return firsts.filter((r) => users.includes(r.userId) && ids.includes(r.problemId));
    },
  };
  const compare = (group) => readBankComparison(db, 'me', 'course', group, new Date(2026, 10, 25));
  const mock = await compare('mock');
  assert.equal(mock.termLabel, '2026 秋季');
  assert.equal(mock.scope, 'store-term');
  assert.equal(mock.enrollmentCount, 2); // Course owner is viewing, outside the enrolled cohort.
  assert.equal(mock.peerCount, 2);
  assert.deepEqual(mock.coverage, { me: 0.5, median: 0.5, lower: 0.25, upper: 0.75 });
  assert.deepEqual(mock.firstTry, { me: 1, median: 0, lower: 0, upper: 0 });
  assert.deepEqual(mock.topics, [{ name: '循环', firstTry: mock.firstTry }]);
  const exam = await compare('exam');
  assert.equal(exam.coverage.me, 1);
  const chapters = await compare('chapters');
  assert.equal(chapters.coverage.me, 1 / 3);
  ownerId = 'owner';
  const enrolledViewer = await compare('mock');
  assert.equal(enrolledViewer.enrollmentCount, 3);
  assert.equal(enrolledViewer.peerCount, 2);
  assert.deepEqual(enrolledViewer.coverage, mock.coverage);
});

test('store enrollment windows roll over at the same boundaries as the student roster', () => {
  const { currentStoreEnrollmentWindow, storeEnrollmentTerm } = jiti(
    '../../lib/server/store-enrollment-term.ts',
  );
  for (const [month, title] of [
    [0, '冬季'],
    [4, '夏季'],
    [8, '秋季'],
  ]) {
    const start = new Date(2026, month, 1);
    const end = new Date(2026, month + 4, 1);
    const window = { start, end, label: '2026 ' + title };
    assert.deepEqual(currentStoreEnrollmentWindow(start), window);
    assert.deepEqual(currentStoreEnrollmentWindow(new Date(end.getTime() - 1)), window);
    assert.equal(storeEnrollmentTerm(start).label, window.label);
    assert.notEqual(storeEnrollmentTerm(end).label, window.label);
  }
});
