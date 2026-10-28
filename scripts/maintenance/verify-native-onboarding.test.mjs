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

const { createOnboardingStore } = await import(
  moduleUrl(compile(read('lib/onboarding/spotlight.ts')))
);

test('restoring a dismissed tutorial publishes the saved account progress', async () => {
  for (const status of ['done', 'skipped']) {
    const restored = { status: 'active', completed: ['course'], next: 'store' };
    const actions = [];
    const store = createOnboardingStore({
      available: () => true,
      load: async () => ({ status, completed: [], next: null }),
      act: async (input) => {
        actions.push(input);
        return restored;
      },
    });
    await store.load();
    let changes = 0;
    store.subscribe(() => changes++);
    await store.restart();
    assert.deepEqual(actions, [{ action: 'restart' }]);
    assert.deepEqual(store.snapshot(), restored);
    assert.equal(changes, 1);
  }
});

test('failed tutorial restore keeps the current state and allows retry', async () => {
  const dismissed = { status: 'skipped', completed: [], next: null };
  const restored = { status: 'active', completed: [], next: 'course' };
  let failing = true;
  const store = createOnboardingStore({
    available: () => true,
    load: async () => dismissed,
    act: async () => {
      if (failing) throw new Error('Offline');
      return restored;
    },
  });
  await store.load();
  await assert.rejects(store.restart(), /Offline/);
  assert.deepEqual(store.snapshot(), dismissed);
  failing = false;
  await store.restart();
  assert.deepEqual(store.snapshot(), restored);
});

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
      compile(read('lib/course-space/course-display-name.ts')),
    ),
    '@/lib/constants/course-avatars': moduleUrl(
      'export const pickRandomCourseAvatarUrl = () => "fixture-avatar"; export const pickStableCourseAvatarUrl = () => "fixture-avatar";',
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

test('an account reset ignores a previous account response still in flight', async () => {
  let release;
  let calls = 0;
  const store = createOnboardingStore({
    available: () => true,
    load: () =>
      ++calls === 1
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({ status: 'skipped', completed: [], next: null }),
    act: async () => {
      throw Error('not used');
    },
  });
  const old = store.load();
  store.reset();
  await store.load();
  release({ status: 'active', completed: ['course'], next: 'store' });
  await old;
  assert.equal(store.snapshot().status, 'skipped');
});

test('finishing the new tour does not require creating or deleting a course', async () => {
  const actions = [];
  const store = createOnboardingStore({
    available: () => true,
    load: async () => ({ status: 'skipped', completed: ['store', 'ask'], next: null }),
    act: async (input) => {
      actions.push(input);
      return { status: 'done', completed: ['store', 'ask'], next: null };
    },
  });
  await store.load();
  await store.finish();
  assert.deepEqual(actions, [{ action: 'finish' }]);
  assert.deepEqual(store.snapshot(), { status: 'done', completed: ['store', 'ask'], next: null });
});

test('server keeps existing completion and supports finish and restart without deleting data', async () => {
  const stubs = {
    '@/lib/server/platform-tutorial': moduleUrl(
      'export const ensurePlatformTutorial = async () => {};',
    ),
    '@/lib/onboarding/spotlight': moduleUrl(compile(read('lib/onboarding/spotlight.ts'))),
  };
  let source = compile(read('lib/server/onboarding.ts'));
  for (const [name, url] of Object.entries(stubs))
    source = source.replaceAll(`'${name}'`, `'${url}'`);
  const { getOnboardingState, updateOnboarding } = await import(moduleUrl(source));
  let value = { status: 'done', marks: { store: 'before' }, finishedAt: 'before' };
  const prisma = {
    user: {
      findUnique: async () => ({ onboarding: value }),
      update: async ({ data }) => {
        value = structuredClone(data.onboarding);
      },
    },
    course: { findFirst: async () => null },
    courseEnrollment: { findFirst: async () => null },
    courseConversation: { findFirst: async () => null },
  };
  assert.equal((await getOnboardingState(prisma, 'learner')).status, 'done');
  assert.equal(value.finishedAt, 'before');
  assert.equal((await updateOnboarding(prisma, 'learner', { action: 'restart' })).status, 'active');
  assert.deepEqual(value.marks, {});
  const done = await updateOnboarding(prisma, 'learner', { action: 'finish' });
  assert.equal(done.status, 'done');
  assert.equal(done.next, null);
  assert.deepEqual(done.completed, []);
});

test('display examples are scoped to the platform course and identify themselves as examples', async () => {
  const content = moduleUrl(compile(read('lib/onboarding/tutorial-content.ts')));
  const shared = moduleUrl(compile(read('lib/onboarding/spotlight.ts')));
  const source = compile(read('apps/native/src/lib/tutorial-memory-samples.ts'))
    .replaceAll("'../../../../lib/onboarding/tutorial-content'", `'${content}'`)
    .replaceAll("'../../../../lib/onboarding/spotlight'", `'${shared}'`);
  const { tutorialMemorySamplesForView } = await import(moduleUrl(source));
  assert.deepEqual(tutorialMemorySamplesForView('real-course'), []);
  const samples = tutorialMemorySamplesForView('syntara-tutorial');
  assert.equal(samples.length, 5);
  assert.equal(new Set(samples.map((x) => x.kind)).size, 5);
  assert.ok(samples.every((x) => x.title.startsWith('示例') && x.reason.includes('不代表')));
});

test('tutorial upgrade is idempotent and confined to the platform-owned fixed course', async () => {
  const stubs = {
    '@/lib/constants/course-avatars': moduleUrl(
      'export const pickStableCourseAvatarUrl = () => "avatar";',
    ),
    '@/lib/onboarding/spotlight': moduleUrl(compile(read('lib/onboarding/spotlight.ts'))),
    '@/lib/onboarding/tutorial-content': moduleUrl(
      compile(read('lib/onboarding/tutorial-content.ts')),
    ),
  };
  let source = compile(read('lib/server/platform-tutorial.ts'));
  for (const [name, url] of Object.entries(stubs))
    source = source.replaceAll(`'${name}'`, `'${url}'`);
  const { ensurePlatformTutorial } = await import(moduleUrl(source));
  const writes = [];
  const tx = Object.fromEntries(
    [
      'user',
      'organization',
      'organizationMember',
      'course',
      'notebook',
      'markdownNotebookSection',
    ].map((name) => [
      name,
      {
        upsert: async (arg) => {
          writes.push({ name, arg });
        },
      },
    ]),
  );
  const prisma = {
    course: {
      findUnique: async () => ({
        id: 'syntara-tutorial',
        ownerId: 'syntara-platform',
        tags: ['教程'],
      }),
    },
    $transaction: async (fn) => fn(tx),
  };
  await ensurePlatformTutorial(prisma);
  await ensurePlatformTutorial(prisma);
  assert.equal(writes.filter((x) => x.name === 'course').length, 1);
  assert.equal(writes.filter((x) => x.name === 'markdownNotebookSection').length, 5);
  const course = writes.find((x) => x.name === 'course').arg;
  assert.equal(course.where.id, 'syntara-tutorial');
  assert.equal(course.update.name, 'Syntara 演示课程');
  assert.ok(!('ownerId' in course.update));
});

test('detailed guide checkpoints remain isolated by account and reset on replay', async () => {
  const storeUrl = moduleUrl(
    `export const onboardingStore={finish:async()=>{}}; export const PLATFORM_TUTORIAL_COURSE_ID='syntara-tutorial';`,
  );
  const source = compile(read('apps/native/src/lib/onboarding-guide.ts')).replaceAll(
    "'./onboarding'",
    `'${storeUrl}'`,
  );
  const guide = await import(moduleUrl(source));
  const oldWindow = globalThis.window;
  const oldStorage = globalThis.localStorage;
  const values = new Map();
  globalThis.window = new EventTarget();
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const active = { status: 'active', completed: [], next: 'course' };
  try {
    guide.configureGuide('account-a', active);
    guide.guideCourseCreated('owned-a');
    assert.equal(guide.getGuideStep(), 'upload');
    guide.configureGuide('account-b', active);
    assert.equal(guide.getGuideStep(), 'welcome');
    assert.equal(guide.getGuideCourseId(), 'syntara-tutorial');
    guide.configureGuide('account-a', active);
    assert.equal(guide.getGuideStep(), 'upload');
    assert.equal(guide.getGuideCourseId(), 'owned-a');
    guide.configureGuide('account-a', active, true);
    assert.equal(guide.getGuideStep(), 'welcome');
    assert.equal(guide.getGuideCourseId(), 'syntara-tutorial');
  } finally {
    globalThis.window = oldWindow;
    globalThis.localStorage = oldStorage;
  }
});

test('the tutorial remains directly obtainable among a large real-world catalog during onboarding', async () => {
  const shared = moduleUrl(compile(read('lib/onboarding/spotlight.ts')));
  const source = compile(read('lib/onboarding/store-featured.ts')).replaceAll(
    "'./spotlight'",
    `'${shared}'`,
  );
  const { onboardingFeaturedCourses } = await import(moduleUrl(source));
  const popular = Array.from({ length: 27 }, (_, i) => ({ id: `course-${i}` }));
  const tutorial = { id: 'syntara-tutorial' };
  const ranked = [...popular, tutorial];
  assert.equal(onboardingFeaturedCourses(ranked, true)[0], tutorial);
  assert.equal(onboardingFeaturedCourses(ranked, true).length, 5);
  assert.deepEqual(onboardingFeaturedCourses(ranked, false), popular.slice(0, 5));
  assert.equal(ranked.at(-1), tutorial);
  assert.equal(onboardingFeaturedCourses(popular, true).length, 5);
});
