import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require('next/server');
function harness({ authenticated = true, publicPass = true, count = 0, preview = false } = {}) {
  const rows = new Map(),
    calls = [];
  const mocks = {
    'next/server': { NextResponse },
    '@/features/problems/server/judge': {
      judgeNotebookCodeProblem: async (args) => {
        calls.push(args);
        return {
          status: args.kind === 'run' && !publicPass ? 'failed' : 'passed',
          score: 100,
          result: { feedback: 'checked', publicCases: [] },
        };
      },
    },
    '@/features/problems/server/service': {
      getCourseProblemForUser: async (userId, courseId, problemId) => {
        if (courseId !== 'course' || problemId !== 'problem' || userId !== 'user')
          throw Error('not found');
        return {
          isTeacherPreview: preview,
          problem: {
            type: 'code',
            courseId,
            publicContent: { type: 'code', publicTests: [{}] },
            points: 100,
          },
          secretJudge: { secret: 'never-return' },
        };
      },
      countNotebookProblemSubmissions: async () => count,
      createNotebookProblemAttempt: async (entry) => {
        rows.set(entry.id, { ...entry, answerJson: entry.answer, resultJson: entry.result });
      },
    },
    '@/lib/problem-bank/scoring-policy': {
      LIMITED_SUBMISSION_COUNT: 3,
      STANDARD_PROBLEM_POINTS: 100,
      applySubmissionScorePolicy: ({ score, result }) => ({ score, result }),
    },
    '@/lib/server/notebook-problems/course-identity': {
      resolveNotebookProblemCourseIdentity: async () => ({}),
    },
    '@/lib/server/prisma-safe': {
      getOptionalPrisma: () => ({
        notebookProblemAttempt: { findUnique: async ({ where }) => rows.get(where.id) ?? null },
      }),
    },
    '@/lib/server/public-api': {
      publicApiRequestId: () => 'test',
      requireNativePlatformApi: async () =>
        authenticated ? { userId: 'user' } : NextResponse.json({}, { status: 401 }),
      publicApiError: (_id, status, code, message) =>
        NextResponse.json({ code, message }, { status }),
      publicApiSuccess: (_id, data) => NextResponse.json({ success: true, data }),
    },
  };
  const source = ts.transpileModule(
    readFileSync('app/api/native/v1/problem-code/route.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', source)(
    (id) => (id in mocks ? mocks[id] : require(id)),
    mod,
    mod.exports,
  );
  const send = async (changes = {}) => {
    const response = await mod.exports.POST(
      new NextRequest('https://example.test/api/native/v1/problem-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          courseId: 'course',
          problemId: 'problem',
          attemptId: 'abcdefgh1234',
          code: 'print(1)',
          ...changes,
        }),
      }),
    );
    return { status: response.status, body: await response.json() };
  };
  return { send, rows, calls };
}
test('requires authentication before grading', async () => {
  const h = harness({ authenticated: false });
  assert.equal((await h.send()).status, 401);
  assert.equal(h.calls.length, 0);
});
test('public failure does not create or consume a submission', async () => {
  const h = harness({ publicPass: false });
  const r = await h.send();
  assert.equal(r.body.data.saved, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.rows.size, 0);
});
test('submit is saved once, replayed without grading, and bound to user, problem and code', async () => {
  const h = harness();
  const first = await h.send();
  assert.equal(first.body.data.saved, true);
  assert.equal(h.calls.length, 2);
  const replay = await h.send();
  assert.equal(replay.body.data.replayed, true);
  assert.equal(h.calls.length, 2);
  assert.equal(h.rows.size, 1);
  assert.equal((await h.send({ code: 'print(2)' })).status, 409);
});
test('submission limit and preview do not write attempts', async () => {
  const h = harness({ count: 3 });
  assert.equal((await h.send()).status, 409);
  assert.equal(h.calls.length, 0);
  const p = harness({ preview: true });
  assert.equal((await p.send()).body.data.preview, true);
  assert.equal(p.rows.size, 0);
});

test('pending submission identifier persists across retry and changes with code', async () => {
  const data = new Map();
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage: {
      getItem: (key) => data.get(key) ?? null,
      setItem: (key, value) => data.set(key, value),
      removeItem: (key) => data.delete(key),
    },
  };
  try {
    const source = ts.transpileModule(
      readFileSync('apps/native/src/data/code-submission-id.ts', 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
    ).outputText;
    const mod = { exports: {} };
    new Function('require', 'module', 'exports', source)(
      (id) =>
        id === './browser-runtime' ? { accountStorageKey: (key) => `account:${key}` } : require(id),
      mod,
      mod.exports,
    );
    const a = mod.exports.pendingCodeSubmission('p', 'one');
    assert.equal(mod.exports.pendingCodeSubmission('p', 'one'), a);
    const b = mod.exports.pendingCodeSubmission('p', 'two');
    assert.notEqual(a, b);
    mod.exports.clearPendingCodeSubmission('p', a);
    assert.equal(mod.exports.pendingCodeSubmission('p', 'two'), b);
    mod.exports.clearPendingCodeSubmission('p', b);
    assert.notEqual(mod.exports.pendingCodeSubmission('p', 'two'), b);
  } finally {
    globalThis.window = previousWindow;
  }
});
