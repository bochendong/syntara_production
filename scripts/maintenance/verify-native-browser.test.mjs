import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const errorModule = moduleUrl(
  `export class NativeAuthError extends Error {constructor(status,code,message){super(message);this.status=status;this.code=code;}}`,
);

test('browser access requires staging Google account, active DB membership and same-origin mutations', async () => {
  const sessionStub = moduleUrl(
    `let session=null;export const setSession=s=>session=s;export const getServerSession=async()=>session;`,
  );
  const userStub = moduleUrl(
    `let user=null;export const setUser=u=>user=u;export const getOptionalPrisma=()=>({user:{findUnique:async()=>user}});`,
  );
  const policyUrl = moduleUrl(compile(read('lib/server/native-access-policy.ts')));
  const replacements = {
    'next-auth': sessionStub,
    '@/lib/server/auth': moduleUrl('export const authOptions={};'),
    '@/lib/server/native-device-auth': errorModule,
    '@/lib/server/prisma-safe': userStub,
    '@/lib/server/native-user-access': moduleUrl(
      `import {nativeAccessDecision} from '${policyUrl}';export const NATIVE_ACCESS_SELECT={};export const nativeUserAccess=async user=>nativeAccessDecision('google-test',user);`,
    ),
  };
  let source = compile(read('lib/server/native-browser-auth.ts'));
  for (const [from, to] of Object.entries(replacements))
    source = source.replaceAll(`'${from}'`, `'${to}'`);
  const { authenticateNativeBrowserRequest: auth } = await import(moduleUrl(source));
  const { setSession } = await import(sessionStub);
  const { setUser } = await import(userStub);
  const original = {
    SYNTARA_APP_ENV: process.env.SYNTARA_APP_ENV,
    SYNTARA_NATIVE_ACCESS_POLICY: process.env.SYNTARA_NATIVE_ACCESS_POLICY,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
  };
  const request = (method = 'GET', origin, expected) => ({
    method,
    nextUrl: new URL('https://fixture.invalid/api/native/v1/courses'),
    headers: new Headers({
      ...(origin ? { origin } : {}),
      ...(expected ? { 'x-syntara-user': expected } : {}),
    }),
  });
  try {
    process.env.SYNTARA_APP_ENV = 'staging';
    process.env.SYNTARA_NATIVE_ACCESS_POLICY = 'google-test';
    process.env.NEXTAUTH_URL = 'https://fixture.invalid';
    await assert.rejects(auth(request()), (e) => e.status === 401);
    setSession({ user: { id: 'user-a' } });
    setUser({
      id: 'user-a',
      name: 'A',
      email: 'a@example.invalid',
      image: null,
      role: 'USER',
      isActive: true,
      nativeAppActivatedAt: null,
      accounts: [{ provider: 'google', expires_at: null }],
    });
    assert.equal((await auth(request())).userId, 'user-a');
    assert.equal(
      (await auth(request('POST', 'https://fixture.invalid', 'user-a'))).keyId,
      'browser-session',
    );
    for (const method of ['POST', 'DELETE', 'PATCH']) {
      await assert.rejects(
        auth(request(method, 'https://attacker.invalid')),
        (e) => e.status === 403,
      );
      await assert.rejects(auth(request(method)), (e) => e.status === 403);
    }
    await assert.rejects(auth(request('GET', undefined, 'user-b')), (e) => e.status === 401);
    setUser({ id: 'user-a', isActive: false, accounts: [{ provider: 'google' }] });
    await assert.rejects(auth(request()), (e) => e.status === 403);
    setUser({ id: 'user-a', isActive: true, accounts: [] });
    await assert.rejects(auth(request()), (e) => e.status === 403);
    process.env.SYNTARA_APP_ENV = 'production';
    await assert.rejects(auth(request()), (e) => e.status === 401);
  } finally {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

test('browser transport handles split Unicode SSE, preserves v2 metadata, rejects errors and truncation', async () => {
  const runtime = moduleUrl("export const browserAccountId=()=> 'user-a';");
  const source = compile(read('apps/native/src/data/browser-platform.ts')).replaceAll(
    "'./browser-runtime'",
    `'${runtime}'`,
  );
  const { browserChat, browserCommand } = await import(moduleUrl(source));
  const original = globalThis.fetch;
  let lastRequest;
  const reply = (frames) => {
    globalThis.fetch = async (path, init) => {
      lastRequest = { path, init };
      const bytes = new TextEncoder().encode(frames);
      return new Response(
        new ReadableStream({
          start(c) {
            for (const b of bytes) c.enqueue(Uint8Array.of(b));
            c.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    };
  };
  const req = { requestId: 'fixture-request', payload: { messages: [] }, responseStrength: 'low' };
  try {
    reply(
      'event: text_delta\r\ndata: {"delta":"你好"}\r\n\r\nevent: done\r\ndata: {"assistantMessage":{"text":"你好","metadata":{"aiVersion":"native-v2"}}}\r\n\r\n',
    );
    const events = [];
    const result = await browserChat(req, (e) => events.push(e));
    assert.equal(result.text, '你好');
    assert.equal(result.finalEvent.assistantMessage.metadata.aiVersion, 'native-v2');
    assert.equal(events.length, 2);
    assert.equal(lastRequest.path, '/api/native/v2/chat');
    assert.equal(lastRequest.init.credentials, 'same-origin');
    assert.equal(lastRequest.init.headers.get('X-Syntara-User'), 'user-a');
    assert.equal(lastRequest.init.headers.get('X-Response-Strength'), 'low');
    assert.equal(lastRequest.init.headers.has('Authorization'), false);
    reply('event: error\ndata: {"error":{"message":"fixture failure"}}\n\n');
    await assert.rejects(browserChat(req), /fixture failure/);
    reply('event: text_delta\ndata: {"delta":"partial"}\n\n');
    await assert.rejects(browserChat(req), /回复中断/);
    globalThis.fetch = async (path, init) => {
      lastRequest = { path, init };
      return Response.json({ success: true, data: { saved: true } });
    };
    await browserCommand('native_delete_conversation', undefined, {
      courseId: 'course-a',
      sessionId: 'chat-a',
    });
    assert.equal(lastRequest.init.method, 'DELETE');
    assert.match(lastRequest.path, /courseId=course-a/);
  } finally {
    globalThis.fetch = original;
  }
});

test('browser profile and navigation storage remain account scoped and preview stays independent', async () => {
  const runtime = await import(
    moduleUrl(
      compile(read('apps/native/src/data/browser-runtime.ts')).replace(
        'import.meta.env?.VITE_SYNTARA_WEB_APP',
        "'1'",
      ),
    )
  );
  assert.throws(() => runtime.browserAccountId(), /请先登录/);
  runtime.setBrowserAccount('user-a');
  assert.equal(runtime.accountStorageKey('profile'), 'profile:user-a');
  runtime.setBrowserAccount('user-b');
  assert.equal(runtime.accountStorageKey('profile'), 'profile:user-b');
  const preview = await import(
    moduleUrl(
      compile(read('apps/native/src/data/browser-runtime.ts')).replace(
        'import.meta.env?.VITE_SYNTARA_WEB_APP',
        'undefined',
      ),
    )
  );
  assert.equal(preview.accountStorageKey('profile'), 'profile');
});
