import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { flushProgressEntries } = await jiti.import('../../apps/native/src/data/progress-sync.ts');
const { setBrowserAccount } = await jiti.import('../../apps/native/src/data/browser-runtime.ts');
const { readCourseWithIndependentProgress } = await jiti.import(
  '../../apps/native/src/lib/course-progress-refresh.ts',
);
setBrowserAccount('fixture-account');

test('failed upload retains pending outbox and still reads new course version; retry removes only confirmed payload', async () => {
  const entries = new Map([
    [
      'sync.v2:fixture-account:progress:course:latest',
      JSON.stringify({ courseId: 'course', kind: 'notebook', notebookId: 'n' }),
    ],
  ]);
  const repo = {
    listSyncEntries: async (prefix) =>
      [...entries]
        .filter(([key]) => key.startsWith(prefix))
        .map(([key, value]) => ({ key, value })),
    removeSyncEntry: async (key, value) => {
      if (entries.get(key) === value) entries.delete(key);
    },
  };
  const errors = [];
  const remote = await readCourseWithIndependentProgress(
    () =>
      flushProgressEntries(repo, 'course', async () => {
        throw Error('offline');
      }),
    async () => ({ notebooks: [{ id: 'n', contentVersion: 18 }] }),
    (error) => errors.push(error.message),
  );
  assert.equal(remote.notebooks[0].contentVersion, 18);
  assert.deepEqual(errors, ['offline']);
  assert.equal(entries.size, 1);
  await flushProgressEntries(repo, 'course', async () => ({}));
  assert.equal(entries.size, 0);
});

test('course read failure still propagates and successful flush happens once', async () => {
  let calls = 0;
  await assert.rejects(
    readCourseWithIndependentProgress(
      async () => {
        calls++;
      },
      async () => {
        throw Error('read failed');
      },
      () => assert.fail(),
    ),
    /read failed/,
  );
  assert.equal(calls, 1);
});

test('a newer pending value is not removed when an earlier upload finishes', async () => {
  let value = JSON.stringify({ courseId: 'course', kind: 'not_started' });
  const repo = {
    listSyncEntries: async () => [{ key: 'k', value }],
    removeSyncEntry: async (_key, old) => {
      if (value === old) value = null;
    },
  };
  await flushProgressEntries(repo, 'course', async () => {
    value = JSON.stringify({ courseId: 'course', kind: 'completed_all' });
    return {};
  });
  assert.equal(JSON.parse(value).kind, 'completed_all');
});
