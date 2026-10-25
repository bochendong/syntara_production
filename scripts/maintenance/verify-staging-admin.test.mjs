import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (file, replacements) => {
  let source = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries(replacements))
    source = source.replaceAll(`'${from}'`, `'${to}'`);
  return moduleUrl(source);
};

test('staging admin uses password authentication and rejects ordinary sessions and foreign cookies', async () => {
  // Execute the real password/session and permission handlers against disposable
  // identity/storage fixtures. This test never connects to a database or service.
  const stateUrl = moduleUrl(`
    export const state = { session: null, cookie: undefined };
    export const requireServerSession = async () => state.session;
    export const cookies = async () => ({
      get: () => state.cookie ? { value: state.cookie } : undefined,
      delete: () => { state.cookie = undefined; }
    });
    export const headers = async () => new Headers();
  `);
  const replacements = {
    'next/server': pathToFileURL(require.resolve('next/server.js')).href,
    'next/headers': stateUrl,
    '@/lib/server/auth': stateUrl,
    '@prisma/client': moduleUrl('export const Prisma = {};'),
    '@/lib/server/ensure-user': moduleUrl(
      'export const ensureUserForApi = async ({ userId }) => userId;',
    ),
    '@/lib/server/internal-request': moduleUrl(
      'export const isTrustedInternalHeaders = () => false;',
    ),
    '@/lib/server/prisma-safe': moduleUrl(
      'export const getOptionalPrisma = () => null; export const isDatabaseConfigured = () => false;',
    ),
  };
  const authUrl = compile('lib/server/admin-auth.ts', replacements);
  const { requireAdmin } = await import(authUrl);
  const sessionRoute = await import(
    compile('app/api/admin/session/route.ts', {
      ...replacements,
      '@/lib/server/admin-auth': authUrl,
    })
  );
  const { state } = await import(stateUrl);
  const fixtures = {
    NODE_ENV: 'production',
    ADMIN_LOGIN_EMAIL: 'admin@example.invalid',
    ADMIN_LOGIN_PASSWORD: 'disposable-test-password',
    ADMIN_LOGIN_SECRET: 'staging-only-test-signing-secret',
    ADMIN_EMAILS: 'admin@example.invalid',
    ADMIN_USER_IDS: '',
  };
  const before = Object.fromEntries(Object.keys(fixtures).map((key) => [key, process.env[key]]));
  const login = (password) =>
    sessionRoute.POST(
      new Request('https://staging.example.invalid/api/admin/session', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: fixtures.ADMIN_LOGIN_EMAIL, password }),
      }),
    );
  try {
    Object.assign(process.env, fixtures);
    assert.equal((await requireAdmin()).response.status, 401);
    assert.deepEqual(await (await sessionRoute.GET()).json(), { authenticated: false });

    state.session = { user: { id: 'ordinary-student', email: 'student@example.invalid' } };
    assert.equal((await requireAdmin()).response.status, 403);
    assert.deepEqual(await (await sessionRoute.GET()).json(), { authenticated: false });
    state.session = null;

    const rejected = await login('incorrect-password');
    assert.equal(rejected.status, 401);
    assert.equal(rejected.headers.get('set-cookie'), null);

    const accepted = await login(fixtures.ADMIN_LOGIN_PASSWORD);
    assert.equal(accepted.status, 200);
    const cookie = accepted.headers.get('set-cookie');
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /Secure/i);
    assert.match(cookie, /SameSite=lax/i);
    state.cookie = cookie.split(';')[0].split('=').slice(1).join('=');
    assert.equal((await requireAdmin()).identity.email, fixtures.ADMIN_LOGIN_EMAIL);
    assert.equal((await (await sessionRoute.GET()).json()).authenticated, true);

    process.env.ADMIN_LOGIN_SECRET = 'different-environment-signing-secret';
    assert.equal((await requireAdmin()).response.status, 401);
    process.env.ADMIN_LOGIN_SECRET = fixtures.ADMIN_LOGIN_SECRET;
    state.cookie += 'tampered';
    assert.equal((await requireAdmin()).response.status, 401);
  } finally {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
