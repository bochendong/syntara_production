import assert from 'node:assert/strict';
import {
  createImportCheckpoints,
  ImportContinuationRequired,
} from '../../lib/server/notebook-problems/import.checkpoints.ts';

let clock = 0;
const durable = {};
let calls = 0;
const checkpoint = createImportCheckpoints({
  saved: {},
  deadline: 100,
  now: () => clock,
  persist: async (key, value) => {
    durable[key] = structuredClone(value);
  },
});
await checkpoint('structure', async () => {
  calls++;
  return { questions: 12 };
});
await Promise.all(
  [0, 1].map((index) =>
    checkpoint(`batch:${index}`, async () => {
      calls++;
      return { drafts: [{ index }], usage: { outputTokens: 10 } };
    }),
  ),
);
assert.equal(Object.keys(durable).length, 3, 'Concurrent batches are all persisted');
clock = 100;
await assert.rejects(
  checkpoint('batch:2', async () => {
    calls++;
  }),
  ImportContinuationRequired,
);
assert.equal(calls, 3, 'No new generation starts after the continuation deadline');
// A fresh process must reuse the durable data, even when its budget is exhausted.
const resumed = createImportCheckpoints({
  saved: structuredClone(durable),
  deadline: 0,
  now: () => clock,
  persist: async () => assert.fail('Must not rewrite saved work'),
});
assert.deepEqual(
  await resumed('batch:1', async () => assert.fail('Must not regenerate')),
  durable['batch:1'],
);
assert.deepEqual(
  await resumed('structure', async () => assert.fail('Must not regenerate')),
  durable.structure,
);
// Failed generation and failed persistence both remain retryable, never cached as complete.
await assert.rejects(
  checkpoint('failed', async () => {
    throw new Error('provider');
  }),
  ImportContinuationRequired,
);
clock = 0;
await assert.rejects(
  checkpoint('failed', async () => {
    throw new Error('provider');
  }),
  /provider/,
);
assert.equal(Object.hasOwn(durable, 'failed'), false);
let writes = 0;
const failedWrite = createImportCheckpoints({
  saved: {},
  deadline: 100,
  now: () => 0,
  persist: async () => {
    if (++writes === 1) throw new Error('database');
  },
});
await assert.rejects(
  failedWrite('batch', async () => 1),
  /database/,
);
assert.equal(await failedWrite('batch', async () => 2), 2);
const worker = new AbortController();
const aborted = createImportCheckpoints({
  saved: { complete: 42 },
  deadline: 100,
  now: () => 0,
  signal: worker.signal,
  persist: async () => assert.fail('Do not persist a fallback returned after worker cancellation'),
});
await assert.rejects(
  aborted('quality', async () => {
    worker.abort();
    return { verdict: 'error' };
  }),
  (error) => error.name === 'AbortError',
);
assert.equal(await aborted('complete', async () => assert.fail('Must reuse saved work')), 42);
console.log(
  'PASS: durable batch reuse, concurrent saves, time-budget continuation, and retry after failures',
);
