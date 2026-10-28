import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';
import { createJiti } from 'jiti';
const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('.') } });
const schemas = await jiti.import('../../lib/problem-bank/schema.ts');
function load(file, mocks = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith('@/') || id.startsWith('./') || id.startsWith('../')) return {};
      return require(id);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}
const codeSlots = await jiti.import('../../lib/problem-bank/code-slots.ts');
const grading = load('apps/native/src/data/local-problem-grading.ts', {
  '../../../../lib/problem-bank/code-slots': codeSlots,
});
const { problemSolution } = load('apps/native/src/lib/problem-solution.ts', {
  '../data/local-problem-grading': grading,
});
const learning = load('apps/native/src/data/problem-learning-snapshot.ts');
const drafts = load('apps/native/src/data/problem-code-draft.ts');
const base = {
  id: 'p',
  courseId: 'course',
  notebookId: null,
  chapterName: 'Sets',
  title: 'Set question',
  tags: ['sets'],
  publicContent: {
    type: 'choice',
    stem: 'Which set?',
    options: [
      { id: 'A', label: 'One' },
      { id: 'B', label: 'Two' },
    ],
  },
};
const cases = [
  { ...base, type: 'choice', grading: { correctOptionIds: ['B'], analysis: 'Because two.' } },
  { ...base, type: 'proof', grading: { referenceProof: 'Let x belong to A.' } },
  { ...base, type: 'short_answer', grading: { referenceAnswer: 'A concise answer.' } },
  { ...base, type: 'calculation', grading: { acceptedForms: ['42', 'forty-two'] } },
  {
    ...base,
    type: 'fill_blank',
    grading: { blanks: [{ id: 'b1', acceptedAnswers: ['set', '集合'] }] },
  },
  {
    ...base,
    type: 'code',
    publicContent: { type: 'code', stem: 'Implement', starterCode: 'def f():\n    pass' },
    grading: { solutionCode: 'def f():\n    return 42' },
  },
];
test('all six question types expose the stored answer and reset to their correct initial input', () => {
  for (const p of cases) {
    const solution = problemSolution(p);
    assert(solution.answer || solution.code);
    const empty = grading.emptyAnswerForProblem(p);
    assert.equal(
      empty.kind,
      p.type === 'code'
        ? 'code'
        : p.type === 'choice'
          ? 'choice'
          : p.type === 'fill_blank'
            ? 'blanks'
            : 'text',
    );
  }
  assert.match(problemSolution(cases[0]).answer, /B.*Two/);
  assert.match(
    problemSolution({
      ...base,
      type: 'table',
      grading: { cells: [{ rowId: 'r1', colId: 'out', acceptedAnswers: ['5'] }] },
    }).answer,
    /r1.*out.*5/,
  );
  assert.equal(problemSolution(cases[5]).code, 'def f():\n    return 42');
  assert.equal(
    problemSolution({
      ...cases[5],
      grading: { ...cases[5].grading, referenceAnswer: cases[5].grading.solutionCode },
    }).answer,
    '',
  );
  assert.equal(
    grading.problemStem({ ...cases[4], publicContent: { stemTemplate: 'Fill {{b1}}.' } }),
    'Fill {{b1}}.',
  );
  assert.equal(problemSolution({ ...base, type: 'proof', grading: {} }).answer, '');
});
test('reveal snapshots save the original work and an AI help memory; reset snapshots preserve assessed progress', async () => {
  const progress = {
    id: 'progress',
    problemId: 'p',
    status: 'passed',
    score: 1,
    attemptedCount: 4,
    passedCount: 2,
    latestAttemptId: 'graded',
  };
  for (const p of cases) {
    const answer =
      p.type === 'choice'
        ? { kind: 'choice', selectedOptionIds: ['A'] }
        : p.type === 'code'
          ? { kind: 'code', code: 'my_work' }
          : { kind: 'text', text: 'my reasoning', images: [] };
    const snapshot = learning.problemLearningArchive({
      problem: p,
      answer,
      progress,
      event: 'solution_viewed',
      at: 100,
      id: 'snapshot',
    });
    assert.deepEqual(snapshot.archive.problemProgress, []);
    assert.deepEqual(snapshot.attempt.answer, answer);
    assert.deepEqual(snapshot.attempt.result.progressSnapshot, {
      status: 'passed',
      score: 1,
      attemptedCount: 4,
    });
    assert.equal(snapshot.attempt.score, null);
    assert.equal(snapshot.archive.studyMemories[0].kind, 'solution_help');
    assert.equal(snapshot.archive.studyMemories[0].notebookId, null);
    assert.match(snapshot.archive.studyMemories[0].text, /查看了参考答案/);
    const reset = learning.problemLearningArchive({
      problem: p,
      answer: grading.emptyAnswerForProblem(p),
      progress,
      event: 'answer_reset',
      at: 200,
      id: 'reset',
    });
    assert.deepEqual(reset.archive.studyMemories, []);
    assert.deepEqual(reset.archive.problemProgress, []);
    assert.equal(progress.attemptedCount, 4);
  }
  let loaded = false;
  await assert.rejects(
    () =>
      learning.saveProblemLearningSnapshot(
        {
          importArchive: async () => {
            throw new Error('disk full');
          },
          loadProblemDocument: async () => {
            loaded = true;
          },
        },
        {
          problem: cases[0],
          answer: { kind: 'choice', selectedOptionIds: [] },
          progress,
          event: 'solution_viewed',
          at: 100,
          id: 'failed',
        },
      ),
    /disk full/,
  );
  assert.equal(loaded, false);
});

