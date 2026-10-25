import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;

test('course removal keeps managed courses safe and removes only the current learner enrollment', async () => {
  const accessModule = moduleUrl(`
    export let role = null;
    export const calls = [];
    export const setRole = value => { role = value; calls.length = 0; };
    export const findCourseAccessRole = async (_, userId, courseId) => {
      calls.push(['access', userId, courseId]); return role;
    };
    export const removeCourseEnrollmentForUser = async (_, userId, courseId) => {
      calls.push(['enrollment', userId, courseId]); return 1;
    };
    export const deleteOwnedCourseWithNotebooks = async (_, userId, courseId) => {
      calls.push(['delete-owned', userId, courseId]);
    };
    export const recordTutorialStep = async (_, userId, courseId, step) => {
      calls.push(['tutorial', userId, courseId, step]);
    };
  `);
  let source = ts.transpileModule(
    readFileSync(new URL('../../lib/server/course-removal.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  for (const name of [
    '@/lib/server/repositories/course-enrollment-repository',
    '@/lib/server/repositories/course-repository',
    '@/lib/server/onboarding',
  ]) {
    source = source.replaceAll(`'${name}'`, `'${accessModule}'`);
  }
  const { removeCourseForUser } = await import(moduleUrl(source));
  const { calls, setRole } = await import(accessModule);
  let managed = false;
  const purchaseRemovals = [];
  const prisma = {
    externalCourseBinding: { findUnique: async () => (managed ? { id: 'binding' } : null) },
    $transaction: async (run) =>
      run({
        coursePurchase: {
          deleteMany: async (query) => {
            purchaseRemovals.push(query);
            return { count: 1 };
          },
        },
      }),
  };

  assert.deepEqual(await removeCourseForUser(prisma, 'learner', 'course'), {
    status: 'not_found',
  });
  assert.deepEqual(calls, [['access', 'learner', 'course']]);

  setRole('owner');
  managed = true;
  assert.equal((await removeCourseForUser(prisma, 'learner', 'course')).status, 'locked');
  assert.equal(
    calls.some(([action]) => action === 'delete-owned'),
    false,
  );

  setRole('owner');
  managed = false;
  assert.deepEqual(await removeCourseForUser(prisma, 'learner', 'course'), { status: 'deleted' });
  assert.deepEqual(calls.at(-1), ['delete-owned', 'learner', 'course']);
  assert.equal(purchaseRemovals.length, 0);

  setRole('enrolled');
  assert.deepEqual(await removeCourseForUser(prisma, 'learner', 'store-course'), {
    status: 'removed',
  });
  assert.equal(
    calls.some(([action]) => action === 'delete-owned'),
    false,
  );
  assert.deepEqual(purchaseRemovals, [
    { where: { buyerId: 'learner', sourceCourseId: 'store-course' } },
  ]);
  assert.deepEqual(calls.at(-1), ['tutorial', 'learner', 'store-course', 'delete']);
});
