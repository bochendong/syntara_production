import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createJiti } from 'jiti';
const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
function load(path, mocks) {
  const source = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)(
    (id) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith('.') || id.startsWith('@/')) throw new Error(`Unmocked ${id}`);
      return require(id);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}
function dashboardFixture(multipart = false) {
  const ordinary = [
    {
      id: 'view-only',
      userId: 'reader',
      status: 'pending',
      score: null,
      resultJson: { event: 'solution_viewed' },
    },
    { id: 'wrong', userId: 'solver', status: 'failed', score: 0, resultJson: {} },
    {
      id: 'view',
      userId: 'solver',
      status: 'pending',
      score: null,
      resultJson: { event: 'solution_viewed' },
    },
    { id: 'right', userId: 'solver', status: 'passed', score: 100, resultJson: {} },
    {
      id: 'reset',
      userId: 'solver',
      status: 'pending',
      score: null,
      resultJson: { event: 'answer_reset' },
    },
    {
      id: 'hidden',
      userId: 'hidden-only',
      status: 'pending',
      score: null,
      resultJson: { event: 'hidden_tests_viewed' },
    },
  ];
  const parts = [
    {
      id: 'clean-a',
      userId: 'reader',
      status: 'partial',
      score: 50,
      resultJson: { parts: [{ status: 'passed' }, { status: 'pending' }] },
    },
    { id: 'clean-b', userId: 'reader', status: 'passed', score: 100, resultJson: {} },
    {
      id: 'wrong-a',
      userId: 'solver',
      status: 'partial',
      score: 0,
      resultJson: { parts: [{ status: 'failed' }, { status: 'pending' }] },
    },
    { id: 'fixed-a', userId: 'solver', status: 'passed', score: 100, resultJson: {} },
  ];
  const entries = (multipart ? parts : ordinary).map((entry, i) => ({
    ...entry,
    kind: 'answer',
    problemId: 'p',
    createdAt: new Date(i + 1),
  }));
  const db = {
    course: { findFirst: async () => null },
    courseClass: {
      findUnique: async () => ({
        id: 'class',
        teacherId: 'teacher',
        courseId: 'course',
        academicTerm: 'fall',
      }),
    },
    classSession: {
      findMany: async () => [],
      aggregate: async () => ({ _max: { number: null } }),
      findUnique: async () => ({
        id: 'lesson',
        classId: 'class',
        number: 1,
        status: 'live',
        class: { id: 'class', teacherId: 'teacher', courseId: 'course', course: { id: 'course' } },
      }),
    },
    classSessionParticipant: {
      findMany: async () =>
        ['reader', 'solver', 'hidden-only'].map((id) => ({
          user: { id, name: id },
          via: 'code',
          joinedAt: new Date(1),
        })),
    },
    courseClassMember: {
      findMany: async ({ orderBy }) =>
        orderBy && multipart
          ? ['reader', 'solver'].map((id) => ({ user: { id, name: id }, joinedAt: new Date(1) }))
          : [],
    },
    notebookProblemProgress: {
      findMany: async () =>
        ['reader', 'solver'].map((userId) => ({
          problemId: 'p',
          userId,
          status: 'passed',
          attemptedCount: 2,
          score: 100,
        })),
    },
    notebookProblem: {
      findMany: async ({ where, select }) => {
        assert.equal(where.courseId, 'course');
        assert.equal(where.ownerId, null);
        if (where.status === 'published') return [{ id: 'p', type: 'multipart' }];
        assert.deepEqual(where.classSessionItems, { some: { sessionId: 'lesson' } });
        assert.equal(select.secret, undefined);
        return ['p', 'q']
          .filter((id) => where.id === undefined || where.id === id)
          .map((id) => ({
            id,
            courseId: 'course',
            title: id,
            publicContentJson: { stem: id },
            gradingJson: {},
            createdAt: new Date(1),
            updatedAt: new Date(1),
          }));
      },
    },
    classSessionItem: {
      findMany: async () => [
        {
          id: 'item',
          problemId: 'p',
          position: 0,
          pushedAt: new Date(1),
          problem: { title: 'Question', type: multipart ? 'multipart' : 'short_answer' },
        },
      ],
    },
    notebookProblemAttempt: {
      findMany: async ({ where }) => {
        if (where.status) {
          assert.deepEqual(where.status.in, ['failed', 'partial']);
          assert.deepEqual(where.userId.in, ['reader', 'solver']);
          assert.deepEqual(where.problemId.in, ['p']);
          return entries.filter((e) => e.status === 'failed' || e.status === 'partial');
        }
        assert.equal(where.classSessionId, 'lesson');
        assert.deepEqual(where.userId.in, ['reader', 'solver', 'hidden-only']);
        assert.deepEqual(where.problemId.in, ['p']);
        if (where.resultJson) {
          assert.deepEqual(where.resultJson, { path: ['event'], equals: 'solution_viewed' });
          return entries.filter((e) => e.resultJson.event === 'solution_viewed');
        }
        return entries;
      },
    },
  };
  const api = load('lib/server/teacher-classroom.ts', {
    '@/lib/problem-bank/attempt-mistake': load('lib/problem-bank/attempt-mistake.ts', {}),
    '@/lib/server/prisma': { prisma: db },
    '@/lib/server/generated-prisma': { Prisma: {} },
    '@/lib/server/external-course-access': {},
    '@/lib/server/speedup-phone': { speedupOrganizationWhere: () => ({}) },
    './teacher-classroom-period': {},
    './course-admissions': {},
  });
  return api;
}
test('a view-only student is marked; viewing then passing keeps the flag without inflating submissions', async () => {
  const api = dashboardFixture();
  const dashboard = await api.getClassSessionDashboard({ userId: 'teacher' }, 'lesson');
  const item = dashboard.items[0];
  assert.deepEqual(item.solutionViewedUserIds, ['reader', 'solver']);
  assert.equal(item.submittedCount, 1);
  assert.equal(item.passedCount, 1);
  assert.equal(item.partialCount, 0);
  assert.equal(item.results[0].userId, 'solver');
  assert.equal(item.results[0].attempts, 2);
  assert.equal(item.results[0].score, 100);
  await assert.rejects(
    api.getClassSessionDashboard({ userId: 'other-teacher' }, 'lesson'),
    /没有找到/,
  );
});
test('correct multipart steps do not register as past mistakes on the teacher dashboard', async () => {
  const api = dashboardFixture(true);
  const dashboard = await api.getClassSessionDashboard({ userId: 'teacher' }, 'lesson');
  const results = dashboard.items[0].results;
  assert.equal(dashboard.items[0].passedCount, 2);
  const overview = await api.getClassOverview({ userId: 'teacher' }, 'class');
  assert.deepEqual(
    overview.progress.map(({ userId, hasIncorrectAttempt }) => ({ userId, hasIncorrectAttempt })),
    [
      { userId: 'reader', hasIncorrectAttempt: false },
      { userId: 'solver', hasIncorrectAttempt: true },
    ],
  );
  assert.deepEqual(
    results.map(({ userId, attempts, status, hasIncorrectAttempt }) => ({
      userId,
      attempts,
      status,
      hasIncorrectAttempt,
    })),
    [
      { userId: 'reader', attempts: 2, status: 'passed', hasIncorrectAttempt: false },
      { userId: 'solver', attempts: 2, status: 'passed', hasIncorrectAttempt: true },
    ],
  );
});

