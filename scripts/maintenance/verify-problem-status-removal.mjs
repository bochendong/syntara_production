#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// Upgrade a populated installation, including problems hidden by the old filter.
const db = new DatabaseSync(':memory:');
const migrations = 'apps/native/src-tauri/migrations';
for (const file of readdirSync(migrations)
  .filter((name) => /^000[1-8]_.*\.sql$/.test(name))
  .sort()) {
  db.exec(readFileSync(`${migrations}/${file}`, 'utf8'));
}
db.exec("INSERT INTO courses(id,name,created_at,updated_at) VALUES ('course','Calculus',1,1)");
for (const status of ['draft', 'published', 'archived']) {
  db.prepare(
    'INSERT INTO problems(id,course_id,title,type,status,created_at,updated_at) VALUES (?, ?, ?, ?, ?, 1, 1)',
  ).run(status, 'course', `Problem ${status}`, 'short_answer', status);
}
assert.equal(
  db.prepare("SELECT count(*) AS n FROM local_course_search WHERE source_type='problem'").get().n,
  2,
);
db.exec(readFileSync(`${migrations}/0009_remove_problem_status.sql`, 'utf8'));
assert.equal(
  db
    .prepare('PRAGMA table_info(problems)')
    .all()
    .some((column) => column.name === 'status'),
  false,
);
assert.equal(db.prepare('SELECT count(*) AS n FROM problems').get().n, 3);
assert.equal(
  db.prepare("SELECT count(*) AS n FROM local_course_search WHERE source_type='problem'").get().n,
  3,
);
db.exec("UPDATE problems SET title='Updated question' WHERE id='archived'");
assert.equal(
  db.prepare("SELECT title FROM local_course_search WHERE source_id='archived'").get().title,
  'Updated question',
);
db.exec(
  "INSERT INTO problems(id,course_id,title,type,created_at,updated_at) VALUES ('new','course','New question','proof',1,1)",
);
assert.equal(
  db.prepare("SELECT count(*) AS n FROM local_course_search WHERE source_type='problem'").get().n,
  4,
);
db.exec("DELETE FROM problems WHERE id='new'");
assert.equal(
  db.prepare("SELECT count(*) AS n FROM local_course_search WHERE source_type='problem'").get().n,
  3,
);
db.close();
console.log(
  'PASS: status removal preserves existing problems and rebuilds searchable content; insert/update/delete triggers work.',
);
