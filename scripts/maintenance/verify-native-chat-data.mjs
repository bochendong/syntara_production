import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      (specifier.startsWith('./') || specifier.startsWith('../')) &&
      !/\.[a-z0-9]+$/i.test(specifier)
    ) {
      try {
        return nextResolve(`${specifier}.ts`, context);
      } catch {
        // The normal resolver still handles JavaScript and package imports.
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json')) {
      return {
        format: 'module',
        source: `export default ${readFileSync(new URL(url), 'utf8')};`,
        shortCircuit: true,
      };
    }
    return nextLoad(url, context);
  },
});

function parameters(values = []) {
  return Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
}

class NodeSqliteAdapter {
  constructor(database) {
    this.database = database;
  }

  async execute(sql, values = []) {
    const statement = this.database.prepare(sql);
    const result = values.length ? statement.run(parameters(values)) : statement.run();
    return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
  }

  async select(sql, values = []) {
    const statement = this.database.prepare(sql);
    return values.length ? statement.all(parameters(values)) : statement.all();
  }
}

const { SqliteLocalRepository } = await import(
  path.join(ROOT, 'apps/native/src/data/sqlite-repository.ts')
);

const database = new DatabaseSync(':memory:');
const migrations = path.join(ROOT, 'apps/native/src-tauri/migrations');
for (const name of readdirSync(migrations)
  .filter((name) => name.endsWith('.sql'))
  .sort()) {
  database.exec(await readFile(path.join(migrations, name), 'utf8'));
}
const repository = new SqliteLocalRepository();
repository.connection = new NodeSqliteAdapter(database);
for (const id of ['course-a', 'course-b', 'course-empty']) {
  database
    .prepare('INSERT INTO courses (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)')
    .run(id, id);
}
for (const [id, course, updated] of [
  ['old', 'course-a', 1],
  ['latest-a', 'course-a', 20],
  ['latest-b', 'course-b', 40],
]) {
  database
    .prepare(
      'INSERT INTO conversations (id, course_id, title, created_at, updated_at) VALUES (?, ?, ?, 1, ?)',
    )
    .run(id, course, id, updated);
}
assert.equal((await repository.latestCourseConversation('course-a')).id, 'latest-a');
assert.equal((await repository.latestCourseConversation('course-b')).id, 'latest-b');
assert.equal(await repository.latestCourseConversation('course-empty'), null);
assert.deepEqual(
  (await repository.listConversations(['course-a', 'course-b'])).map((row) => row.id),
  ['latest-b', 'latest-a', 'old'],
);
assert.deepEqual(
  (await repository.listConversations(['course-a'])).map((row) => row.id),
  ['latest-a', 'old'],
);
assert.deepEqual(await repository.listConversations([]), []);
const { courseScopedEventId } = await import(
  path.join(ROOT, 'apps/native/src/domain/learning-experiences.ts')
);
for (const id of ['course-a', 'course-b']) {
  await repository.upsertCourseEvents([
    {
      id: courseScopedEventId(id, 'ai-proposal', 'same-external-id'),
      courseId: id,
      title: id,
      date: '2026-10-22',
      note: '',
      kind: 'tutorial',
      source: 'ai-proposal',
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
  ]);
}
const events = (
  await Promise.all(['course-a', 'course-b'].map((id) => repository.listCourseEvents(id)))
).flat();
assert.equal(events.length, 2);
assert.equal(new Set(events.map((event) => event.courseId)).size, 2);
assert.equal(new Set(events.map((event) => event.id)).size, 2);

// Synchronization updates existing content, applies scoped tombstones, and never
// reintroduces a deleted message from the same incoming page.
const conversation = {
  id: 'old',
  courseId: 'course-a',
  notebookId: null,
  title: 'synced',
  createdAt: 1,
  updatedAt: 50,
};
const rich = {
  id: 'sync-rich',
  conversationId: 'old',
  role: 'assistant',
  text: 'before',
  createdAt: 2,
  metadata: { evidence: [{ id: 'source-1' }], lectureDeckId: 'local-only' },
};
assert.equal(await repository.mergeSyncedConversation(conversation, [rich]), 1);
assert.equal(
  await repository.mergeSyncedConversation(conversation, [
    { ...rich, text: 'after', metadata: { reviewPlan: { id: 'plan', title: 'plan', tasks: [] } } },
  ]),
  0,
);
let synced = (await repository.listMessages('old')).find((item) => item.id === rich.id);
assert.equal(synced.text, 'after');
assert.equal(synced.metadata.lectureDeckId, 'local-only');
assert.equal(synced.metadata.reviewPlan.id, 'plan');
await repository.mergeSyncedConversation(
  { ...conversation, id: 'latest-b', courseId: 'course-b' },
  [],
  [rich.id],
);
assert.ok((await repository.listMessages('old')).some((item) => item.id === rich.id));
await repository.mergeSyncedConversation(conversation, [rich], [rich.id]);
assert.ok(!(await repository.listMessages('old')).some((item) => item.id === rich.id));
await repository.putSyncEntry('test:queue', 'old', 1);
await repository.putSyncEntry('test:queue', 'new', 3);
await repository.putSyncEntry('test:queue', 'stale', 2);
await repository.removeSyncEntry('test:queue', 'old');
assert.deepEqual(
  (await repository.listSyncEntries('test:')).map((entry) => ({ ...entry })),
  [{ key: 'test:queue', value: 'new' }],
);
await repository.removeSyncEntry('test:queue', 'new');
assert.deepEqual(await repository.listSyncEntries('test:'), []);
database.close();
console.log(
  'Native chat SQLite: latest chat stays course-scoped, empty course, migration-9 compatibility and same-day cross-course schedules passed.',
);
