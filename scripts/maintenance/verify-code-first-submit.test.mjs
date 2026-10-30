import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createJiti } from 'jiti';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
const schemas = await jiti.import('../../lib/problem-bank/schema.ts');
const scoring = await jiti.import('../../lib/problem-bank/scoring-policy.ts');
const { judgeNotebookCodeProblem } = await jiti.import(
  '../../lib/server/notebook-problems/judge.ts',
);
const { NextRequest, NextResponse } = require('next/server');

// Exercise the real route, persistence service, schema and Python subprocess. Only
// identity/course loading and database I/O are replaced by disposable fixtures.
function loadSource(path, mocks) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function('require', 'module', 'exports', output)(
    (id) => mocks[id] ?? {},
    loaded,
    loaded.exports,
  );
  return loaded.exports;
}

const suite = (description = '', expected = 3) => `import unittest
from submission import add
class Public(unittest.TestCase):
    def test_sum(self):
        ${description ? JSON.stringify(description) : '# No docstring: unittest.shortDescription() returns None.'}
        self.assertEqual(add(1, 2), ${expected})
`;

function harness({ description = '', secretExpected = 3 } = {}) {
  const rows = new Map();
  const calls = { transactions: 0, progress: 0, jobs: 0, grades: 0 };
  const tx = {
    notebookProblemAttempt: {
      create: async ({ data }) => {
        const row = {
          ...JSON.parse(JSON.stringify(data)),
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        rows.set(row.id, row);
        return row;
      },
    },
    notebookProblemProgress: {
      upsert: async () => {
        calls.progress += 1;
      },
    },
    notebookProblem: { findUnique: async () => ({ courseId: 'course', notebookId: null }) },
  };
  const prisma = {
    $transaction: async (run) => {
      calls.transactions += 1;
      return run(tx);
    },
    notebookProblemAttempt: { findUnique: async ({ where }) => rows.get(where.id) ?? null },
  };
  const service = loadSource('lib/server/notebook-problems/service.ts', {
    '@/lib/server/prisma': { prisma },
    '@/lib/server/prisma-json': { toPrismaJson: (value) => value },
    '@/lib/problem-bank': schemas,
    '@/features/background-jobs/server/store': {
      enqueueJob: async () => {
        calls.jobs += 1;
      },
    },
  });
  const problem = {
    id: 'problem',
    courseId: 'course',
    notebookId: null,
    title: 'Isolated first submission',
    type: 'code',
    status: 'published',
    source: 'manual',
    order: 0,
    points: 100,
    difficulty: 'easy',
    tags: [],
    publicContent: {
      type: 'code',
      language: 'python',
      stem: 'Implement add.',
      publicTests: [],
      publicTestCode: suite(description),
    },
    grading: { type: 'code', publishRequirementsMet: true },
    sourceMeta: {},
    createdAt: 0,
    updatedAt: 0,
  };
  const route = loadSource('app/api/native/v1/problem-code/route.ts', {
    zod: require('zod'),
    'next/server': { NextResponse },
    '@/features/problems/server/judge': {
      judgeNotebookCodeProblem: async (args) => {
        calls.grades += 1;
        return judgeNotebookCodeProblem(args);
      },
    },
    '@/features/problems/server/service': {
      createNotebookProblemAttempt: service.createNotebookProblemAttempt,
      countNotebookProblemSubmissions: async () => rows.size,
      getCourseProblemForUser: async () => ({
        problem,
        isTeacherPreview: false,
        secretJudge: {
          language: 'python',
          timeoutMs: 5000,
          secretTestCode: suite('', secretExpected),
        },
      }),
    },
    '@/lib/problem-bank/scoring-policy': scoring,
    '@/lib/server/notebook-problems/course-identity': {
      resolveNotebookProblemCourseIdentity: async () => undefined,
    },
    '@/lib/server/prisma-safe': { getOptionalPrisma: () => prisma },
    '@/lib/server/public-api': {
      publicApiRequestId: () => 'local-test',
      requireNativePlatformApi: async () => ({ userId: 'user' }),
      publicApiError: (_id, status, code, message) =>
        NextResponse.json({ code, message }, { status }),
      publicApiSuccess: (_id, data) => NextResponse.json({ success: true, data }),
    },
  });
  return {
    rows,
    calls,
    service,
    send: async (changes = {}) => {
      const response = await route.POST(
        new NextRequest('https://example.test/api/native/v1/problem-code', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            courseId: 'course',
            problemId: 'problem',
            attemptId: 'first-submit-test',
            code: 'def add(a, b):\n    return a + b',
            language: 'zh-CN',
            ...changes,
          }),
        }),
      );
      return { status: response.status, body: await response.json() };
    },
  };
}

