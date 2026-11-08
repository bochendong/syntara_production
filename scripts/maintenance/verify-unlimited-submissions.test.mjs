import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createJiti } from 'jiti';
const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
const scoring = await jiti.import('../../lib/problem-bank/scoring-policy.ts');
const schema = await jiti.import('../../lib/problem-bank/schema.ts');
const scope = await jiti.import('../../apps/native/src/data/classroom-practice-scope.ts');
const { NextRequest, NextResponse } = require('next/server');

function routeHarness(surface, type, previousCount, score) {
  const saved = [];
  const grade = async () => ({
    status: 'passed',
    score,
    answer: {},
    result: { publicCases: [], feedback: 'Graded answer.' },
  });
  const load = async () => ({
    problem: { type, publicContent: { type, publicTests: [], parts: [] }, points: 100 },
  });
  const mocks = {
    'next/server': { NextResponse },
    '@/features/problems': schema,
    '@/lib/server/api-auth': { requireUserId: async () => ({ userId: 'learner' }) },
    '@/lib/server/json-error-response': { safeRoute: (run) => run() },
    '@/lib/server/request-context': { runWithRequestContext: (_req, _label, run) => run() },
    '@/lib/server/resolve-model': { resolveModelFromHeaders: async () => ({ model: {} }) },
    '@/lib/server/notebook-problems/course-identity': {
      resolveNotebookProblemCourseIdentity: async () => ({}),
    },
    '@/lib/problem-bank/scoring-policy': scoring,
    '@/lib/problem-bank/photo-answer': { isValidPhotoAnswerUpload: () => true },
    '@/features/problems/server/evaluate': {
      evaluateNotebookNonCodeProblem: grade,
      evaluateNotebookMultipartProblem: grade,
    },
    '@/features/problems/server/judge': { judgeNotebookCodeProblem: grade },
    '@/features/problems/server/service': {
      countNotebookProblemSubmissions: async () => previousCount,
      getLatestNotebookProblemSubmission: async () => null,
      getCourseProblemForUser: load,
      getNotebookProblemForUser: load,
      createNotebookProblemAttempt: async (attempt) => {
        saved.push(attempt);
        return attempt;
      },
    },
    '@/lib/problem-bank/teacher-preview-attempt': {},
  };
  const source = ts.transpileModule(
    readFileSync(`app/api/${surface}/[id]/problems/[problemId]/attempts/submit/route.ts`, 'utf8'),
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)(
    (id) => mocks[id] ?? require(id),
    mod,
    mod.exports,
  );
  return {
    saved,
    send: () =>
      mod.exports.POST(
        new NextRequest('https://test.invalid/submit', {
          method: 'POST',
          body: JSON.stringify({ text: 'answer', code: 'pass' }),
        }),
        { params: Promise.resolve({ id: 'course', problemId: 'problem' }) },
      ),
  };
}

for (const surface of ['courses', 'notebooks']) {
  test(`${surface}: all question types accept later attempts without score penalties`, async () => {
    for (const type of [
      'choice',
      'fill_blank',
      'calculation',
      'code',
      'short_answer',
      'proof',
      'table',
      'multipart',
    ]) {
      for (const previous of [1, 2, 3, 99]) {
        const h = routeHarness(surface, type, previous, 83);
        const response = await h.send();
        assert.equal(response.status, 200, `${type}, previous=${previous}`);
        const body = await response.json();
        assert.equal(h.saved[0].score, 83);
        assert.equal(h.saved[0].result.earnedPoints, 83);
        assert.equal(h.saved[0].result.feedback, 'Graded answer.');
        if (type !== 'multipart') assert.equal(body.remainingSubmissions, null);
      }
    }
  });
}

test('new classroom starts unanswered; re-entry restores only this session without destroying history', () => {
  const attempt = (id, session, status) => ({
    id,
    problemId: 'p',
    kind: 'submit',
    status,
    score: 1,
    answer: { text: id },
    result: { classSessionId: session },
    createdAt: Number(id),
    updatedAt: Number(id),
  });
  const original = {
    problem: { id: 'p' },
    progress: { status: 'passed' },
    attempts: [
      attempt('4', 'old', 'passed'),
      attempt('3', null, 'passed'),
      attempt('2', 'current', 'passed'),
      attempt('1', 'current', 'failed'),
    ],
  };
  const copy = structuredClone(original);
  const fresh = scope.classroomProblemDocument(original, 'new');
  assert.deepEqual(fresh.attempts, []);
  assert.equal(fresh.progress, null);
  const current = scope.classroomProblemDocument(original, 'current');
  assert.deepEqual(
    current.attempts.map((a) => a.id),
    ['2', '1'],
  );
  assert.equal(current.progress.attemptedCount, 2);
  assert.equal(current.progress.status, 'passed');
  assert.equal(current.progress.hasIncorrectAttempt, true);
  assert.deepEqual(original, copy);
  assert.equal(scope.classroomProblemDocument(original), original);
  assert.equal(scope.classroomDraftAccount('account'), 'account');
  assert.notEqual(
    scope.classroomDraftAccount('account', 'old'),
    scope.classroomDraftAccount('account', 'new'),
  );
  assert.notEqual(
    scope.classroomDraftAccount('account', 'new'),
    scope.classroomDraftAccount('other-account', 'new'),
  );
});

