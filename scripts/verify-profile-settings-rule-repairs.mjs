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
const user = {
  id: 'student-test',
  name: '课程学生',
  email: null,
  phone: null,
  image: null,
  role: 'STUDENT',
  isActive: true,
};
const db = {
  user: {
    findUnique: async () => ({ ...user }),
    update: async ({ data }) => Object.assign(user, data),
  },
};
const auth = load('lib/server/auth.ts', {
  '@/lib/server/prisma-safe': { getOptionalPrisma: () => db, isDatabaseAvailable: () => true },
  '@/lib/server/password-hash': { verifyPassword: async () => true },
});
const me = load('app/api/me/route.ts', {
  '@/lib/server/auth': { requireServerSession: async () => ({ user: { id: user.id } }) },
  '@/lib/server/prisma': { prisma: db },
  '@/lib/profile/phone': { parsePhoneNumber: () => ({ ok: false }) },
});
assert.equal(
  (
    await me.PATCH(
      new Request('http://test/api/me', {
        method: 'PATCH',
        body: JSON.stringify({ name: '持久姓名' }),
      }),
    )
  ).status,
  200,
);
for (const authSource of ['speedup', undefined]) {
  const token = await auth.authOptions.callbacks.jwt({
    token: { sub: user.id, name: '课程学生', authSource },
  });
  assert.equal(token.name, '持久姓名', 'Reopened browser session must read saved database name');
  assert.equal(token.isActive, true);
}
assert.equal((await (await me.GET()).json()).name, '持久姓名');
console.log('PASS: saving profile survives stale JWT / SSO session and fresh profile read');
let access = true,
  roleAllowed = true,
  deletes = 0;
const rule = { id: 'rule-1', ownerId: 'teacher-test', courseId: 'course-test' };
const rules = load('app/api/teacher/courses/[courseId]/hard-rules/[ruleId]/route.ts', {
  '@/lib/server/course-hard-rules': { COURSE_HARD_RULE_MAX_CHARS: 1000 },
  '@/lib/server/json-error-response': { safeRoute: (fn) => fn() },
  '@/lib/server/teacher-auth': {
    requireTeacher: async () =>
      roleAllowed ? { userId: 'teacher-test' } : { response: new Response(null, { status: 403 }) },
  },
  '@/lib/server/external-course-access': { hasTeacherCourseAccess: async () => access },
  '@/lib/server/prisma': {
    prisma: {
      courseHardRule: {
        deleteMany: async ({ where }) => {
          assert.equal(where.ownerId, 'teacher-test');
          assert.equal(where.course.ownerId, 'teacher-test');
          const match = where.id === rule.id && where.courseId === rule.courseId;
          if (match) deletes++;
          return { count: Number(match) };
        },
      },
    },
  },
});
const remove = (courseId = 'course-test') =>
  rules.DELETE(new Request('http://test'), {
    params: Promise.resolve({ courseId, ruleId: rule.id }),
  });
access = false;
assert.equal((await remove()).status, 404);
assert.equal(deletes, 0);
access = true;
roleAllowed = false;
assert.equal((await remove()).status, 403);
assert.equal(deletes, 0);
roleAllowed = true;
assert.equal((await remove('other-course')).status, 404);
assert.equal(deletes, 0);
assert.equal((await remove()).status, 200);
assert.equal(deletes, 1);
console.log('PASS: hard-rule deletion rejects unauthorized and mismatched-course requests');

function settingsHarness(file, exportName, extra) {
  const slots = [];
  let cursor = 0;
  const store = {
    learnBackgroundId: 'a',
    live2dPresenterModelId: 'haru',
    live2dPresenterVisible: true,
    setLearnBackgroundId: (id) => {
      store.learnBackgroundId = id;
    },
    setLive2DPresenterModelId: (id) => {
      store.live2dPresenterModelId = id;
    },
    setLive2DPresenterVisible: (visible) => {
      store.live2dPresenterVisible = visible;
    },
  };
  const mod = load(file, {
    react: {
      ...require('react'),
      useState: (initial) => {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [
          slots[i],
          (v) => {
            slots[i] = v;
          },
        ];
      },
    },
    '@/lib/store/settings': { useSettingsStore: (fn) => fn(store) },
    '@/components/ui/button': { Button: 'button' },
    '@/lib/utils': { cn: (...args) => args.filter(Boolean).join(' ') },
    ...extra,
  });
  const render = () => {
    cursor = 0;
    return mod[exportName]({});
  };
  const nodes = (tree) => {
    const found = [];
    const walk = (v) => {
      if (!v || typeof v !== 'object') return;
      if (Array.isArray(v)) return v.forEach(walk);
      found.push(v);
      walk(v.props?.children);
    };
    walk(tree);
    return found;
  };
  return { store, render: () => nodes(render()) };
}
const backgrounds = settingsHarness(
  'components/settings/learn-background-settings.tsx',
  'LearnBackgroundSettings',
  {
    '@/components/learn/learn-background-visual': { LearnBackgroundVisual: 'preview' },
    '@/lib/learn/learn-backgrounds': {
      LEARN_BACKGROUNDS: [
        { id: 'a', name: 'A' },
        { id: 'b', name: 'B' },
      ],
    },
  },
);
backgrounds
  .render()
  .find((n) => n.key === 'b')
  .props.onClick();
assert.equal(backgrounds.store.learnBackgroundId, 'a');
backgrounds
  .render()
  .find((n) => n.props.children === '保存背景')
  .props.onClick();
assert.equal(backgrounds.store.learnBackgroundId, 'b');
assert.equal(backgrounds.render().find((n) => n.props.children === '已保存').props.disabled, true);
const companion = settingsHarness(
  'components/settings/live2d-presenter-settings-panel.tsx',
  'Live2dPresenterSettingsPanel',
  {
    '@/components/ui/label': { Label: 'label' },
    '@/components/ui/switch': { Switch: 'switch' },
    '@/lib/hooks/use-i18n': { useI18n: () => ({ t: (v) => v }) },
    '@/lib/live2d/presenter-models': {
      LIVE2D_PRESENTER_MODELS: { haru: { id: 'haru' }, mark: { id: 'mark' } },
    },
  },
);
companion
  .render()
  .find((n) => n.key === 'mark')
  .props.onClick();
companion
  .render()
  .find((n) => n.type === 'switch')
  .props.onCheckedChange(false);
assert.equal(companion.store.live2dPresenterModelId, 'haru');
assert.equal(companion.store.live2dPresenterVisible, true);
companion
  .render()
  .find((n) => n.props.children === '保存伴学角色')
  .props.onClick();
assert.equal(companion.store.live2dPresenterModelId, 'mark');
assert.equal(companion.store.live2dPresenterVisible, false);
console.log('PASS: background and companion changes remain drafts until Save');