test('Python unittest without docstrings succeeds on the first POST and replays without another attempt', async () => {
  const h = harness();
  const first = await h.send();
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.data.status, 'passed');
  assert.equal(first.body.data.score, 100);
  assert.equal(first.body.data.saved, true);
  assert.equal(first.body.data.replayed, false);
  assert.equal(Object.hasOwn(first.body.data.result.publicCases[0], 'description'), false);
  assert.equal(
    schemas.notebookProblemAttemptResultSchema.safeParse(first.body.data.result).success,
    true,
  );
  const replay = await h.send();
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.replayed, true);
  assert.deepEqual(replay.body.data.result, first.body.data.result);
  assert.equal(h.rows.size, 1);
  assert.deepEqual(h.calls, { transactions: 1, progress: 1, jobs: 1, grades: 2 });
});

test('descriptions remain available and hidden-test failure is saved once without becoming a transport failure', async () => {
  const h = harness({ description: 'Checks the sum.', secretExpected: 4 });
  const response = await h.send();
  assert.equal(response.status, 200);
  assert.equal(response.body.data.saved, true);
  assert.equal(response.body.data.status, 'partial');
  assert.equal(response.body.data.result.publicCases[0].description, 'Checks the sum.');
  assert.equal(response.body.data.result.secretSummary.failed, 1);
  assert.equal(h.rows.size, 1);
  assert.equal(h.calls.progress, 1);
});

test('invalid result payloads are rejected before opening a transaction or writing attempts/progress/jobs', async () => {
  const h = harness();
  await assert.rejects(
    h.service.createNotebookProblemAttempt({
      id: 'invalid-result',
      userId: 'user',
      problemId: 'problem',
      kind: 'submit',
      status: 'passed',
      score: 100,
      answer: { code: 'pass' },
      result: { publicCases: [{ id: 'test', passed: 'invalid' }] },
    }),
  );
  assert.equal(h.rows.size, 0);
  assert.equal(h.calls.transactions, 0);
  assert.equal(h.calls.progress, 0);
  assert.equal(h.calls.jobs, 0);
});

test('failing public tests still do not consume an attempt', async () => {
  const h = harness();
  const response = await h.send({ code: 'def add(a, b):\n    return 0' });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.saved, false);
  assert.equal(response.body.data.status, 'failed');
  assert.equal(h.rows.size, 0);
  assert.equal(h.calls.transactions, 0);
});

test('previously saved null unittest descriptions remain readable without changing results', () => {
  const legacy = schemas.notebookProblemAttemptRecordSchema.parse({
    id: 'legacy-attempt',
    userId: 'user',
    problemId: 'problem',
    kind: 'submit',
    status: 'passed',
    score: 100,
    answer: { code: 'pass' },
    createdAt: 0,
    updatedAt: 0,
    result: { feedback: 'passed', publicCases: [{ id: 'test', passed: true, description: null }] },
  });
  assert.equal(legacy.result.publicCases[0].description, undefined);
  assert.equal(legacy.result.publicCases[0].passed, true);
  assert.equal(legacy.status, 'passed');
  assert.equal(legacy.score, 100);
});