test('teacher practice is window-scoped and snapshots never change graded progress', async () => {
  const { createTeacherPracticeStore } = await jiti.import(
    '../../apps/native/src/data/teacher-practice-store.ts',
  );
  const { saveProblemLearningSnapshot } = await jiti.import(
    '../../apps/native/src/data/problem-learning-snapshot.ts',
  );
  const problem = {
    id: 'teacher-demo',
    title: 'Demo',
    tags: [],
    publicContent: {},
    courseId: 'course',
  };
  const submissions = [];
  const store = createTeacherPracticeStore([problem], (progress) => submissions.push(progress));
  const nextWindow = createTeacherPracticeStore([problem]);
  for (let i = 1; i <= 5; i++) {
    const saved = await store.saveProblemAttempt({
      problemId: problem.id,
      answer: { kind: 'choice', selectedOptionIds: ['A'] },
      status: 'passed',
      score: 1,
    });
    assert.equal(saved.progress.attemptedCount, i);
    assert.equal(saved.progress.score, 1);
  }
  const before = await store.loadProblemDocument(problem.id);
  store.addProblems([
    { ...problem, title: 'Updated' },
    { ...problem, id: 'second-question' },
  ]);
  assert.deepEqual(store.listProblemProgress(), [before.progress]);
  assert.equal((await store.loadProblemDocument(problem.id)).problem.title, 'Updated');
  assert.equal((await store.loadProblemDocument('second-question')).progress, null);
  const snapshot = await saveProblemLearningSnapshot(store, {
    problem,
    answer: { kind: 'choice', selectedOptionIds: ['A'] },
    event: 'solution_viewed',
    progress: before.progress,
    at: Date.now(),
    id: 'snapshot',
  });
  assert.deepEqual(snapshot.document.progress, before.progress);
  assert.equal(snapshot.document.attempts.length, 6);
  assert.equal(submissions.length, 5);
  snapshot.document.attempts.length = 0;
  assert.equal((await store.loadProblemDocument(problem.id)).attempts.length, 6);
  assert.equal((await nextWindow.loadProblemDocument(problem.id)).attempts.length, 0);
  assert.equal((await nextWindow.loadProblemDocument(problem.id)).progress, null);
});

test('server classroom history is scoped to the authenticated learner, question and class', async () => {
  const synced = await jiti.import('../../lib/problem-bank/synced-attempt.ts');
  const source = ts.transpileModule(
    readFileSync('lib/server/native-problem-attempt-history.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const mod = { exports: {} };
  const mocks = {
    './native-problem-sync': { visibleProblemWhere: async () => ({ courseId: 'course' }) },
    '@/lib/problem-bank/synced-attempt': synced,
  };
  new Function('require', 'module', 'exports', source)(
    (id) => mocks[id] ?? require(id),
    mod,
    mod.exports,
  );
  let query;
  const db = {
    notebookProblem: { findFirst: async () => ({ id: 'problem', points: 100 }) },
    notebookProblemAttempt: {
      findMany: async (args) => {
        query = args;
        return [
          {
            id: 'attempt',
            kind: 'submit',
            classSessionId: 'class-A',
            score: 100,
            status: 'passed',
            createdAt: new Date(1000),
            updatedAt: new Date(1000),
            answerJson: { text: 'answer' },
            resultJson: {},
          },
        ];
      },
    },
  };
  const result = await mod.exports.readNativeProblemAttempts(
    db,
    'learner',
    'course',
    'problem',
    null,
    'class-A',
  );
  assert.deepEqual(query.where, {
    userId: 'learner',
    problemId: 'problem',
    kind: { in: ['answer', 'submit'] },
    classSessionId: 'class-A',
  });
  assert.equal(result.attempts[0].result.classSessionId, 'class-A');
  assert.equal(result.attempts[0].score, 1);
});