test('viewing hidden tests records a separate help snapshot without changing progress', () => {
  const answer = { kind: 'code', code: 'my_work' };
  const snapshot = learning.problemLearningArchive({
    problem: { ...base, type: 'code' },
    answer,
    progress: { status: 'passed', score: 1, attemptedCount: 4 },
    event: 'hidden_tests_viewed',
    at: 100,
    id: 'hidden-snapshot',
  });
  assert.deepEqual(snapshot.attempt.answer, answer);
  assert.equal(snapshot.attempt.result.event, 'hidden_tests_viewed');
  assert.equal(snapshot.attempt.score, null);
  assert.deepEqual(snapshot.archive.problemProgress, []);
  assert.match(snapshot.archive.studyMemories[0].text, /隐藏测试/);
  assert.equal(snapshot.archive.studyMemories[0].source, 'problem-hidden-tests-view');
});

test('hidden test endpoint checks access and only returns structured cases', async () => {
  class Response {}
  let allowed = false;
  let reads = 0;
  let mode = 'code';
  let runPayload;
  const route = load('app/api/native/v1/hidden-tests/route.ts', {
    'next/server': { NextResponse: Response },
    '@/features/problems/server/service': {
      getCourseProblemForUser: async (user, course, problem, options) => {
        reads++;
        assert.deepEqual([user, course, problem], ['user', 'course', 'problem']);
        assert.equal(options.includeSecretJudgeForEvaluation, true);
        if (mode === 'denied') throw new Error('No course access');
        if (mode === 'multipart')
          return {
            problem: {
              type: 'multipart',
              publicContent: {
                type: 'multipart',
                parts: [{ label: 'a', content: { type: 'code' } }],
              },
            },
            secretJudge: {
              parts: { a: { secretTests: [{ id: 'part', expression: 'g(2)', expected: '4' }] } },
            },
          };
        return {
          problem: { type: 'code', publicContent: { type: 'code' } },
          secretJudge: {
            secretTests: [
              {
                id: 'private-id',
                expression: 'f(3)',
                expected: '9',
                description: 'private description',
              },
            ],
            secretTestCode: 'private test script',
            supportCode: 'private helper',
            files: [{ path: 'private.txt', content: 'secret file' }],
          },
        };
      },
    },
    '@/lib/problem-bank/schema': schemas,
    '@/features/problems/server/judge': {
      judgeNotebookCodeProblem: async (args) => {
        runPayload = args;
        return {
          status: 'passed',
          result: {
            caseResults: [{ id: 'hidden-0', passed: true, actual: 'private output' }],
            feedback: 'private feedback',
          },
        };
      },
    },
    '@/lib/problem-bank/scoring-policy': { STANDARD_PROBLEM_POINTS: 100 },
    '@/lib/server/notebook-problems/course-identity': {
      resolveNotebookProblemCourseIdentity: async () => null,
    },
    '@/lib/server/prisma-safe': { getOptionalPrisma: () => ({}) },
    '@/lib/server/public-api': {
      publicApiRequestId: () => 'request',
      requireNativePlatformApi: async () => (allowed ? { userId: 'user' } : new Response()),
      publicApiError: (_id, status, code) => ({ status, code }),
      publicApiSuccess: (_id, data, options) => ({ data, options }),
    },
  });
  const request = { json: async () => ({ courseId: 'course', problemId: 'problem' }) };
  assert.ok((await route.POST(request)) instanceof Response);
  assert.equal(reads, 0);
  allowed = true;
  const result = await route.POST(request);
  assert.deepEqual(result.data, {
    cases: [{ expression: 'f(3)', expected: '9' }],
    hasScript: true,
  });
  assert.equal(result.options.headers['Cache-Control'], 'private, no-store');
  assert.equal(reads, 1);
  const runResult = await route.POST({
    json: async () => ({
      courseId: 'course',
      problemId: 'problem',
      mode: 'run',
      code: 'def f(x): return 9',
      indices: [0],
    }),
  });
  assert.deepEqual(runResult.data, {
    cases: [{ id: 'hidden-0', passed: true }],
    feedback: undefined,
  });
  assert.equal(runPayload.kind, 'run');
  assert.equal(runPayload.runTarget, 'secret');
  assert.equal(runPayload.secretJudge.secretTestCode, undefined);
  assert.equal(runPayload.secretJudge.supportCode, 'private helper');
  assert.equal(runPayload.secretJudge.secretTests[0].id, 'hidden-0');
  assert.equal(
    (
      await route.POST({
        json: async () => ({
          courseId: 'course',
          problemId: 'problem',
          mode: 'run',
          code: 'pass',
          indices: [1],
        }),
      })
    ).status,
    400,
  );
  mode = 'denied';
  assert.equal((await route.POST(request)).status, 404);
  mode = 'multipart';
  const partRequest = {
    json: async () => ({ courseId: 'course', problemId: 'problem', part: 'a' }),
  };
  assert.deepEqual((await route.POST(partRequest)).data, {
    cases: [{ expression: 'g(2)', expected: '4' }],
    hasScript: false,
  });
  assert.equal(
    (
      await route.POST({
        json: async () => ({ courseId: 'course', problemId: 'problem', part: 'b' }),
      })
    ).status,
    400,
  );
});
function database() {
  const state = {
    rows: [],
    progress: {
      latestAttemptId: 'old',
      status: 'passed',
      score: 100,
      attemptedCount: 4,
      passedCount: 2,
    },
    jobs: [],
  };
  const db = {
    $transaction: async (fn) => fn(db),
    notebookProblemAttempt: {
      create: async ({ data }) => {
        const row = {
          id: data.id ?? 'created',
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        state.rows.push(row);
        return row;
      },
      findMany: async ({ where }) =>
        state.rows.filter((r) => where.id.in.includes(r.id)).map((r) => ({ id: r.id })),
    },
    notebookProblemProgress: {
      upsert: async ({ update }) => {
        state.progress = {
          ...state.progress,
          ...update,
          attemptedCount: state.progress.attemptedCount + update.attemptedCount.increment,
          passedCount: state.progress.passedCount + (update.passedCount?.increment ?? 0),
        };
      },
    },
    notebookProblem: {
      findUnique: async () => ({ courseId: 'course', notebookId: null }),
      findMany: async ({ where }) => (where.id.in.includes('p') ? [{ id: 'p', points: 100 }] : []),
    },
  };
  return { db, state };
}
test('the real attempt persistence path leaves scores/counters untouched for snapshots and still updates them for graded submissions', async () => {
  const { db, state } = database();
  const service = load('lib/server/notebook-problems/service.ts', {
    '@/lib/server/prisma': { prisma: db },
    '@/lib/problem-bank': schemas,
    '@/lib/server/prisma-json': { toPrismaJson: (x) => x },
    '@/features/background-jobs/server/store': {
      enqueueJob: async (_tx, job) => state.jobs.push(job),
    },
  });
  const before = structuredClone(state.progress);
  for (const event of ['solution_viewed', 'hidden_tests_viewed', 'answer_reset'])
    await service.createNotebookProblemAttempt({
      userId: 'user',
      problemId: 'p',
      kind: 'answer',
      status: 'pending',
      answer: { text: 'draft before reveal' },
      result: { event, feedback: 'snapshot', publicCases: [] },
      preserveProgress: true,
    });
  assert.equal(state.rows.length, 3);
  assert.deepEqual(state.progress, before);
  assert.equal(state.jobs.length, 0);
  await service.createNotebookProblemAttempt({
    userId: 'user',
    problemId: 'p',
    kind: 'answer',
    status: 'passed',
    score: 100,
    answer: { selectedOptionIds: ['B'] },
    result: { correct: true, publicCases: [] },
  });
  assert.equal(state.progress.attemptedCount, 5);
  assert.equal(state.progress.passedCount, 3);
  assert.equal(state.jobs.length, 1);
});
test('submission limits exclude learning snapshots while retaining regular attempts', async () => {
  const service = load('lib/server/notebook-problems/service.ts', {
    '@/lib/server/prisma': {
      prisma: {
        notebookProblemAttempt: {
          findMany: async () => [
            { resultJson: null },
            { resultJson: { correct: false } },
            { resultJson: { event: 'solution_viewed' } },
            { resultJson: { event: 'hidden_tests_viewed' } },
            { resultJson: { event: 'answer_reset' } },
          ],
        },
      },
    },
    '@/lib/problem-bank': schemas,
    '@/lib/server/prisma-json': { toPrismaJson: (x) => x },
    '@/features/background-jobs/server/store': {},
  });
  assert.equal(
    await service.countNotebookProblemSubmissions({ userId: 'user', problemId: 'p' }),
    2,
  );
});
test('native upload preserves event identity, never grades a reveal, and safely replays or rejects inaccessible problems', async () => {
  const { db, state } = database();
  const captured = [];
  const native = load('lib/server/native-problem-sync.ts', {
    '@/lib/problem-bank/schema': schemas,
    '@/lib/problem-bank/photo-answer': { isValidPhotoAnswerUpload: () => true },
    '@/lib/server/notebook-problems/service': {
      createNotebookProblemAttempt: async (args) => {
        captured.push(args);
        state.rows.push({ id: args.id });
      },
    },
    '@/lib/server/repositories/course-enrollment-repository': {
      resolveCourseNotebookAccess: async (_db, _user, course) =>
        course === 'course' ? { role: 'owner', notebookAccessLimit: null } : null,
    },
    '@/lib/server/store-course-layers': { problemLayerWhere: async () => ({}) },
  });
  const attempt = {
    id: 'snapshot123',
    problemId: 'p',
    status: 'passed',
    score: 1,
    answer: { code: 'draft code' },
    event: 'solution_viewed',
    progressSnapshot: { status: 'passed', score: 1, attemptedCount: 4 },
    createdAt: 100,
  };
  const input = native.nativeProblemAttemptUploadSchema.parse({
    courseId: 'course',
    attempts: [attempt],
  });
  assert.deepEqual((await native.saveNativeProblemAttempts(db, 'user', input)).saved, [
    'snapshot123',
  ]);
  assert.equal(captured[0].preserveProgress, true);
  assert.equal(captured[0].status, 'pending');
  assert.equal(captured[0].score, null);
  assert.equal(captured[0].result.earnedPoints, undefined);
  assert.equal(captured[0].result.event, 'solution_viewed');
  assert.equal(captured[0].answer.code, 'draft code');
  await native.saveNativeProblemAttempts(db, 'user', input);
  assert.equal(captured.length, 1);
  const hiddenInput = native.nativeProblemAttemptUploadSchema.parse({
    courseId: 'course',
    attempts: [
      {
        ...attempt,
        id: 'hidden12345',
        event: 'hidden_tests_viewed',
        answer: { parts: { a: { code: 'part draft' } } },
      },
    ],
  });
  await native.saveNativeProblemAttempts(db, 'user', hiddenInput);
  assert.equal(captured[1].result.event, 'hidden_tests_viewed');
  assert.equal(captured[1].preserveProgress, true);
  assert.equal(captured[1].answer.parts.a.code, 'part draft');
  const tableUpload = native.nativeProblemAttemptUploadSchema.parse({
    courseId: 'course',
    attempts: [
      {
        id: 'table12345',
        problemId: 'p',
        status: 'partial',
        score: 0.5,
        answer: { cells: { 'r1:a': '5' }, parts: { a: { cells: { 'r2:b': 'ERROR' } } } },
        cells: [{ key: 'r1:a', correct: true }],
        parts: [
          {
            label: 'a',
            status: 'failed',
            score: 0,
            share: 1,
            cells: [{ key: 'r2:b', correct: false }],
          },
        ],
        createdAt: 101,
      },
    ],
  });
  await native.saveNativeProblemAttempts(db, 'user', tableUpload);
  assert.deepEqual(captured[2].answer.cells, { 'r1:a': '5' });
  assert.deepEqual(captured[2].answer.parts.a.cells, { 'r2:b': 'ERROR' });
  assert.deepEqual(captured[2].result.cells, [{ key: 'r1:a', correct: true }]);
  assert.deepEqual(captured[2].result.parts[0].cells, [{ key: 'r2:b', correct: false }]);
  assert.equal(
    await native.saveNativeProblemAttempts(db, 'user', { ...input, courseId: 'foreign' }),
    null,
  );
  assert.deepEqual(
    (
      await native.saveNativeProblemAttempts(db, 'user', {
        ...input,
        attempts: [{ ...attempt, id: 'foreign123', problemId: 'foreign' }],
      })
    ).skipped,
    ['foreign123'],
  );
});
test('the next AI prompt sees freshly persisted help memory even when its mounted workspace is stale', async () => {
  const saved = learning.problemLearningArchive({
    problem: cases[0],
    answer: { kind: 'choice', selectedOptionIds: ['A'] },
    progress: null,
    event: 'solution_viewed',
    at: 100,
    id: 'view',
  });
  const notebookTranslations = await jiti.import(
    '../../apps/native/src/lib/notebook-translations.ts',
  );
  const { buildNativeChatContext } = load('apps/native/src/ai/context.ts', {
    '../lib/notebook-translations': notebookTranslations,
  });
  const workspace = {
    course: { id: 'course', name: 'Math' },
    notebooks: [],
    problems: [],
    memories: [],
  };
  const context = await buildNativeChatContext({
    repository: {
      loadCourseWorkspace: async () => ({ ...workspace, memories: saved.archive.studyMemories }),
    },
    workspace,
    surface: 'phone',
    readableNotebooks: [],
    learningState: null,
    scheduleItems: [],
    history: [{ role: 'user', text: 'I am stuck' }],
  });
  assert.equal(context.memories.length, 1);
  assert.match(context.memories[0].text, /查看了参考答案/);
  const { buildNativeChatSystemPrompt } = load('features/native-ai/server/prompt.ts');
  const prompt = buildNativeChatSystemPrompt({
    surface: 'phone',
    course: { name: 'Math', language: 'zh-CN' },
    context,
  });
  assert.match(prompt, /查看了参考答案/);
});
test('remember preferences are account-scoped and code drafts retain timestamps for reset/reopen ordering', () => {
  const values = new Map();
  const storage = { getItem: (k) => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) };
  const a = learning.solutionReminderKey('account-a'),
    b = learning.solutionReminderKey('account-b');
  assert.equal(learning.skipsSolutionReminder(storage, a), false);
  learning.rememberSolutionReminder(storage, a);
  assert.equal(learning.skipsSolutionReminder(storage, a), true);
  assert.equal(learning.skipsSolutionReminder(storage, b), false);
  drafts.saveProblemCodeDraft(storage, 'draft', 'starter');
  assert.equal(drafts.readProblemCodeDraft(storage, 'draft'), 'starter');
  assert(drafts.readProblemCodeDraftRecord(storage, 'draft').savedAt > 0);
});

test('multipart reference answers include the actual code solution for each code part', () => {
  const result = problemSolution({
    ...base,
    type: 'multipart',
    publicContent: {
      type: 'multipart',
      stem: 'Two tasks',
      parts: [
        { label: 'a', content: { type: 'code', stem: 'Implement f', language: 'python' } },
        { label: 'b', content: { type: 'short_answer', stem: 'Explain' } },
      ],
    },
    grading: {
      type: 'multipart',
      parts: [
        {
          label: 'a',
          grading: {
            type: 'code',
            solutionCode: 'def f(x):\n    return x + 1',
            analysis: 'Increment once.',
          },
        },
        {
          label: 'b',
          grading: { type: 'short_answer', referenceAnswer: 'The result is one greater.' },
        },
      ],
    },
  });
  assert.match(result.answer, /```python\ndef f\(x\):\n    return x \+ 1\n```/);
  assert.match(result.answer, /The result is one greater/);
  assert.match(result.answer, /Increment once/);
});
