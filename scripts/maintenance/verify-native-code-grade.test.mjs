import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const multipart = await jiti.import('../../lib/problem-bank/multipart.ts');
const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require('next/server');
function harness({
  authenticated = true,
  publicPass = true,
  count = 0,
  preview = false,
  multipartProblem = null,
  classSession = null,
} = {}) {
  const rows = new Map(),
    calls = [],
    counted = [];
  const mocks = {
    '@/lib/server/class-session-attempts': {
      classSessionForAttempt: async ({ classSessionId }) =>
        classSessionId && classSessionId === classSession ? classSession : null,
    },
    '@/lib/problem-bank/multipart': multipart,
    '@/lib/problem-bank': {
      isNotebookMultipartProblemRecord: (problem) =>
        problem.type === 'multipart' && problem.publicContent.type === 'multipart',
    },
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
          problem: multipartProblem ?? {
            type: 'code',
            courseId,
            publicContent: { type: 'code', publicTests: [{}] },
            points: 100,
          },
          secretJudge: {
            secret: 'never-return',
            parts: { a: { supportCode: 'private helper', secretTests: [] } },
          },
        };
      },
      countNotebookProblemSubmissions: async () => {
        counted.push(true);
        return count;
      },
      createNotebookProblemAttempt: async (entry) => {
        rows.set(entry.id, { ...entry, answerJson: entry.answer, resultJson: entry.result });
      },
    },
    '@/lib/problem-bank/scoring-policy': {
      LIMITED_SUBMISSION_COUNT: 3,
      STANDARD_PROBLEM_POINTS: 100,
      applySubmissionScorePolicy: ({ score, result, attemptNumber }) => ({
        score: score / attemptNumber,
        result: { ...result, policyApplied: true },
      }),
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
  return { send, rows, calls, counted };
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
test('a verified classroom submission skips the home limit and the attempt-based score cap', async () => {
  const h = harness({ count: 3, classSession: 'session-1' });
  const r = await h.send({ classSessionId: 'session-1' });
  assert.equal(r.status, 200);
  assert.equal(r.body.data.saved, true);
  assert.equal(h.counted.length, 0, 'classroom submissions do not read the home quota');
  const [row] = h.rows.values();
  assert.equal(row.classSessionId, 'session-1');
  assert.equal(row.score, 100);
  assert.equal(row.result.earnedPoints, 100);
  assert.equal(row.result.policyApplied, undefined);
});
test('a session that fails verification is an ordinary submission and stays limited', async () => {
  const limited = harness({ count: 3 });
  assert.equal((await limited.send({ classSessionId: 'other-session' })).status, 409);
  assert.equal(limited.rows.size, 0);
  const home = harness({ count: 1 });
  await home.send({ classSessionId: 'other-session' });
  const [row] = home.rows.values();
  assert.equal(row.classSessionId, null);
  assert.equal(row.result.policyApplied, true);
  assert.equal(row.score, 50, 'second home attempt keeps the score cap');
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
    const inClass = mod.exports.pendingCodeSubmission('p', 'one', 'class');
    assert.notEqual(inClass, a);
    assert.equal(mod.exports.pendingCodeSubmission('p', 'one', 'class'), inClass);
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

test('multipart public runs scope the selected code and private helper without saving attempts', async () => {
  const p = {
    id: 'problem',
    courseId: 'course',
    type: 'multipart',
    points: 100,
    publicContent: {
      type: 'multipart',
      stem: 'Shared',
      parts: [
        {
          label: 'a',
          points: 1,
          content: { type: 'code', language: 'python', stem: 'Implement', publicTests: [] },
        },
        { label: 'b', points: 1, content: { type: 'short_answer', stem: 'Explain' } },
      ],
    },
    grading: {
      type: 'multipart',
      parts: [
        { label: 'a', grading: { type: 'code' } },
        { label: 'b', grading: { type: 'short_answer' } },
      ],
    },
  };
  const h = harness({ multipartProblem: p });
  const result = await h.send({ part: 'a', mode: 'run' });
  assert.equal(result.status, 200);
  assert.equal(result.body.data.saved, false);
  assert.equal(h.rows.size, 0);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].kind, 'run');
  assert.equal(h.calls[0].runTarget, 'public');
  assert.equal(h.calls[0].problem.id, 'problem#a');
  assert.equal(h.calls[0].secretJudge.supportCode, 'private helper');
  assert.equal(JSON.stringify(result.body).includes('private helper'), false);
  assert.equal((await h.send({ part: 'b', mode: 'run' })).status, 400);
  assert.equal((await h.send({ part: 'missing', mode: 'run' })).status, 400);
  assert.equal(h.calls.length, 1);
});

test('standalone public run does not grade hidden cases or consume a submission', async () => {
  const h = harness({ count: 3 });
  const response = await h.send({ mode: 'run' });
  assert.equal(response.status, 200);
  assert.equal(response.body.data.saved, false);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].kind, 'run');
  assert.equal(h.calls[0].runTarget, 'public');
  // The run is kept only as learning evidence: a run row that leaves progress alone.
  const rows = [...h.rows.values()];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'run');
  assert.equal(rows[0].preserveProgress, true);
});
