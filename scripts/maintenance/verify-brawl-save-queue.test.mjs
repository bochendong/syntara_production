import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BrawlSaveConflict,
  createBrawlSaveQueue,
} from '../../apps/native/public/games/sandbox-brawl/brawl-cloud.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key),
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test('a lost save response can be retried after reopening without replaying the balance change', async () => {
  const store = memoryStorage();
  const writes = new Map();
  let revision = 3;
  let points = 10;
  let firstResponse = true;
  let id = 0;
  const options = {
    store,
    key: 'account',
    onError() {},
    createId: () => String(++id),
    async request(operation) {
      if (writes.has(operation.id)) return writes.get(operation.id);
      assert.equal(operation.revision, revision);
      points = operation.data.pts;
      const result = { kind: 'saved', revision: ++revision };
      writes.set(operation.id, result);
      if (firstResponse) {
        firstResponse = false;
        throw new Error('response lost');
      }
      return result;
    },
  };
  const queue = createBrawlSaveQueue(options);
  queue.open(3);
  queue.enqueue({ pts: 20 });
  await assert.rejects(queue.flush(), /response lost/);
  const recovered = createBrawlSaveQueue(options);
  await recovered.flush();
  assert.equal(writes.size, 1);
  assert.equal(points, 20);
  recovered.enqueue({ pts: 17 });
  await recovered.flush();
  assert.equal(revision, 5);
  assert.equal(points, 17);
});

test('a stale device keeps its unsynced journal without overwriting the newer account save', async () => {
  const store = memoryStorage();
  let id = 0;
  const queue = createBrawlSaveQueue({
    store,
    key: 'account',
    onError() {},
    createId: () => String(++id),
    request: async () => ({ kind: 'conflict', revision: 6 }),
  });
  queue.open(5);
  queue.enqueue({ pts: 20, skins: ['unconfirmed-skin'] });
  await assert.rejects(queue.flush(), BrawlSaveConflict);
  assert.equal(JSON.parse(store.getItem('account')).pending.data.pts, 20);
  queue.archive();
  assert.equal(store.getItem('account'), undefined);
  assert.deepEqual(JSON.parse(store.getItem('account:backup:2')).pending.data.skins, [
    'unconfirmed-skin',
  ]);
});
