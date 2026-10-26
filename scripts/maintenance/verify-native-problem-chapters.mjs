#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { tmpdir } from 'node:os';
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
        /* Package resolver fallback. */
      }
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.json'))
      return {
        format: 'module',
        source: `export default ${readFileSync(new URL(url), 'utf8')};`,
        shortCircuit: true,
      };
    return nextLoad(url, context);
  },
});
const [{ parseSyntaraArchive }, { SqliteLocalRepository }, { seedProblems }] = await Promise.all([
  import(path.join(ROOT, 'apps/native/src/data/archive.ts')),
  import(path.join(ROOT, 'apps/native/src/data/sqlite-repository.ts')),
  import(path.join(ROOT, 'apps/native/src/data/seed.ts')),
]);
class NodeSqliteAdapter {
  constructor(database) {
    this.database = database;
  }
  parameters(values) {
    return Object.fromEntries(values.map((value, index) => [`$${index + 1}`, value]));
  }
  async execute(sql, values = []) {
    const statement = this.database.prepare(sql);
    const result = values.length ? statement.run(this.parameters(values)) : statement.run();
    return { rowsAffected: Number(result.changes), lastInsertId: Number(result.lastInsertRowid) };
  }
  async select(sql, values = []) {
    const statement = this.database.prepare(sql);
    return values.length ? statement.all(this.parameters(values)) : statement.all();
  }
}
const migrationRoot = path.join(ROOT, 'apps/native/src-tauri/migrations');
const migrations = readdirSync(migrationRoot)
  .filter((name) => /^\d+.*\.sql$/.test(name))
  .sort();
