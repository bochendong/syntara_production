import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;

test('listing an empty account creates no course and hides only the earlier QA fixture', async () => {
  const courseRepository = moduleUrl(`
    let courses = [];
    export const created = [];
    export const createOwnedCourse = async (_, owner, data) => {
      created.push({owner,data});return {id:'created-course',...data,courseCode:null,updatedAt:new Date('2026-01-01')};
    };
    export const setCourses = rows => { courses = rows; };
    export const listAccessibleCoursesForUser = async () => courses;
    export const updateOwnedCourse = async () => { throw Error('Listing must not edit a course'); };
  `);
  const stubs = {
    zod: import.meta.resolve('zod'),
    '@/lib/server/native-browser-auth': moduleUrl(
      'export const nativeBrowserEnabled = () => true;',
    ),
    'next/server': moduleUrl('export const NextResponse = Response;'),
    '@/lib/course-space/course-display-name': moduleUrl(
      'export const normalizeCourseDisplay = course => course;',
    ),
    '@/lib/constants/course-avatars': moduleUrl(
      'export const pickStableCourseAvatarUrl = () => "fixture-avatar";',
    ),
    '@/lib/server/prisma-safe': moduleUrl(`
      export const getOptionalPrisma = () => ({
        user: { findUnique: async () => ({ email: 'fixture@example.invalid' }) },
        course: new Proxy({}, { get: () => () => { throw Error('Course listing must be read-only'); } }),
      });
    `),
    '@/lib/server/public-api': moduleUrl(`
      export const publicApiRequestId = () => 'fixture-request';
      export const requireNativePlatformApi = async () => ({ userId: 'new-user' });
      export const publicApiSuccess = (_, data) => Response.json({ ok: true, data });
      export const publicApiError = (_, status) => new Response(null, { status });
    `),
    '@/lib/server/repositories/course-repository': courseRepository,
    '@/lib/server/native-store': moduleUrl(
      'export const loadNativeCourseStoreMeta = async () => new Map();',
    ),
    '@/lib/server/course-removal': moduleUrl(
      'export const removeCourseForUser = async () => { throw Error("Listing must not remove a course"); };',
    ),
    '@/lib/server/native-staging-course': moduleUrl(
      compile(read('lib/server/native-staging-course.ts')),
    ),
  };
  let source = compile(read('app/api/native/v1/courses/route.ts'));
  for (const [specifier, replacement] of Object.entries(stubs))
    source = source.replaceAll(`'${specifier}'`, `'${replacement}'`);
  const { GET, POST } = await import(moduleUrl(source));
  const { setCourses, created } = await import(courseRepository);
  const originalEnv = {
    SYNTARA_APP_ENV: process.env.SYNTARA_APP_ENV,
    SYNTARA_NATIVE_ACCESS_POLICY: process.env.SYNTARA_NATIVE_ACCESS_POLICY,
  };
  try {
    process.env.SYNTARA_APP_ENV = 'staging';
    process.env.SYNTARA_NATIVE_ACCESS_POLICY = 'google-test';
    const empty = await GET(new Request('https://fixture.invalid/api/native/v1/courses'));
    assert.equal(empty.status, 200);
    assert.deepEqual((await empty.json()).data.courses, []);
    assert.equal(created.length, 0);
    const invalid = await POST(
      new Request('https://fixture.invalid/api/native/v1/courses', {
        method: 'POST',
        body: JSON.stringify({ name: '' }),
      }),
    );
    assert.equal(invalid.status, 400);
    assert.equal(created.length, 0);
    await POST(
      new Request('https://fixture.invalid/api/native/v1/courses', {
        method: 'POST',
        body: JSON.stringify({ name: 'My New Course', ownerId: 'other-user' }),
      }),
    );
    assert.equal(created.length, 1);
    assert.equal(created[0].owner, 'new-user');
    assert.equal(created[0].data.ownerId, undefined);
    const course = {
      id: 'real-course',
      name: 'My Course',
      courseCode: 'USER101',
      language: 'zh-CN',
      updatedAt: new Date('2026-01-01'),
      accessRole: 'owner',
    };
    setCourses([{ ...course, id: 'native-staging-new-user' }, course]);
    const existing = await GET(new Request('https://fixture.invalid/api/native/v1/courses'));
    assert.deepEqual(
      (await existing.json()).data.courses.map(({ id }) => id),
      ['real-course'],
    );
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
