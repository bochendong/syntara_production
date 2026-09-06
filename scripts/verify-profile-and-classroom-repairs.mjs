import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function load(file, mocks = {}) {
  const code = ts.transpileModule(readFileSync(resolve(file), 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: file,
  }).outputText;
  const localModule = { exports: {} };
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id in mocks) return mocks[id];
      if (id.startsWith('@/')) throw new Error(`Unmocked dependency: ${id}`);
      return require(id);
    },
    localModule,
    localModule.exports,
  );
  return localModule.exports;
}
const phone = load('lib/profile/phone.ts');
const student = { id: 'student-1', name: '课程同学', email: null, phone: '+14165559875' };
let rows = [{ user: student }];
const db = {
  externalCourseBinding: { findUnique: async () => ({ id: 'binding-bus' }) },
  courseEnrollment: {
    findMany: async ({ where, select }) => {
      assert.equal(where.courseId, 'bus');
      assert.equal(where.user.isActive, true);
      assert.deepEqual(where.user.externalCourseMemberships.some, {
        bindingId: 'binding-bus',
        role: 'STUDENT',
        active: true,
      });
      assert.equal(select.user.select.phone, true);
      return rows;
    },
  },
  courseForumPost: { findMany: async () => [] },
};
const insights = load('lib/server/course-agent-learner-insights.ts', {
  '@/lib/profile/phone': phone,
  '@/lib/server/repositories/course-enrollment-repository': {},
  '@/lib/server/memory-learner-analytics': { buildLearnerAnalytics: async () => ({}) },
  '@/features/teacher-analytics/server/course-learning-analytics': {
    loadCourseStudentLearningDetail: async () => null,
  },
});
const lookup = (studentQuery) =>
  insights.loadTeacherStudentInsight({
    prisma: db,
    courseId: 'bus',
    studentQuery,
    focus: 'all',
    timeScope: 'all',
  });
for (const query of [
  '9875',
  '帮我找一下手机尾号9875的同学',
  '手机号后四位是９８７５',
  'phone ending in 9875',
]) {
  const result = await lookup(query);
  assert.equal(result.found, true, query);
  assert.equal(result.student.phoneLast4, '9875');
  assert.equal('phone' in result.student, false);
  assert.ok(!JSON.stringify(result).includes(student.phone));
}
assert.equal((await lookup('0000')).found, false);
assert.equal((await lookup('')).found, false);
rows = [{ user: student }, { user: { ...student, id: 'student-2', name: '同尾号同学' } }];
const ambiguous = await lookup('尾号9875');
assert.equal(ambiguous.found, false);
assert.equal(ambiguous.candidates.length, 2);
rows = [{ user: student }];

// Execute the real profile PATCH, then resolve the teacher's fresh roster.
const me = load('app/api/me/route.ts', {
  '@/lib/server/auth': { requireServerSession: async () => ({ user: { id: student.id } }) },
  '@/lib/server/prisma': {
    prisma: {
      user: {
        update: async ({ where, data }) => {
          assert.equal(where.id, student.id);
          Object.assign(student, data);
          return { ...student };
        },
      },
    },
  },
  '@/lib/profile/phone': phone,
});
const response = await me.PATCH(
  new Request('https://example.test/api/me', {
    method: 'PATCH',
    body: JSON.stringify({ name: '  小林  ' }),
  }),
);
assert.equal(response.status, 200);
assert.equal((await lookup('小林')).student.name, '小林');
assert.equal((await lookup('课程同学')).found, false);

const ssoDb = {
  account: {
    findUnique: async () => ({ id: 'account-1', userId: student.id, user: { name: student.name } }),
    update: async () => ({}),
  },
  user: {
    update: async ({ data }) => {
      assert.equal('name' in data, false);
      Object.assign(student, data);
      return student;
    },
  },
  $transaction: async (queries) => Promise.all(queries),
};
process.env.NEXTAUTH_SECRET = 'test-only-no-production-secret';
const sso = load('lib/server/speedup-sso.ts', {
  'next-auth/jwt': {
    encode: async ({ token }) => {
      assert.equal(token.name, '小林');
      return 'test-session';
    },
  },
  '@/lib/server/prisma-safe': { getOptionalPrisma: () => ssoDb },
});
await sso.createSpeedupUserSession({
  externalUserId: 'speedup-student',
  name: '课程同学',
  role: 'STUDENT',
  expiresIn: 600,
  accessToken: 'test-only',
});
assert.equal(student.name, '小林');

