import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';
import { NextRequest } from 'next/server.js';

const root = path.resolve(import.meta.dirname, '../..');
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const { middleware } = jiti('../../middleware.ts');

test('staging exposes its store and protected admin handlers while keeping unrelated routes closed', () => {
  const before = process.env.SYNTARA_APP_ENV;
  process.env.SYNTARA_APP_ENV = 'staging';
  try {
    for (const route of [
      '/download',
      '/download/',
      '/api/downloads/macos',
      '/store/courses',
      '/store/courses/course-one',
      '/api/courses/store',
      '/api/courses/store/course-one',
      '/api/courses/store/course-one/reviews',
      '/api/courses/clone',
      '/api/native/v1/onboarding',
      '/admin',
      '/admin/',
      '/admin?section=llm',
      '/admin/courses/course-one',
      '/api/admin/session',
      '/api/admin/llm-config',
      '/api/admin/courses',
      '/api/admin/courses/course-one/export',
    ])
      assert.equal(
        middleware(new NextRequest(`https://fixture.invalid${route}`)).status,
        200,
        route,
      );
    for (const route of [
      '/download/private',
      '/api/downloads/private',
      '/admin/mock',
      '/administer',
      '/api/administrator',
      '/api/courses',
      '/learn',
      '/chat',
      '/api/courses/private-course/materials',
    ])
      assert.equal(
        middleware(new NextRequest(`https://fixture.invalid${route}`)).status,
        404,
        route,
      );
    const app = middleware(new NextRequest('https://fixture.invalid/test/app'));
    assert.equal(
      new URL(app.headers.get('x-middleware-rewrite')).pathname,
      '/native-web/index.html',
    );
  } finally {
    if (before === undefined) delete process.env.SYNTARA_APP_ENV;
    else process.env.SYNTARA_APP_ENV = before;
  }
});
