import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createJiti } from 'jiti';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = new URL('../../', import.meta.url).pathname;
const jiti = createJiti(import.meta.url, {
  alias: { '@': root },
  fsCache: false,
  jsx: { runtime: 'automatic' },
});
const load = (file) => jiti.import(new URL('../../' + file, import.meta.url).href);
const endpoints = [
  ['claim', 'POST'],
  ['events', 'POST'],
  ['summary', 'GET'],
  ['rail-summary', 'GET'],
  ['gacha/draw', 'POST'],
  ['unlock-character', 'POST'],
  ['unlock-cosmetic', 'POST'],
  ['equip-character', 'POST'],
  ['select-preferred-character', 'POST'],
];
for (const [route, method] of endpoints) {
  const endpoint = await load(`app/api/gamification/${route}/route.ts`);
  const response = await endpoint[method](new Request('http://localhost/test', { method }));
  assert.equal(response.status, 410, route);
  assert.equal((await response.json()).success, false, route);
}
const admin = await load('app/api/admin/gamification/unlock-all/route.ts');
assert.equal((await admin.POST()).status, 410);

const milestone = await load('app/course/[id]/milestone/page.tsx');
await assert.rejects(
  () => milestone.default({ params: Promise.resolve({ id: 'course/1' }) }),
  (error) => error.digest?.includes('/course/course%2F1'),
);

const backfill = spawnSync(
  process.execPath,
  [new URL('./backfill-credits-to-500.mjs', import.meta.url).pathname, '--commit'],
  {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: 'postgresql://127.0.0.1:1/retired-fixture' },
  },
);
assert.equal(backfill.status, 1);
assert.match(backfill.stderr, /积分系统已退役/);

const { isCreditBillingEnabled } = await load('lib/server/credit-billing-policy.ts');
assert.equal(isCreditBillingEnabled(), false);
const credits = await load('lib/server/credits.ts');
const database = new Proxy(
  {},
  {
    get() {
      throw new Error('Retired credit operation touched the database');
    },
  },
);
assert.equal(await credits.ensureUserCreditsInitialized(database, 'fixture-user'), 0);
await assert.rejects(
  () => credits.applyCreditDelta(database, { userId: 'fixture-user', delta: 100 }),
  /积分系统已停用/,
);
await assert.rejects(
  () =>
    credits.convertCashCredits({ userId: 'fixture-user', amount: 1, targetAccountType: 'COMPUTE' }),
  /积分转换已停用/,
);

const frames = await load('lib/constants/user-avatar-frames.ts');
for (const frame of frames.USER_AVATAR_FRAME_OPTIONS) {
  assert.equal(frames.isValidUserAvatarFrameId(frame.id), true);
  assert.equal('requiredLevel' in frame, false);
}
const { ProfileAvatarFramePicker } = await load(
  'components/user-profile/profile-avatar-frame-picker.tsx',
);
const frameMarkup = renderToStaticMarkup(createElement(ProfileAvatarFramePicker));
assert.equal(
  (frameMarkup.match(/aria-pressed=/g) ?? []).length,
  frames.USER_AVATAR_FRAME_OPTIONS.length,
);
assert.equal(/未解锁|需要成长等级|购买积分/.test(frameMarkup), false);

const { REVIEW_ROUTE_TEMPLATES } = await load('features/review/domain/review-route-templates.ts');
for (const template of REVIEW_ROUTE_TEMPLATES) {
  for (const layer of template.layers) {
    for (const node of layer.nodes) {
      assert.equal(node.rewardPoints, 0, node.id);
      assert.equal(['reward_coin', 'multiplier'].includes(node.rewardKind), false, node.id);
    }
  }
}
const { reviewLearningDescription } = await load('lib/learning/review-learning-description.ts');
assert.equal(
  reviewLearningDescription('通关 +18 奖励积分，倍率 +0.2', '学习进度已保存'),
  '学习进度已保存',
);
assert.equal(reviewLearningDescription('练习定积分', 'fallback'), '练习定积分');

const previousWindow = globalThis.window;
const previousStorage = globalThis.localStorage;
try {
  globalThis.window = {};
  const stored = new Map();
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value),
  };
  const ids = { userId: 'fixture-user', notebookId: 'fixture-notebook', routeId: 'fixture-route' };
  const key = 'synatra-review-route-progress-v1:fixture-notebook:fixture-route:fixture-user';
  stored.set(
    key,
    JSON.stringify({
      ...ids,
      completedNodeIds: ['old-node'],
      withdrawnRewardPoints: 48,
      withdrawnBaseRewardPoints: 40,
      withdrawnMultiplier: 1.2,
      withdrawnAt: 100,
      updatedAt: 101,
    }),
  );
  const progress = await load('lib/learning/review-route-progress.ts');
  progress.markReviewRouteNodeCompleted({ ...ids, nodeId: 'new-node' });
  const saved = JSON.parse(stored.get(key));
  assert.deepEqual(saved.completedNodeIds, ['old-node', 'new-node']);
  assert.equal(saved.withdrawnRewardPoints, 48);
  assert.equal(saved.withdrawnAt, 100);
  assert.equal('withdrawReviewRouteReward' in progress, false);
} finally {
  globalThis.window = previousWindow;
  globalThis.localStorage = previousStorage;
}
console.log(
  'PASS: 10 retired endpoints, no credit mutations, unrestricted frames, zero review currency, legacy progress preserved.',
);
