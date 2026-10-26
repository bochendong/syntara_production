import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, chmod, stat, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { resolveBackendAuth, validateBackendOrigin } from './syntara-backend-auth.mjs';
import {
  parseArgs,
  readToken,
  resolveImportAuth,
  listCoursesThroughHttp,
  readCourseContextThroughHttp,
  saveReceipt,
  main,
} from './import-course-problems.mjs';

const fixtureAccess = 'snt_acc_offline_fixture_access';
const fixtureRefresh = 'snt_ref_offline_fixture_refresh';
const rotatedAccess = 'snt_acc_offline_rotated_access';
const rotatedRefresh = 'snt_ref_offline_rotated_refresh';

function session(origin, expired = true) {
  return {
    origin,
    accessToken: fixtureAccess,
    accessTokenExpiresAt: new Date(Date.now() + (expired ? -1000 : 3_600_000)).toISOString(),
    refreshToken: fixtureRefresh,
    refreshTokenExpiresAt: new Date(Date.now() + 7_200_000).toISOString(),
    sessionId: 'offline-session',
    user: { id: 'offline-user' },
  };
}

function rotated() {
  return {
    status: 'authorized',
    ...session(undefined, false),
    accessToken: rotatedAccess,
    refreshToken: rotatedRefresh,
  };
}

