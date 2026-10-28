import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createHandwritingGrader } from '../../apps/native/handwriting-grading-plugin.mjs';

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (file) =>
  ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const runtime = moduleUrl(
  "export const browserAccountId=()=>{throw new Error('No browser-app profile')};",
);
const { browserGrade } = await import(
  moduleUrl(
    compile('apps/native/src/data/browser-platform.ts').replaceAll(
      "'./browser-runtime'",
      `'${runtime}'`,
    ),
  )
);

test('standalone browser grading forwards image-only and four-page answers with cookie auth', async () => {
  const original = globalThis.fetch;
  const images = [1, 2, 3, 4].map((id) => ({
    id: String(id),
    dataUrl: 'data:image/jpeg;base64,YWJj',
    mimeType: 'image/jpeg',
    size: 3,
  }));
  const calls = [];
  try {
    globalThis.fetch = async (path, init) => {
      calls.push({ path, init });
      return Response.json({ success: true, data: { score: 5, comment: 'Valid proof' } });
    };
    for (const count of [1, 4]) {
      const payload = {
        question: 'Q',
        userAnswer: '请查看附图中的作答。',
        points: 5,
        images: images.slice(0, count),
      };
      assert.deepEqual(
        await browserGrade(payload, { 'Content-Type': 'application/json', 'X-Request-Id': 'qa' }),
        { score: 5, comment: 'Valid proof' },
      );
      const { path, init } = calls.at(-1);
      assert.equal(path, '/api/native/v1/grade');
      assert.equal(init.credentials, 'same-origin');
      assert.deepEqual(JSON.parse(init.body), payload);
      assert.equal(new Headers(init.headers).get('X-Request-Id'), 'qa');
    }
    for (const status of [401, 404, 500]) {
      globalThis.fetch = async () => new Response('', { status });
      await assert.rejects(
        browserGrade({}, {}),
        status === 401 ? /登录/ : status === 404 ? /连接平台/ : /500/,
      );
    }
    globalThis.fetch = async () =>
      Response.json(
        { success: false, error: { message: 'Insufficient credits' } },
        { status: 403 },
      );
    await assert.rejects(browserGrade({}, {}), /Insufficient credits/);
  } finally {
    globalThis.fetch = original;
  }
});

