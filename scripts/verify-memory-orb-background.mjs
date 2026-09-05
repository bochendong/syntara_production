import assert from 'node:assert/strict';
import { mock } from 'node:test';
import { setImmediate as flush } from 'node:timers/promises';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url, { alias: { '@': process.cwd() } });
const { packResult } = await jiti.import('../features/background-jobs/server/store.ts');
const { memoryJobActivity, readMemoryJobActivities } = await jiti.import(
  '../features/background-jobs/server/memory-activity.ts',
);
const { projectMemoryActivities } = await jiti.import(
  '../features/background-jobs/client/use-memory-job-activities.ts',
);
const { startMemoryActivityPolling } = await jiti.import(
  '../features/background-jobs/client/memory-activity-polling.ts',
);

const now = Date.now();
const base = {
  id: 'job-1',
  ownerId: 'student-a',
  courseId: 'course-a',
  kind: 'learner-note',
  status: 'queued',
  attempts: 0,
  createdAt: new Date(now - 60_000),
  updatedAt: new Date(now),
  completedAt: null,
  result: null,
  payload: { text: 'private source text' },
  error: 'private provider error',
};
const done = (result) => ({
  ...base,
  status: 'completed',
  completedAt: new Date(now),
  result: packResult(result),
});

assert.equal(memoryJobActivity(base).status, 'queued');
assert.match(memoryJobActivity({ ...base, attempts: 1 }).title, /等待重试/);
assert.equal(memoryJobActivity({ ...base, status: 'running' }).finishedAt, undefined);
assert.equal(memoryJobActivity({ ...base, status: 'failed', attempts: 3 }).status, 'failed');
assert.equal(memoryJobActivity(done({ notes: [] })).status, 'skipped');
for (const skipped of ['source-changed', 'deleted', 'already-summarized', 'access-revoked'])
  assert.equal(memoryJobActivity(done({ skipped })).status, 'skipped');
const written = memoryJobActivity(done({ notes: ['note-1', 'note-2'] }));
assert.equal(written.status, 'completed');
assert.match(written.title, /2 条/);
const summary = memoryJobActivity({
  ...done({ notes: [], conversationId: 'conversation-1' }),
  kind: 'conversation-memory',
});
assert.match(summary.title, /对话记忆/);
assert.match(summary.description, /没有新增学习状态或偏好/);
assert.equal(memoryJobActivity({ ...base, status: 'completed' }).status, 'failed');
assert.doesNotMatch(JSON.stringify(written), /private|payload|error|note-1|note-2/);

// The same task may be observed in both reads during completion. Its final state wins.
let queries = 0;
const activities = await readMemoryJobActivities(
  {
    backgroundJob: {
      findMany: async ({ where, select, take }) => {
        queries++;
        assert.equal(where.ownerId, 'student-a');
        assert.equal(where.courseId, 'course-a');
        assert.deepEqual(where.kind.in, ['learner-note', 'conversation-memory']);
        assert.equal(select.payload, undefined);
        assert.equal(select.error, undefined);
        assert.ok(take <= 50);
        return where.status.in.includes('running')
          ? [{ ...base, status: 'running' }]
          : [done({ notes: ['note-1'] })];
      },
    },
  },
  'student-a',
  'course-a',
  now,
);
assert.equal(queries, 2);
assert.equal(activities.length, 1);
assert.equal(activities[0].status, 'completed');

const snapshot = { ownerId: 'student-a', activities: [written] };
const first = projectMemoryActivities(snapshot, now);
const again = projectMemoryActivities(snapshot, now + 30_000);
assert.equal(first.activities[0].id, again.activities[0].id);
assert.equal(first.activities[0].finishedAt, again.activities[0].finishedAt);
assert.equal(projectMemoryActivities(snapshot, now + 90_001).activities.length, 0);
assert.equal(projectMemoryActivities(snapshot, now + 90_001).history.length, 1);
assert.equal(projectMemoryActivities(undefined, now).history.length, 0);
const pending = { ownerId: 'student-a', activities: [memoryJobActivity(base)] };
assert.equal(projectMemoryActivities(pending, now + 999_999).activities.length, 1);

