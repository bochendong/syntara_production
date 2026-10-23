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
database.close();
console.log(
  'Native chat SQLite: latest chat stays course-scoped, empty course, migration-9 compatibility and same-day cross-course schedules passed.',
);