assert.equal(migrations.at(-1), '0010_problem_chapters.sql');
function migrate(database, files = migrations) {
  for (const name of files) database.exec(readFileSync(path.join(migrationRoot, name), 'utf8'));
}
function repository(database) {
  const result = new SqliteLocalRepository();
  result.connection = new NodeSqliteAdapter(database);
  return result;
}
const timestamp = 1_785_000_000_000;
const temp = mkdtempSync(path.join(tmpdir(), 'syntara-chapters-'));
let database;
try {
  const filename = path.join(temp, 'local.db');
  database = new DatabaseSync(filename);
  migrate(database, migrations.slice(0, -1));
  database
    .prepare('INSERT INTO courses (id,name,created_at,updated_at) VALUES (?,?,?,?)')
    .run('course', 'MAT102', timestamp, timestamp);
  database
    .prepare(
      'INSERT INTO problems (id,course_id,title,type,created_at,updated_at) VALUES (?,?,?,?,?,?)',
    )
    .run('legacy', 'course', 'Existing problem', 'proof', timestamp, timestamp);
  migrate(database, migrations.slice(-1));
  let repo = repository(database);
  const legacy = await repo.loadProblemDocument('legacy');
  assert(legacy);
  assert.equal(legacy.problem.chapterId, null);
  assert.equal(legacy.problem.chapterName, null);
  const archiveInput = {
    format: 'syntara-native-archive',
    version: 1,
    exportedAt: timestamp,
    source: { kind: 'postgresql' },
    courses: [{ id: 'course', name: 'MAT102', createdAt: timestamp, updatedAt: timestamp }],
    problems: [
      {
        id: 'problem',
        courseId: 'course',
        notebookId: null,
        chapterId: 'functions',
        chapterName: '函数与映射',
        title: 'Prove injectivity',
        type: 'proof',
        status: 'published',
        difficulty: 'hard',
        tags: [],
        publicContent: { type: 'proof', stem: 'Prove the stated map is injective.' },
        grading: { type: 'proof', referenceProof: 'A reference proof.' },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  };
  const archive = parseSyntaraArchive(archiveInput);
  assert.equal(archive.problems[0].chapterId, 'functions');
  assert.equal(archive.problems[0].chapterName, '函数与映射');
  await repo.importArchive(archive);
  await repo.importArchive(archive);
  assert.equal(
    database.prepare('SELECT COUNT(*) AS count FROM problems WHERE id=?').get('problem').count,
    1,
  );
  database.close();
  database = new DatabaseSync(filename);
  repo = repository(database);
  const persisted = await repo.loadProblemDocument('problem');
  assert.equal(
    persisted?.problem.chapterId,
    'functions',
    'Chapter ID must survive closing and reopening the database.',
  );
  assert.equal(persisted?.problem.chapterName, '函数与映射');
  const workspace = await repo.loadCourseWorkspace('course');
  assert.equal(workspace?.problems.find((p) => p.id === 'problem')?.chapterName, '函数与映射');
  const updated = parseSyntaraArchive(JSON.stringify(archive));
  updated.problems[0].chapterId = 'relations';
  updated.problems[0].chapterName = '关系';
  await repo.importArchive(updated);
  const moved = await repo.loadProblemDocument('problem');
  assert.equal(moved?.problem.chapterId, 'relations');
  assert.equal(moved?.problem.chapterName, '关系');
  delete archiveInput.problems[0].chapterId;
  delete archiveInput.problems[0].chapterName;
  const oldArchive = parseSyntaraArchive(archiveInput);
  assert.equal(oldArchive.problems[0].chapterId, null);
  assert.equal(oldArchive.problems[0].chapterName, null);
  await repo.importArchive(oldArchive);
  assert.equal((await repo.loadProblemDocument('problem'))?.problem.chapterId, null);
  const importedText = await repo.importTextProblem({
    courseId: 'course',
    name: 'Local text.txt',
    text: 'A locally imported question.',
  });
  assert.equal((await repo.loadProblemDocument(importedText.id))?.problem.chapterId, null);
  assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  database.close();
  database = null;

  const seeded = new DatabaseSync(':memory:');
  try {
    migrate(seeded);
    const indexes = [0, 50, seedProblems.length - 1];
    const originals = indexes.map((index) => ({ ...seedProblems[index] }));
    try {
      indexes.forEach((index) => {
        seedProblems[index].chapterId = `seed-chapter-${index}`;
        seedProblems[index].chapterName = `章节 ${index}`;
      });
      const seededRepo = repository(seeded);
      await seededRepo.installBundledProblemSnapshot(seededRepo.connection);
      await seededRepo.installBundledProblemSnapshot(seededRepo.connection);
      for (const index of indexes) {
        const problem = await seededRepo.loadProblemDocument(seedProblems[index].id);
        assert.equal(problem?.problem.chapterId, `seed-chapter-${index}`);
        assert.equal(problem?.problem.chapterName, `章节 ${index}`);
      }
      // A bundled snapshot version change exercises the conflict-update path too.
      seedProblems[indexes[0]].chapterName = '更新后的章节';
      seeded
        .prepare('DELETE FROM app_metadata WHERE key = ?')
        .run('bundled-problem-snapshot-version');
      await seededRepo.installBundledProblemSnapshot(seededRepo.connection);
      assert.equal(
        (await seededRepo.loadProblemDocument(seedProblems[indexes[0]].id))?.problem.chapterName,
        '更新后的章节',
      );
    } finally {
      indexes.forEach((index, position) => {
        Object.assign(seedProblems[index], originals[position]);
        if (!('chapterId' in originals[position])) delete seedProblems[index].chapterId;
        if (!('chapterName' in originals[position])) delete seedProblems[index].chapterName;
      });
    }
    assert.equal(seeded.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  } finally {
    seeded.close();
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        migrationPreservesExistingProblems: true,
        legacyArchive: true,
        archiveInsertAndUpdate: true,
        durableReopen: true,
        workspaceMapper: true,
        textImport: true,
        bundledBatchBoundaries: true,
      },
      null,
      2,
    ),
  );
} finally {
  database?.close();
  rmSync(temp, { recursive: true, force: true });
}
