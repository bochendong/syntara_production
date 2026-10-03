import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith('@/')) throw new Error(`Missing mock: ${id}`);
      return require(id);
    },
    mod,
    mod.exports,
  );
  return mod.exports;
}

const phone = load('lib/profile/phone.ts');
let current = { id: 'student-test', name: '自选昵称', phone: '+14165550101', role: 'STUDENT' };
let existing = true;
let updates = 0;
const db = {
  user: {
    findUnique: async () => current,
    update: async ({ data }) => {
      updates++;
      return Object.assign(current, data);
    },
    create: async ({ data }) => {
      current = { id: 'new-student', ...data };
      return current;
    },
  },
  account: {
    findUnique: async () =>
      existing ? { id: 'account', userId: current.id, user: current } : null,
    update: async () => ({}),
  },
  $transaction: async (queries) => Promise.all(queries),
};
let session = { user: { id: current.id, role: 'TEACHER' } }; // Stale/forged role must not bypass DB policy.
const me = load('app/api/me/route.ts', {
  '@/lib/server/auth': { requireServerSession: async () => session },
  '@/lib/server/prisma': { prisma: db },
  '@/lib/profile/phone': phone,
});
const patch = (data) =>
  me.PATCH(
    new Request('https://example.test/api/me', {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  );
for (const value of ['+14165550202', '', null]) {
  assert.equal((await patch({ phone: value })).status, 403);
}
assert.equal(updates, 0);
assert.equal((await patch({ name: '保留昵称' })).status, 200);
assert.equal((await (await me.GET()).json()).phoneEditable, false);
current.role = 'USER';
assert.equal((await patch({ phone: '+14165550202' })).status, 403);
current.role = 'TEACHER';
assert.equal((await patch({ phone: '+14165550202' })).status, 200);
assert.equal((await (await me.GET()).json()).phoneEditable, true);
session = null;
assert.equal((await patch({ phone: '+14165550202' })).status, 401);
process.env.NEXTAUTH_SECRET = 'test-only';
process.env.SPEEDUP_API_BASE_URL = 'https://speedup.example.test/';
process.env.SPEEDUP_SSO_CLIENT_ID = 'test-only';
process.env.SPEEDUP_SSO_CLIENT_SECRET = 'test-only';
const sso = load('lib/server/speedup-sso.ts', {
  '@/lib/profile/phone': phone,
  '@/lib/course-space/course-display-name': { courseDisplayCode: () => 'TEST' },
  '@/lib/server/prisma-safe': { getOptionalPrisma: () => db },
  'next-auth/jwt': { encode: async () => 'test-session' },
});
const base = {
  Token: 'test-only',
  UserId: 'test-user',
  StudentId: 'test-student',
  DisplayName: '外部昵称',
};
let exchange = base;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) =>
  Response.json(
    String(url).includes('ExchangeToken')
      ? exchange
      : [{ CourseId: 'course', UniversityAbbrs: 'TEST', CourseName: 'Test' }],
  );
try {
  for (const key of [
    'PhoneNumber',
    'phoneNumber',
    'Phone',
    'phone',
    'MobilePhone',
    'mobilePhone',
    'Mobile',
    'mobile',
  ]) {
    exchange = { ...base, [key]: '+1 (416) 555-0303' };
    const identity = await sso.verifySpeedupCallback('test-ticket', 'course');
    assert.equal(identity.phone, '+14165550303');
    await sso.createSpeedupUserSession(identity);
    assert.equal(current.phone, '+14165550303');
    assert.equal(current.name, '保留昵称');
  }
  for (const value of [undefined, null, '', 'invalid']) {
    exchange = { ...base, PhoneNumber: value };
    const identity = await sso.verifySpeedupCallback('test-ticket', 'course');
    assert.equal(identity.phone, null);
    await sso.createSpeedupUserSession(identity);
    assert.equal(current.phone, '+14165550303');
  }
  existing = false;
  exchange = { ...base, PhoneNumber: '13800138000' };
  await sso.createSpeedupUserSession(await sso.verifySpeedupCallback('test-ticket', 'course'));
  assert.equal(current.phone, '13800138000');
  session = { user: { id: current.id } };
  const profile = await (await me.GET()).json();
  assert.equal(profile.phone, '13800138000');
  assert.equal(profile.phoneEditable, false);
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  'PASS: SSO phone parsing, new/existing account sync, missing/invalid preservation, profile GET, student API denial, teacher editing and unauthenticated denial',
);

// Render the actual component with a server profile and a conflicting cached phone.
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
for (const layout of ['row', 'stacked']) {
  for (const loadedProfile of [{ phone: '+14165550303', phoneEditable: false }, null]) {
    let stateIndex = 0;
    const states = [false, 'cached-phone', false, '', loadedProfile];
    const component = load('components/user-profile/profile-phone-editor.tsx', {
      react: { ...React, useEffect: () => {}, useState: () => [states[stateIndex++], () => {}] },
      'next-auth/react': { useSession: () => ({ status: 'authenticated' }) },
      '@/components/ui/button': { Button: 'button' },
      '@/components/ui/input': { Input: 'input' },
      '@/lib/profile/phone': phone,
      '@/lib/store/user-profile': {
        useUserProfileStore: (selector) => selector({ phone: 'cached-phone', setPhone: () => {} }),
      },
      '@/lib/utils/backend-api': { backendJson: () => {} },
      '@/lib/utils': { cn: (...classes) => classes.filter(Boolean).join(' ') },
    });
    const html = renderToStaticMarkup(
      React.createElement(component.ProfilePhoneEditor, { layout }),
    );
    assert.ok(!html.includes('<button'));
    assert.ok(!html.includes('<input'));
    assert.ok(!html.includes('cached-phone'));
    assert.ok(html.includes(loadedProfile ? '+14165550303' : '加载中'));
    assert.ok(html.includes('不可自行修改'));
  }
}
console.log(
  'PASS: both profile layouts show the server phone read-only and hide stale cached values while loading',
);
