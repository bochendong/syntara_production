import assert from 'node:assert/strict';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url);
const { serializeRepository } = await jiti.import(
  '../../apps/native/src/data/serialize-repository.ts',
);
const events = [];
const repository = serializeRepository({
  kind: 'sqlite',
  async append(text) {
    events.push(text);
    await Promise.resolve();
  },
  async transaction(fail = false) {
    events.push('BEGIN');
    await this.append('inside');
    await Promise.resolve();
    events.push(fail ? 'ROLLBACK' : 'COMMIT');
    if (fail) throw new Error('fixture transaction failed');
    return 'saved';
  },
});
assert.equal(repository.kind, 'sqlite');
assert.deepEqual(await Promise.all([repository.transaction(), repository.append('outside')]), [
  'saved',
  undefined,
]);
assert.deepEqual(events, ['BEGIN', 'inside', 'COMMIT', 'outside']);
events.length = 0;
const results = await Promise.allSettled([
  repository.transaction(true),
  repository.append('after failure'),
]);
assert.equal(results[0].status, 'rejected');
assert.equal(results[1].status, 'fulfilled');
assert.deepEqual(events, ['BEGIN', 'inside', 'ROLLBACK', 'after failure']);
console.log(
  'Native repository serialization passed: transaction isolation, nested repository methods, failure recovery.',
);