test('teacher can load the whole lesson and only its public problems for practice', async () => {
  const api = dashboardFixture();
  const teacher = { userId: 'teacher' };
  const problems = await api.getClassSessionProblemPreviews(teacher, 'lesson');
  assert.deepEqual(
    problems.map((problem) => problem.id),
    ['p', 'q'],
  );
  assert.equal((await api.getClassSessionProblemPreview(teacher, 'lesson', 'q')).id, 'q');
  await assert.rejects(
    api.getClassSessionProblemPreview(teacher, 'lesson', 'elsewhere'),
    /没有找到/,
  );
  await assert.rejects(
    api.getClassSessionProblemPreviews({ userId: 'student' }, 'lesson'),
    /没有找到/,
  );
});
test('blue overrides answer colors, while unseen answers keep existing colors', () => {
  const ui = load('apps/native/src/components/teach-shared.tsx', {
    '../lib/learning-action-marbles': {
      marbleImages: {
        blue: 'blue',
        green: 'green',
        purple: 'purple',
        amber: 'amber',
        pink: 'pink',
      },
    },
  });
  assert.equal(ui.teachResultStatus('none', 0, true).marble, 'blue');
  assert.equal(ui.teachResultStatus('passed', 2, true).marble, 'blue');
  assert.match(ui.teachResultStatus('passed', 2, true).label, /已看答案.*已答对/);
  assert.equal(ui.teachResultStatus('passed', 1).marble, 'green');
  assert.equal(ui.teachResultStatus('passed', 2).marble, 'purple');
  assert.equal(ui.teachResultStatus('passed', 3, false, false).marble, 'green');
  assert.equal(ui.teachResultStatus('passed', 3, false, true).marble, 'purple');
  assert.equal(ui.teachResultStatus('partial', 3, false, true).marble, 'amber');
  assert.equal(ui.teachResultStatus('passed', 3, true, true).marble, 'blue');
});
test('downloaded learning snapshots never count as classroom submissions', async () => {
  const { classroomProblemDocument } = await jiti.import(
    '../../apps/native/src/data/classroom-practice-scope.ts',
  );
  const attempts = [
    {
      id: 'view',
      kind: 'submit',
      status: 'pending',
      result: { classSessionId: 'lesson', event: 'solution_viewed' },
    },
    {
      id: 'right',
      kind: 'submit',
      status: 'passed',
      score: 1,
      result: { classSessionId: 'lesson' },
    },
  ];
  const doc = classroomProblemDocument(
    { problem: { id: 'p' }, attempts, progress: null },
    'lesson',
  );
  assert.equal(doc.attempts.length, 2);
  assert.equal(doc.progress.attemptedCount, 1);
  assert.equal(doc.progress.status, 'passed');
  assert.equal(
    classroomProblemDocument(
      { problem: { id: 'p' }, attempts: [attempts[0]], progress: null },
      'lesson',
    ).progress,
    null,
  );
});