async function privateFile(fn) {
  const directory = await mkdtemp(path.join(tmpdir(), 'syntara-backend-auth-'));
  const filename = path.join(directory, 'credentials.json');
  try {
    await fn(filename, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function save(filename, value) {
  await writeFile(filename, JSON.stringify(value), { mode: 0o600 });
}

async function serverTest(handler, fn) {
  const server = createServer((request, response) => {
    Promise.resolve(handler(request, response)).catch(() => {
      response.writeHead(500).end('offline mock failed');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

async function readBody(request) {
  let contents = '';
  for await (const chunk of request) contents += chunk;
  return JSON.parse(contents);
}

function send(response, value) {
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
}

test('HTTPS exact origins and loopback HTTP are accepted; unsafe targets are rejected', () => {
  assert.ok(validateBackendOrigin('https://example.test/') === 'https://example.test');
  for (const input of [
    'http://example.test',
    'https://user:password@example.test',
    'https://example.test/path',
    'https://example.test?secret=value',
    'https://example.test#fragment',
    'not a URL',
  ])
    assert.throws(() => validateBackendOrigin(input));
});

test('fresh private credentials infer origin and do not call refresh', async () => {
  await privateFile(async (filename) => {
    await save(filename, session('https://example.test', false));
    let requests = 0;
    const auth = await resolveBackendAuth(
      { credentialFile: filename },
      { env: {}, fetchImpl: async () => requests++ },
    );
    assert.ok(auth.origin === 'https://example.test');
    assert.ok((await auth.getToken()) === fixtureAccess);
    assert.ok(requests === 0);
  });
});

test('a real loopback refresh rotates both tokens and atomically saves mode 0600', async () => {
  let requests = 0;
  await serverTest(
    async (request, response) => {
      requests++;
      assert.ok(request.method === 'POST');
      assert.ok(request.url === '/api/native/v1/auth/refresh');
      assert.ok((await readBody(request)).refreshToken === fixtureRefresh);
      send(response, { success: true, data: rotated() });
    },
    async (origin) => {
      await privateFile(async (filename, directory) => {
        await save(filename, session(origin));
        const auth = await resolveBackendAuth({ credentialFile: filename }, { env: {} });
        assert.ok((await auth.getToken()) === rotatedAccess);
        assert.ok((await auth.getToken()) === rotatedAccess);
        assert.ok(requests === 1);
        const saved = JSON.parse(await readFile(filename, 'utf8'));
        assert.ok(saved.origin === origin && saved.refreshToken === rotatedRefresh);
        assert.ok(saved.sessionId === 'offline-session');
        assert.ok(((await stat(filename)).mode & 0o777) === 0o600);
        assert.deepEqual(await readdir(directory), ['credentials.json']);
      });
    },
  );
});

test('near-expiry access refreshes before it expires', async () => {
  await privateFile(async (filename) => {
    const current = session('https://example.test', false);
    current.accessTokenExpiresAt = new Date(Date.now() + 30_000).toISOString();
    await save(filename, current);
    let requests = 0;
    const auth = await resolveBackendAuth(
      { credentialFile: filename },
      {
        env: {},
        fetchImpl: async (_url, options) => {
          requests++;
          assert.ok(options.redirect === 'error');
          return Response.json({ success: true, data: rotated() });
        },
      },
    );
    assert.ok((await auth.getToken()) === rotatedAccess && requests === 1);
  });
});

test('concurrent callers re-read under the exclusive lock and refresh once', async () => {
  let requests = 0;
  await serverTest(
    async (request, response) => {
      requests++;
      assert.ok((await readBody(request)).refreshToken === fixtureRefresh);
      await new Promise((resolve) => setTimeout(resolve, 75));
      send(response, { success: true, data: rotated() });
    },
    async (origin) => {
      await privateFile(async (filename) => {
        await save(filename, session(origin));
        const readers = await Promise.all(
          Array.from({ length: 8 }, () =>
            resolveBackendAuth({ credentialFile: filename }, { env: {} }),
          ),
        );
        const tokens = await Promise.all(readers.map((auth) => auth.getToken()));
        assert.ok(tokens.every((token) => token === rotatedAccess));
        assert.ok(requests === 1);
      });
    },
  );
});

test('independent agent processes coordinate rotation through the same filesystem lock', async () => {
  let requests = 0;
  await serverTest(
    async (request, response) => {
      requests++;
      assert.ok((await readBody(request)).refreshToken === fixtureRefresh);
      await new Promise((resolve) => setTimeout(resolve, 100));
      send(response, { success: true, data: rotated() });
    },
    async (origin) => {
      await privateFile(async (filename) => {
        await save(filename, session(origin));
        const code = `const {resolveBackendAuth}=await import(process.argv[1]);
          const auth=await resolveBackendAuth({credentialFile:process.argv[2]},{env:{}});
          const token=await auth.getToken();
          if(!token.startsWith('snt_acc_'))throw Error('offline authentication failed');
          process.stdout.write('ok');`;
        const helper = new URL('./syntara-backend-auth.mjs', import.meta.url).href;
        const outcomes = await Promise.all(
          Array.from(
            { length: 4 },
            () =>
              new Promise((resolve, reject) => {
                const child = spawn(
                  process.execPath,
                  ['--input-type=module', '-e', code, helper, filename],
                  {
                    env: {},
                    stdio: ['ignore', 'pipe', 'pipe'],
                  },
                );
                let stdout = '';
                let stderr = '';
                child.stdout.on('data', (chunk) => (stdout += chunk));
                child.stderr.on('data', (chunk) => (stderr += chunk));
                child.on('error', () => reject(new Error('Offline agent process failed.')));
                child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
              }),
          ),
        );
        assert.ok(outcomes.every((outcome) => outcome.exitCode === 0 && outcome.stdout === 'ok'));
        assert.ok(outcomes.every((outcome) => outcome.stderr === ''));
        assert.ok(requests === 1);
      });
    },
  );
});

test('wrong credential origin fails before sending any token', async () => {
  await privateFile(async (filename) => {
    await save(filename, session('https://one.example.test'));
    let requests = 0;
    await assert.rejects(
      resolveBackendAuth(
        { credentialFile: filename, origin: 'https://two.example.test' },
        { env: {}, fetchImpl: async () => requests++ },
      ),
      /origin does not match/,
    );
    assert.ok(requests === 0);
  });
});

test('refresh redirects never forward refresh tokens to a different origin', async () => {
  let forwarded = 0;
  await serverTest(
    (_request, response) => {
      forwarded++;
      response.end();
    },
    async (otherOrigin) => {
      await serverTest(
        (_request, response) => response.writeHead(307, { location: otherOrigin }).end(),
        async (origin) => {
          await privateFile(async (filename, directory) => {
            await save(filename, session(origin));
            const before = await readFile(filename, 'utf8');
            const auth = await resolveBackendAuth({ credentialFile: filename }, { env: {} });
            await assert.rejects(auth.getToken(), /refresh failed/);
            assert.ok((await readFile(filename, 'utf8')) === before);
            assert.deepEqual(await readdir(directory), ['credentials.json']);
          });
        },
      );
    },
  );
  assert.ok(forwarded === 0);
});

test('insecure permissions, symlinks and malformed credentials are rejected safely', async () => {
  await privateFile(async (filename, directory) => {
    await save(filename, session('https://example.test'));
    await chmod(filename, 0o644);
    await assert.rejects(resolveBackendAuth({ credentialFile: filename }, { env: {} }), /0600/);
    await chmod(filename, 0o600);
    const link = path.join(directory, 'linked.json');
    await symlink(filename, link);
    await assert.rejects(
      resolveBackendAuth({ credentialFile: link }, { env: {} }),
      /private credential/,
    );
    await writeFile(filename, `{"accessToken":"${fixtureAccess}",bad-json`, { mode: 0o600 });
    await assert.rejects(
      resolveBackendAuth({ credentialFile: filename }, { env: {} }),
      (error) => !error.message.includes(fixtureAccess) && /JSON/.test(error.message),
    );
  });
});

test('expired sessions fail locally and error bodies/network exceptions do not expose tokens', async () => {
  await privateFile(async (filename, directory) => {
    const expired = session('https://example.test');
    expired.refreshTokenExpiresAt = new Date(Date.now() - 1000).toISOString();
    await save(filename, expired);
    const auth = await resolveBackendAuth({ credentialFile: filename }, { env: {} });
    await assert.rejects(auth.getToken(), /expired/);
    await save(filename, session('https://example.test'));
    for (const fetchImpl of [
      async () => Response.json({ error: { message: fixtureRefresh } }, { status: 401 }),
      async () => {
        throw new Error(fixtureRefresh);
      },
      async () =>
        Response.json({ success: true, data: { ...rotated(), sessionId: fixtureRefresh } }),
    ]) {
      const failing = await resolveBackendAuth(
        { credentialFile: filename },
        { env: {}, fetchImpl },
      );
      await assert.rejects(
        failing.getToken(),
        (error) =>
          !error.message.includes(fixtureRefresh) && !error.message.includes(fixtureAccess),
      );
      assert.deepEqual(await readdir(directory), ['credentials.json']);
    }
  });
});

test('legacy token-file/env remain compatible, exclusive and never load an env file', async () => {
  await privateFile(async (filename) => {
    await writeFile(filename, 'offline-legacy-bearer\n');
    const fileAuth = await resolveBackendAuth({ tokenFile: filename }, { env: {} });
    assert.ok((await fileAuth.getToken()) === 'offline-legacy-bearer');
    const envAuth = await resolveBackendAuth(
      { tokenEnv: 'OFFLINE_TOKEN' },
      { env: { OFFLINE_TOKEN: 'offline-bearer' } },
    );
    assert.ok((await envAuth.getToken()) === 'offline-bearer');
    await assert.rejects(
      resolveBackendAuth({ tokenFile: filename, credentialFile: filename }, { env: {} }),
      /exactly one/,
    );
    await assert.rejects(
      resolveBackendAuth({ tokenEnv: 'NOT-VALID' }, { env: {} }),
      /variable name/,
    );
  });
});

test('question CLI keeps readToken string compatibility and accepts credential/list flags', async () => {
  const parsed = parseArgs(['--list-courses', '--credential-file', '/offline/private.json']);
  assert.ok(parsed.listCourses && parsed.credentialFile === '/offline/private.json');
  assert.ok(
    (await readToken({ tokenEnv: 'TOKEN' }, { env: { TOKEN: 'offline-token' } })) ===
      'offline-token',
  );
  await assert.rejects(
    resolveImportAuth({ tokenEnv: 'TOKEN' }, { env: { TOKEN: 'offline-token' } }),
    /origin/,
  );
  await assert.rejects(main(['--list-courses', '--apply']), /cannot be combined/);
  await assert.rejects(main(['--list-courses', '--manifest', 'unused.json']), /cannot be combined/);
});

test('paginated course catalog refreshes between requests and preserves private audit receipts', async () => {
  let refreshes = 0;
  let pages = 0;
  await serverTest(
    async (request, response) => {
      if (request.url === '/api/native/v1/auth/refresh') {
        refreshes++;
        assert.ok((await readBody(request)).refreshToken === fixtureRefresh);
        send(response, { success: true, data: rotated() });
        return;
      }
      const url = new URL(request.url, 'http://localhost');
      assert.ok(request.method === 'GET' && url.searchParams.get('limit') === '100');
      pages++;
      const next = url.searchParams.get('cursor');
      assert.ok(request.headers.authorization === `Bearer ${next ? rotatedAccess : fixtureAccess}`);
      send(response, {
        success: true,
        data: {
          courses: [{ id: next ? 'course-b' : 'course-a', name: 'Offline private course' }],
          nextCursor: next ? null : 'course-a',
          actor: { kind: 'offline-course-grant' },
          capabilities: ['append-reviewed-problems', 'append-reviewed-markdown-notes'],
        },
      });
    },
    async (origin) => {
      await privateFile(async (filename, directory) => {
        await save(filename, session(origin, false));
        const auth = await resolveImportAuth({ credentialFile: filename }, { env: {} });
        const receiptPath = path.join(directory, 'catalog.json');
        const receipt = await listCoursesThroughHttp({
          origin: auth.origin,
          getToken: auth.getToken,
          onReceipt: async (value) => {
            await saveReceipt(receiptPath, value);
            if (value.pages.length === 1) await save(filename, session(origin));
          },
        });
        assert.ok(receipt.courses.length === 2 && receipt.pages.length === 2);
        assert.ok(pages === 2 && refreshes === 1);
        const saved = JSON.parse(await readFile(receiptPath, 'utf8'));
        assert.ok(saved.pages.every((page) => page.actor && page.capabilities.length === 2));
        assert.ok(((await stat(receiptPath)).mode & 0o777) === 0o600);
        assert.ok(!JSON.stringify(saved).includes(fixtureAccess));
      });
    },
  );
});

test('list-courses main needs no manifest and prints only count/path', async () => {
  await serverTest(
    (_request, response) =>
      send(response, {
        success: true,
        data: {
          courses: [{ id: 'offline-course', name: 'Do not print this course name' }],
          nextCursor: null,
          actor: { kind: 'offline' },
          capabilities: [],
        },
      }),
    async (origin) => {
      await privateFile(async (filename, directory) => {
        await save(filename, session(origin, false));
        const receiptPath = path.join(directory, 'catalog.json');
        const cli = new URL('./import-course-problems.mjs', import.meta.url);
        const output = await new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              cli.pathname,
              '--list-courses',
              '--credential-file',
              filename,
              '--receipt',
              receiptPath,
            ],
            { env: {}, stdio: ['ignore', 'pipe', 'pipe'] },
          );
          let stdout = '',
            stderr = '';
          child.stdout.on('data', (chunk) => (stdout += chunk));
          child.stderr.on('data', (chunk) => (stderr += chunk));
          child.on('error', () => reject(new Error('Offline catalog CLI failed.')));
          child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
        });
        assert.ok(output.exitCode === 0 && output.stderr === '');
        assert.ok(output.stdout === `Listed 1 course(s). Private receipt: ${receiptPath}\n`);
        assert.ok(
          !output.stdout.includes('Do not print') && !output.stdout.includes(fixtureAccess),
        );
        assert.ok(((await stat(receiptPath)).mode & 0o777) === 0o600);
      });
    },
  );
});

test('catalog errors do not echo server text and repeated cursors fail closed', async () => {
  for (const fetchImpl of [
    async () =>
      Response.json({ success: false, error: { message: fixtureAccess } }, { status: 500 }),
    async () => Response.json({ success: true, data: { courses: [], nextCursor: 'same-cursor' } }),
  ])
    await assert.rejects(
      listCoursesThroughHttp({ origin: 'https://example.test', token: 'offline-token', fetchImpl }),
      (error) => !error.message.includes(fixtureAccess),
    );
});

test('course context encodes identifiers, keeps complete rule audit and main prints only receipt path', async () => {
  const courseId = 'offline/course?x=1&other=2#section';
  await serverTest(
    (request, response) => {
      const url = new URL(request.url, 'http://localhost');
      assert.ok(url.pathname === '/api/native/v1/course-problem-imports');
      assert.ok(url.searchParams.size === 1 && url.searchParams.get('courseId') === courseId);
      assert.ok(
        request.method === 'GET' && request.headers.authorization === `Bearer ${fixtureAccess}`,
      );
      send(response, {
        success: true,
        data: {
          course: {
            id: courseId,
            name: 'Private course title',
            chapters: [{ id: 'chapter', name: 'Sets' }],
            hardRules: [{ id: 'rule', content: 'Private rule content', position: 0 }],
            rulePacks: [
              { id: 'pack', contractJson: { version: 1 }, sourceRefs: ['private-source'] },
            ],
          },
          actor: { kind: 'offline-grant' },
        },
      });
    },
    async (origin) => {
      await privateFile(async (filename, directory) => {
        await save(filename, session(origin, false));
        const receiptPath = path.join(directory, 'context.json');
        const cli = new URL('./import-course-problems.mjs', import.meta.url);
        const output = await new Promise((resolve, reject) => {
          const child = spawn(
            process.execPath,
            [
              cli.pathname,
              '--course-context',
              courseId,
              '--credential-file',
              filename,
              '--receipt',
              receiptPath,
            ],
            { env: {}, stdio: ['ignore', 'pipe', 'pipe'] },
          );
          let stdout = '',
            stderr = '';
          child.stdout.on('data', (chunk) => (stdout += chunk));
          child.stderr.on('data', (chunk) => (stderr += chunk));
          child.on('error', () => reject(new Error('Offline course context CLI failed.')));
          child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
        });
        assert.ok(output.exitCode === 0 && output.stderr === '');
        assert.ok(output.stdout === `${receiptPath}\n`);
        const saved = JSON.parse(await readFile(receiptPath, 'utf8'));
        assert.ok(saved.course.id === courseId && saved.course.hardRules.length === 1);
        assert.ok(
          saved.course.rulePacks[0].sourceRefs[0] === 'private-source' &&
            saved.actor.kind === 'offline-grant',
        );
        assert.ok(saved.mode === 'course-context' && saved.origin === origin);
        assert.ok(((await stat(receiptPath)).mode & 0o777) === 0o600);
        assert.ok(!JSON.stringify(saved).includes(fixtureAccess));
      });
    },
  );
});

test('course context errors, incomplete rules and wrong course IDs fail without secret output', async () => {
  const valid = { course: { id: 'course', chapters: [], hardRules: [], rulePacks: [] }, actor: {} };
  for (const fetchImpl of [
    async () => Response.json({ error: { message: fixtureRefresh } }, { status: 403 }),
    async () => {
      throw new Error(fixtureAccess);
    },
    async () =>
      Response.json({
        success: true,
        data: { ...valid, course: { ...valid.course, id: 'wrong' } },
      }),
    async () => Response.json({ success: true, data: { ...valid, course: { id: 'course' } } }),
  ])
    await assert.rejects(
      readCourseContextThroughHttp({
        origin: 'https://example.test',
        courseId: 'course',
        token: 'offline-token',
        fetchImpl,
      }),
      (error) => !error.message.includes(fixtureAccess) && !error.message.includes(fixtureRefresh),
    );
  const receipt = await readCourseContextThroughHttp({
    origin: 'https://example.test',
    courseId: 'course',
    getToken: async () => 'offline-token',
    fetchImpl: async (_url, options) => {
      assert.ok(options.redirect === 'error');
      return Response.json({ success: true, data: valid });
    },
  });
  assert.ok(receipt.course.id === 'course');
});

test('course-context is mutually exclusive with catalog, manifest and apply', async () => {
  assert.ok(parseArgs(['--course-context', 'course']).courseContext === 'course');
  for (const args of [
    ['--course-context', 'course', '--list-courses'],
    ['--course-context', 'course', '--manifest', 'unused.json'],
    ['--course-context', 'course', '--apply'],
  ])
    await assert.rejects(main(args), /cannot be combined/);
});