// Exercise polling without network/model calls or waiting through real intervals.
mock.timers.enable({ apis: ['setTimeout'] });
const pollers = [];
try {
  let visible = true;
  let fetches = 0;
  let fail = false;
  let responseBody = pending;
  let unavailable = 0;
  const received = [];
  const start = (overrides = {}) => {
    const poller = startMemoryActivityPolling({
      ownerId: 'student-a',
      courseId: 'course-a',
      isVisible: () => visible,
      onSnapshot: (value) => received.push(value),
      onUnavailable: () => unavailable++,
      fetch: async (url, options) => {
        fetches++;
        assert.equal(url, '/api/learn/memory-activities?courseId=course-a');
        assert.equal(options.cache, 'no-store');
        return { ok: !fail, json: async () => responseBody };
      },
      ...overrides,
    });
    pollers.push(poller);
    return poller;
  };
  const advance = async (ms) => {
    mock.timers.tick(ms);
    await flush();
  };
  const poller = start();
  await flush();
  assert.equal(fetches, 1);
  await advance(2_999);
  assert.equal(fetches, 1);
  responseBody = snapshot;
  await advance(1);
  assert.equal(fetches, 2);
  assert.equal(received.at(-1).activities[0].status, 'completed');
  await advance(19_999);
  assert.equal(fetches, 2);
  await advance(1);
  assert.equal(fetches, 3);
  // Idle reads can discover a new write without any browser intake event.
  responseBody = pending;
  await advance(20_000);
  assert.equal(received.at(-1).activities[0].status, 'queued');
  visible = false;
  poller.refresh();
  await advance(60_000);
  assert.equal(fetches, 4);
  visible = true;
  poller.refresh();
  await flush();
  assert.equal(fetches, 5);

  fail = true;
  await advance(3_000);
  assert.equal(unavailable, 1);
  await advance(19_999);
  assert.equal(fetches, 6);
  await advance(1);
  assert.equal(unavailable, 2);
  await advance(40_000);
  assert.equal(unavailable, 3);
  await advance(59_999);
  assert.equal(fetches, 8);
  await advance(1);
  assert.equal(unavailable, 4);
  // A response for another account/course must never enter the orb.
  fail = false;
  responseBody = { ...snapshot, ownerId: 'student-b' };
  const before = received.length;
  poller.refresh();
  await flush();
  assert.equal(received.length, before);
  responseBody = { ...snapshot, activities: [{ ...written, courseId: 'course-b' }] };
  poller.refresh();
  await flush();
  assert.equal(received.length, before);
  responseBody = snapshot;
  poller.refresh();
  await flush();
  assert.equal(received.length, before + 1);
  poller.stop();

  // Cancel observation while a request is in flight; even a late response is ignored.
  let resolveRequest;
  let requestSignal;
  let inFlightCalls = 0;
  const late = start({
    fetch: async (_url, options) => {
      requestSignal = options.signal;
      inFlightCalls++;
      return new Promise((resolve) => {
        resolveRequest = resolve;
      });
    },
  });
  late.refresh();
  late.refresh();
  assert.equal(inFlightCalls, 1);
  const beforeStop = received.length;
  late.stop();
  assert.equal(requestSignal.aborted, true);
  resolveRequest({ ok: true, json: async () => snapshot });
  await flush();
  await advance(60_000);
  assert.equal(received.length, beforeStop);
  assert.equal(inFlightCalls, 1);
} finally {
  pollers.forEach((poller) => poller.stop());
  mock.timers.reset();
}
console.log(
  'Memory orb: write outcomes, scoped reads, refresh recovery, expiry, polling, backoff and cancellation passed.',
);
