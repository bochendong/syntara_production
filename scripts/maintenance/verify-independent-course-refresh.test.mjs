import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { independentCourseRefresh } = await jiti.import(
  '../../apps/native/src/lib/independent-course-refresh.ts',
);
const { singleFlight } = await jiti.import('../../apps/native/src/lib/single-flight.ts');

for (const failing of [null, 'conversations', 'content', 'problems']) {
  test(`course sources remain independent when ${failing ?? 'nothing'} fails`, async () => {
    const calls = [];
    const errors = [];
    const task = (name, value) => async () => {
      calls.push(name);
      if (name === failing) throw Error(name);
      return value;
    };
    const result = await independentCourseRefresh({
      problems: task('problems', true),
      conversations: task('conversations', { changed: true }),
      content: task('content', { notebooks: true }),
      onError: (name) => errors.push(name),
    });
    assert.deepEqual(calls, ['conversations', 'content', 'problems']);
    assert.deepEqual(errors, failing ? [failing] : []);
    assert.equal(result.problems, failing !== 'problems');
    assert.equal(result.conversations === null, failing === 'conversations');
    assert.equal(result.content === null, failing === 'content');
  });
}

test('stop does not start more work after a course is closed', async () => {
  let stopped = false;
  const calls = [];
  await independentCourseRefresh({
    problems: async () => {
      calls.push('problems');
      return true;
    },
    conversations: async () => {
      calls.push('conversations');
      stopped = true;
    },
    content: async () => {
      calls.push('content');
    },
    shouldStop: () => stopped,
    onError: () => assert.fail('unexpected error'),
  });
  assert.deepEqual(calls, ['conversations']);
});

test('same-course reentry shares one pending sync and can retry after failure', async () => {
  const pending = new Map();
  let calls = 0;
  let reject;
  const work = () => {
    calls++;
    return new Promise((_, fail) => {
      reject = fail;
    });
  };
  const a = singleFlight(pending, 'course', work);
  const b = singleFlight(pending, 'course', work);
  assert.equal(a, b);
  await Promise.resolve();
  assert.equal(calls, 1);
  reject(Error('offline'));
  await assert.rejects(a, /offline/);
  assert.equal(await singleFlight(pending, 'course', async () => true), true);
});