const ensureDb = {
  user: {
    findUnique: async () => ({ id: student.id, name: student.name }),
    upsert: async ({ update }) => {
      assert.equal('name' in update, false);
    },
    updateMany: async () => {
      throw new Error('Stale session overwrote the saved name');
    },
  },
};
const ensure = load('lib/server/ensure-user.ts', {
  '@/lib/logger': { createLogger: () => ({ warn() {} }) },
  '@/lib/server/prisma-safe': { getOptionalPrisma: () => ensureDb },
  '@/lib/server/credits': { ensureUserCreditsInitialized: async () => undefined },
});
await ensure.ensureUserForApi({ userId: student.id, name: '课程同学' });
await ensure.ensureUserForApi({ userId: student.id, name: '课程同学', email: 'test@example.test' });

// All three editors use this real save hook. Failed persistence must never
// publish a locally successful name; a second click cannot send two PATCHes.
let updates = [];
let savedName = '小林';
let rejectSave = false;
let completeSave;
const hook = load('lib/hooks/use-profile-name.ts', {
  react: { useRef: (current) => ({ current }), useState: (value) => [value, () => {}] },
  'next-auth/react': {
    useSession: () => ({
      status: 'authenticated',
      data: { user: { id: student.id } },
      update: async () => undefined,
    }),
  },
  '@/lib/store/auth': {
    useAuthStore: { getState: () => ({ userId: student.id }), setState: () => {} },
  },
  '@/lib/store/user-profile': {
    useUserProfileStore: {
      getState: () => ({
        setAccountNickname: (_id, name) => {
          savedName = name;
        },
      }),
    },
  },
  '@/lib/utils/backend-api': {
    backendJson: async (_path, init) => {
      updates.push(JSON.parse(init.body));
      if (rejectSave) throw new Error('offline');
      await new Promise((done) => {
        completeSave = done;
      });
      return { id: student.id, name: '林同学' };
    },
  },
}).useProfileName();
const firstSave = hook.saveName('林同学');
assert.equal(await hook.saveName('重复点击'), false);
assert.equal(savedName, '小林');
completeSave();
assert.equal(await firstSave, true);
assert.equal(savedName, '林同学');
assert.equal(updates.length, 1);
rejectSave = true;
await assert.rejects(hook.saveName('失败的修改'), /offline/);
assert.equal(savedName, '林同学');
await assert.rejects(hook.saveName(' '), /姓名/);
for (const file of [
  'components/user-profile/profile-card.tsx',
  'components/create/greeting-bar.tsx',
  'components/learn/learn-home-dock-apps.tsx',
]) {
  assert.match(readFileSync(file, 'utf8'), /await saveName\(/);
}
console.log(
  'PASS profile persistence, teacher lookup, phone privacy/ambiguity, SSO and stale-session preservation, duplicate/error saves',
);

// Run the real dispatcher with route-boundary doubles. No local HTTP listener
// exists; a regression to fetch(localhost) fails this test immediately.
const { NextRequest } = require('next/server');
const calls = [];
const route = (path) => ({
  POST: async (request) => {
    calls.push({ path, headers: request.headers, body: await request.json() });
    return Response.json({ success: true, path });
  },
});
const dispatcher = load('features/ppt-generation/server/notebook-generation-dispatch.ts', {
  '@/lib/create/api-errors': { readApiErrorMessage: async (r) => (await r.json()).error },
  '@/app/api/generate/image/route': route('image'),
  './scene-content-route': route('content'),
  './scene-actions-route': route('actions'),
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error('Unexpected HTTP call to localhost');
};
try {
  for (const path of [
    '/api/generate/image',
    '/api/generate/scene-content',
    '/api/generate/scene-actions',
  ]) {
    await dispatcher.postNotebookGenerationJson(
      new NextRequest('http://localhost/api/learn/mini-lectures'),
      path,
      { question: '机会成本' },
      new Headers({ 'x-user-id': 'student-1', 'x-syntara-internal-secret': 'test-only' }),
    );
  }
  assert.deepEqual(
    calls.map((call) => call.path),
    ['image', 'content', 'actions'],
  );
  assert.ok(calls.every((call) => call.headers.get('x-user-id') === 'student-1'));
  assert.ok(calls.every((call) => call.headers.get('x-syntara-internal-secret') === 'test-only'));
  await dispatcher.postNotebookGenerationJson(
    new NextRequest('http://localhost/api/learn/mini-lectures'),
    '/api/generate/image',
    {},
    new Headers(),
  );
  assert.equal(calls.at(-1).headers.get('x-syntara-internal-secret'), null);
} finally {
  globalThis.fetch = originalFetch;
}
console.log(
  'PASS in-process image/content/action dispatch with preserved trust boundaries and no localhost HTTP',
);

const domain = load('features/native-api/domain/mini-lecture.ts');
const imageConstants = {
  NOTEBOOK_IMAGE2_MODEL_ID: 'gpt-image-2',
  NOTEBOOK_IMAGE2_PROVIDER_ID: 'openai-image',
};
const service = load('features/native-api/server/mini-lecture-service.ts', {
  '@/lib/generation/image-notebook-quality': {
    IMAGE_NOTEBOOK_CANVAS_WIDTH: 1000,
    IMAGE_NOTEBOOK_CANVAS_HEIGHT: 562.5,
  },
  '@/lib/generation/notebook-page-content': imageConstants,
  '@/lib/audio/tts-providers': { OPENAI_TTS_MODEL_ID: 'gpt-4o-mini-tts' },
  '@/lib/audio/spoken-text': {},
  '@/lib/server/internal-request': { isTrustedInternalHeaders: () => true },
  '@/lib/server/provider-config': {},
  '@/lib/server/resolve-model': {},
  '@/lib/server/system-llm-config': {},
  '@/features/ppt-generation/server/notebook-page-content-route': {},
  '@/features/ppt-generation/server/scene-actions-route': {},
  '@/features/native-api/domain/mini-lecture': domain,
});
const pageAttempts = [];
const actionAttempts = [];
let speechCount = 0;
const input = domain.nativeMiniLectureRequestSchema.parse({
  course: { id: 'bus', name: 'BUS200' },
  message: '讲解机会成本',
  answer:
    '机会成本是为了获得一个选择而放弃的最佳替代选择的价值。例如选择读书而放弃兼职，放弃的工资就是机会成本的一部分。',
  pageCount: 1,
  idempotencyKey: 'incident-regression',
});
const generated = await service.generateNativeMiniLecture({
  input,
  context: {
    requestUrl: 'http://localhost/api/learn/mini-lectures',
    headers: new Headers({ 'x-user-id': student.id }),
  },
  dependencies: {
    resolveActionModel: async () => 'test-action-model',
    generatePage: async ({ outline, generationAttempt }) => {
      pageAttempts.push(generationAttempt);
      if (generationAttempt === 1) return { success: true };
      const components = outline.imageNotebookBrief.componentPlans.map((c) => ({
        ...c,
        participatesInMask: true,
      }));
      const regions = components.map((c, i) => ({
        id: c.id,
        label: c.label,
        role: c.role,
        order: i,
        left: 20,
        top: 20 + i * 150,
        width: 250,
        height: 100,
      }));
      const recovered = {
        ...outline,
        imageNotebookBrief: { ...outline.imageNotebookBrief, focusRegions: regions },
        imageNotebookPromptPlan: {
          componentPlans: components,
          recoveryResult: {
            status: 'passed',
            recoveredAt: new Date().toISOString(),
            components: components.map((c) => ({
              componentId: c.id,
              markerCount: 4,
              bbox: [20, 20, 250, 100],
            })),
          },
        },
      };
      return {
        success: true,
        contentBundle: { contents: [{}], effectiveOutlines: [recovered] },
        image: {
          providerId: 'openai-image',
          modelId: 'gpt-image-2',
          imageResult: {
            base64:
              'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZYkAAAAASUVORK5CYII=',
            width: 1792,
            height: 1008,
          },
        },
      };
    },
    generateActions: async ({ outline, generationAttempt }) => {
      actionAttempts.push(generationAttempt);
      return {
        success: true,
        scene: {
          actions:
            generationAttempt === 1
              ? []
              : outline.imageNotebookBrief.focusRegions.flatMap((region) => [
                  { type: 'spotlight', elementId: region.id },
                  { type: 'speech', text: '机会成本是所放弃的最佳替代方案的价值。' },
                ]),
        },
      };
    },
    synthesizeSpeech: async () => {
      speechCount += 1;
      return { format: 'mp3', audio: Buffer.from('ID3-test-audio') };
    },
  },
});
assert.deepEqual(pageAttempts, [1, 2]);
assert.deepEqual(actionAttempts, [1, 2]);
assert.equal(generated.manifest.status, 'ready');
assert.equal(generated.manifest.pages.length, 1);
assert.ok(speechCount > 0);
assert.ok(
  generated.manifest.pages[0].actions
    .filter((a) => a.type === 'speech')
    .every((a) => a.audio.mimeType === 'audio/mpeg' && a.audio.base64),
);
console.log(
  'PASS classroom page recovery retries, action retries, spotlight coverage, MP3 narration and ready manifest',
);
