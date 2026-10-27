import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createJiti } from 'jiti';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const { NextRequest, NextResponse } = require('next/server');
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('.') } });
const photo = await jiti.import('../../lib/problem-bank/photo-answer.ts');
function load(file, mocks) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loadedModule = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => (id in mocks ? mocks[id] : require(id)),
    loadedModule,
    loadedModule.exports,
  );
  return loadedModule.exports;
}
async function run({
  native = false,
  admin = false,
  webUser = false,
  staging = true,
  origin = 'https://staging.example',
  body = { question: 'Q', userAnswer: 'A', points: 10 },
  rawBody,
} = {}) {
  const previous = process.env.SYNTARA_APP_ENV,
    previousUrl = process.env.NEXTAUTH_URL;
  process.env.SYNTARA_APP_ENV = staging ? 'staging' : 'production';
  process.env.NEXTAUTH_URL = 'https://staging.example';
  const calls = [],
    contexts = [];
  const service = load('app/api/quiz-grade/route.ts', {
    'next/server': { NextResponse },
    '@/features/practice/server': {
      gradeQuizAnswer: async (input) => {
        calls.push(input);
        return { score: 8, comment: 'Valid assessment.' };
      },
    },
    '@/lib/logger': { createLogger: () => ({ error() {} }) },
    '@/lib/problem-bank/photo-answer': photo,
    '@/lib/server/admin-auth': {
      requireAdmin: async () =>
        admin
          ? { identity: { userId: 'admin-user' } }
          : { response: NextResponse.json({}, { status: 403 }) },
      requireResolvedUser: async () => (webUser ? { id: 'web-user' } : null),
    },
    '@/lib/server/api-response': {
      apiSuccess: (data) => NextResponse.json({ success: true, ...data }),
      apiError: (code, status, error) => NextResponse.json({ code, error }, { status }),
    },
    '@/lib/server/public-api': {
      publicApiRequestId: () => 'fixture',
      requireNativePlatformApi: async () =>
        native
          ? { userId: 'native-user' }
          : NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
    },
    '@/lib/server/request-context': {
      withRequestContext: (context, fn) => {
        contexts.push(context);
        return fn();
      },
    },
  });
  try {
    const request = new NextRequest('https://staging.example/api/quiz-grade', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
      body: rawBody ?? JSON.stringify(body),
    });
    const response = await service.POST(request);
    return { status: response.status, body: await response.json(), calls, contexts };
  } finally {
    if (previous === undefined) delete process.env.SYNTARA_APP_ENV;
    else process.env.SYNTARA_APP_ENV = previous;
    if (previousUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = previousUrl;
  }
}

test('anonymous staging requests cannot invoke grading', async () => {
  const r = await run();
  assert.equal(r.status, 401);
  assert.equal(r.calls.length, 0);
});
test('native test accounts retain their authenticated grading identity', async () => {
  const r = await run({ native: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.score, 8);
  assert.equal(r.contexts[0].userId, 'native-user');
});
test('administrators may use the restored entry from its configured origin', async () => {
  const r = await run({ admin: true });
  assert.equal(r.status, 200);
  assert.equal(r.contexts[0].userId, 'admin-user');
});
test('admin cookie requests from another or missing origin cannot invoke grading', async () => {
  for (const origin of ['https://elsewhere.example', '']) {
    const r = await run({ admin: true, origin });
    assert.equal(r.status, 403);
    assert.equal(r.calls.length, 0);
  }
});
test('normal production web learners remain supported without admin rights', async () => {
  const r = await run({ staging: false, webUser: true });
  assert.equal(r.status, 200);
  assert.equal(r.contexts[0].userId, 'web-user');
});
test('anonymous production requests are rejected', async () => {
  const r = await run({ staging: false });
  assert.equal(r.status, 401);
  assert.equal(r.calls.length, 0);
});
test('invalid JSON, missing answers and invalid points fail before any model request', async () => {
  for (const change of [
    { rawBody: '{' },
    { body: { question: 'Q', userAnswer: '', points: 10 } },
    { body: { question: 'Q', userAnswer: 'A', points: 0 } },
  ]) {
    const r = await run({ native: true, ...change });
    assert.equal(r.status, 400);
    assert.equal(r.calls.length, 0);
  }
});
test('client model and key fields never enter the grading service', async () => {
  const r = await run({
    native: true,
    body: {
      question: 'Q',
      userAnswer: 'A',
      points: 10,
      apiKey: 'not-a-key',
      model: 'not-a-model',
      baseUrl: 'https://elsewhere.example',
    },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.calls[0]).sort(), ['points', 'question', 'userAnswer']);
});
test('staging middleware restores only the requested generic grading path', () => {
  const previous = process.env.SYNTARA_APP_ENV;
  process.env.SYNTARA_APP_ENV = 'staging';
  try {
    const { middleware } = load('middleware.ts', { 'next/server': { NextResponse } });
    const allowed = middleware(new NextRequest('https://staging.example/api/quiz-grade'));
    assert.equal(allowed.headers.get('x-middleware-next'), '1');
    assert.equal(
      middleware(new NextRequest('https://staging.example/api/notebook-private')).status,
      404,
    );
  } finally {
    if (previous === undefined) delete process.env.SYNTARA_APP_ENV;
    else process.env.SYNTARA_APP_ENV = previous;
  }
});
