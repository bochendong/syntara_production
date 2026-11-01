import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const { NextResponse } = require('next/server');
const route = ts.transpileModule(
  readFileSync('app/api/courses/[id]/problems/[problemId]/attempts/event/route.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;

function harness({ authenticated = true, preview = false, previous = null, passedCount = 0 } = {}) {
  const saved = [];
  let loads = 0;
  const mocks = {
    'next/server': { NextResponse },
    zod: require('zod'),
    '@/lib/server/api-auth': {
      requireUserId: async () =>
        authenticated
          ? { userId: 'student' }
          : { response: NextResponse.json({}, { status: 401 }) },
    },
    '@/lib/server/json-error-response': { safeRoute: (run) => run() },
    '@/features/problems/server/service': {
      getCourseProblemForUser: async (user, course, problem) => {
        assert.deepEqual([user, course, problem], ['student', 'course', 'problem']);
        loads += 1;
        return { isTeacherPreview: preview, problem: { points: 100 } };
      },
      createNotebookProblemAttempt: async (attempt) => saved.push(attempt),
    },
    '@/lib/server/prisma': {
      prisma: {
        notebookProblemProgress: {
          findUnique: async () => ({
            status: 'partial',
            score: 40,
            attemptedCount: 2,
            passedCount,
          }),
        },
        notebookProblemAttempt: { findFirst: async () => previous },
      },
    },
  };
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', route)(
    (id) => {
      assert(id in mocks, `Unexpected route dependency: ${id}`);
      return mocks[id];
    },
    mod,
    mod.exports,
  );
  return {
    saved,
    loads: () => loads,
    send: async (event = 'solution_viewed') => {
      const response = await mod.exports.POST(
        new Request('https://example.test/api/courses/course/problems/problem/attempts/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event }),
        }),
        { params: Promise.resolve({ id: 'course', problemId: 'problem' }) },
      );
      return { status: response.status, body: await response.json() };
    },
  };
}

test('help events require authentication before accessing course data', async () => {
  const h = harness({ authenticated: false });
  assert.equal((await h.send()).status, 401);
  assert.equal(h.loads(), 0);
  assert.equal(h.saved.length, 0);
});

test('ordinary hints cannot be uploaded as solution help events', async () => {
  const h = harness();
  assert.equal((await h.send('hint')).status, 400);
  assert.equal(h.saved.length, 0);
});

test('solution and hidden-test events preserve assessed progress and normalize the snapshot', async () => {
  for (const event of ['solution_viewed', 'hidden_tests_viewed']) {
    const h = harness();
    assert.deepEqual(await h.send(event), { status: 200, body: { recorded: true } });
    assert.equal(h.saved.length, 1);
    const attempt = h.saved[0];
    assert.equal(attempt.preserveProgress, true);
    assert.equal(attempt.status, 'pending');
    assert.equal(attempt.score, null);
    assert.equal(attempt.result.event, event);
    assert.deepEqual(attempt.result.progressSnapshot, {
      status: 'partial',
      score: 0.4,
      attemptedCount: 2,
    });
  }
});

for (const [name, options] of [
  ['teacher preview', { preview: true }],
  ['already recorded help', { previous: { id: 'existing' } }],
  ['previously passed problem', { passedCount: 1 }],
]) {
  test(`${name} does not create a new learning signal`, async () => {
    const h = harness(options);
    assert.deepEqual(await h.send(), { status: 200, body: { recorded: false } });
    assert.equal(h.saved.length, 0);
  });
}