async function withGrader(run, overrides = {}) {
  const calls = [];
  const grade = createHandwritingGrader({
    credentialFile: '/offline/private.json',
    resolveAuth: async () => ({
      origin: 'https://staging.example',
      getToken: async () => 'offline-device-token',
    }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return Response.json({ success: true, data: { score: 4, comment: 'Checked' } });
    },
    ...overrides,
  });
  const server = createServer((req, res) => void grade(req, res));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    await run(origin, calls);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('local grading proxy forwards only the grading body and keeps credentials server-side', async () => {
  await withGrader(async (origin, calls) => {
    const payload = {
      question: 'Q',
      userAnswer: 'Image answer',
      points: 5,
      images: [{ dataUrl: 'data:image/jpeg;base64,YWJj', mimeType: 'image/jpeg', size: 3 }],
    };
    const response = await fetch(`${origin}/api/native/v1/grade`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        Authorization: 'Bearer untrusted-browser-token',
      },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    assert.deepEqual(result, { success: true, data: { score: 4, comment: 'Checked' } });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://staging.example/api/native/v1/grade');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer offline-device-token');
    assert.equal(calls[0].init.redirect, 'error');
    assert.deepEqual(JSON.parse(calls[0].init.body), payload);
    assert.ok(!JSON.stringify(result).includes('offline-device-token'));
  });
});

test('proxy rejects cross-origin, absent Origin, other routes, methods, content types and bad JSON before auth', async () => {
  let authenticated = 0;
  await withGrader(
    async (origin, calls) => {
      for (const [path, method, headers, body, status] of [
        [
          '/api/native/v1/grade',
          'POST',
          { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
          '{}',
          403,
        ],
        ['/api/native/v1/grade', 'POST', { 'Content-Type': 'application/json' }, '{}', 403],
        [
          '/api/native/v1/courses',
          'POST',
          { 'Content-Type': 'application/json', Origin: origin },
          '{}',
          405,
        ],
        ['/api/native/v1/grade', 'GET', { Origin: origin }, undefined, 405],
        ['/api/native/v1/grade', 'POST', { Origin: origin }, '{}', 415],
        [
          '/api/native/v1/grade',
          'POST',
          { 'Content-Type': 'application/json', Origin: origin },
          '{',
          400,
        ],
      ]) {
        assert.equal((await fetch(origin + path, { method, headers, body })).status, status);
      }
      assert.equal(calls.length, 0);
      assert.equal(authenticated, 0);
    },
    {
      resolveAuth: async () => {
        authenticated++;
        throw new Error('Private credential path');
      },
    },
  );
});

test('proxy hides credential failures and accepts a later retry', async () => {
  await withGrader(
    async (origin) => {
      const request = () =>
        fetch(origin + '/api/native/v1/grade', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: '{}',
        });
      for (let i = 0; i < 2; i++) {
        const response = await request();
        assert.equal(response.status, 502);
        assert.ok(!(await response.text()).includes('secret'));
      }
    },
    {
      resolveAuth: async () => {
        throw new Error('secret');
      },
    },
  );
});

test('proxy caps body size before reading credentials and blocks remote addresses', async () => {
  let authenticated = 0;
  await withGrader(
    async (origin, calls) => {
      const response = await fetch(origin + '/api/native/v1/grade', {
        method: 'POST',
        headers: { Origin: origin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer: 'x'.repeat(4 * 1024 * 1024) }),
      });
      assert.equal(response.status, 413);
      assert.equal(calls.length, 0);
      assert.equal(authenticated, 0);
    },
    {
      resolveAuth: async () => {
        authenticated++;
        throw new Error('never');
      },
    },
  );
  let status;
  const grade = createHandwritingGrader({
    credentialFile: '/offline/private.json',
    resolveAuth: async () => {
      throw new Error('never');
    },
  });
  await grade(
    {
      socket: { remoteAddress: '192.0.2.1' },
      headers: { origin: 'http://localhost:1432', host: 'localhost:1432' },
    },
    { writeHead: (s) => (status = s), end() {} },
  );
  assert.equal(status, 403);
});

test('proxy permits only one in-flight grade and releases the slot after completion', async () => {
  let release, started;
  const gate = new Promise((resolve) => (release = resolve));
  const began = new Promise((resolve) => (started = resolve));
  await withGrader(
    async (origin) => {
      const request = () =>
        fetch(origin + '/api/native/v1/grade', {
          method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' },
          body: '{}',
        });
      const first = request();
      await began;
      try {
        assert.equal((await request()).status, 429);
      } finally {
        release();
      }
      assert.equal((await first).status, 200);
      assert.equal((await request()).status, 200);
    },
    {
      fetchImpl: async () => {
        started();
        await gate;
        return Response.json({ success: true, data: { score: 5, comment: 'OK' } });
      },
    },
  );
});

test('signed-in browser app sends images through its account-checked same-origin grading endpoint', async () => {
  const browserRuntime = moduleUrl("export const browserAccountId=()=> 'browser-user';");
  const { browserCommand } = await import(
    moduleUrl(
      compile('apps/native/src/data/browser-platform.ts').replaceAll(
        "'./browser-runtime'",
        `'${browserRuntime}'`,
      ),
    )
  );
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (path, init) => {
      assert.equal(path, '/api/native/v1/grade');
      assert.equal(init.credentials, 'same-origin');
      assert.equal(new Headers(init.headers).get('X-Syntara-User'), 'browser-user');
      assert.equal(new Headers(init.headers).get('Content-Type'), 'application/json');
      assert.equal(JSON.parse(init.body).images.length, 1);
      return Response.json({ success: true, data: { score: 5, comment: 'Correct image answer' } });
    };
    const result = await browserCommand(
      'native_grade_answer',
      {
        question: '2+2',
        userAnswer: 'Image answer',
        points: 5,
        images: [{ dataUrl: 'data:image/jpeg;base64,YWJj', mimeType: 'image/jpeg', size: 3 }],
      },
      undefined,
      { 'Content-Type': 'application/json' },
    );
    assert.equal(result.score, 5);
  } finally {
    globalThis.fetch = original;
  }
});