test('offline answer-view uploads retain the lesson when retried from saved metadata', async () => {
  const storage = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
    },
  };
  const batches = [];
  const sync = load('apps/native/src/data/problem-sync.ts', {
    '../../../../lib/problem-bank/photo-answer': {},
    './browser-runtime': { accountStorageKey: (key) => key },
    './problem-bank-round': { bankResetTimes: () => ({}) },
    './archive': {},
    './chat-sync': { isPlatformCourse: async () => true },
    './platform-api-client': {
      uploadNativeProblemAttempts: async ({ attempts }) => {
        batches.push(attempts);
        return batches.length === 1
          ? { saved: [], skipped: [] }
          : { saved: attempts.map((a) => a.id), skipped: [] };
      },
    },
    '../lib/course-layers': {},
    '../lib/single-flight': {},
  });
  const attempt = {
    id: 'solution-view-123',
    problemId: 'p',
    kind: 'solution_viewed',
    status: 'pending',
    score: null,
    answer: { kind: 'text', text: 'draft' },
    result: { event: 'solution_viewed', classSessionId: 'lesson' },
    createdAt: 1,
  };
  try {
    await sync.queueProblemAttempt({}, 'course', attempt);
    assert.equal(JSON.parse([...storage.values()][0]).course[0].classSessionId, 'lesson');
    await sync.queueProblemAttempt({}, 'course', { ...attempt, id: 'solution-view-456' });
    assert.equal(batches[1].length, 2);
    assert.ok(
      batches[1].every(
        (entry) => entry.classSessionId === 'lesson' && entry.event === 'solution_viewed',
      ),
    );
    assert.deepEqual(JSON.parse([...storage.values()][0]), {});
  } finally {
    globalThis.window = previousWindow;
  }
});
