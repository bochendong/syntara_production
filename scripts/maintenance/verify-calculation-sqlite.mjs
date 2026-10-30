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
const [{ parseSyntaraArchive }, { SqliteLocalRepository }, { gradeLocalProblem }] =
  await Promise.all([
    import(path.join(ROOT, 'apps/native/src/data/archive.ts')),
    import(path.join(ROOT, 'apps/native/src/data/sqlite-repository.ts')),
    import(path.join(ROOT, 'apps/native/src/data/local-problem-grading.ts')),
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
const timestamp = 1785000000000;
const temp = mkdtempSync(path.join(tmpdir(), 'syntara-numeric-fixture-'));
let database;
try {
  const filename = path.join(temp, 'local.db');
  database = new DatabaseSync(filename);
  migrate(database);
  let repo = repository(database);
  const archive = parseSyntaraArchive({
    format: 'syntara-native-archive',
    version: 1,
    exportedAt: timestamp,
    source: { kind: 'postgresql' },
    courses: [
      { id: 'fixture-course', name: 'Fixture', createdAt: timestamp, updatedAt: timestamp },
    ],
    problems: [
      {
        id: 'fixture-problem',
        courseId: 'fixture-course',
        notebookId: null,
        title: 'Fixture',
        type: 'calculation',
        status: 'published',
        difficulty: 'medium',
        tags: [],
        publicContent: { type: 'calculation', stem: 'Calculate' },
        grading: {
          type: 'calculation',
          graderKind: 'numeric_or_exact',
          referenceAnswer: '229.6875',
          acceptedForms: [],
          tolerance: 0.000001,
          numericEquivalenceVersion: 'scalar-v1',
        },
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ],
  });
  await repo.importArchive(archive);
  database.close();
  database = new DatabaseSync(filename);
  repo = repository(database);
  const persisted = await repo.loadProblemDocument('fixture-problem');
  assert.equal(persisted?.problem.grading.numericEquivalenceVersion, 'scalar-v1');
  const answer = { kind: 'text', text: '3675 / 16' };
  const grade = gradeLocalProblem(persisted.problem, answer);
  assert.equal(grade.status, 'passed');
  assert.equal(
    gradeLocalProblem(persisted.problem, { kind: 'text', text: '3675 / 0' }).status,
    'failed',
  );
  await repo.saveProblemAttempt({
    problemId: 'fixture-problem',
    answer,
    status: grade.status,
    score: grade.score,
    feedback: grade.feedback,
  });
  database.close();
  database = new DatabaseSync(filename);
  repo = repository(database);
  const reloaded = await repo.loadProblemDocument('fixture-problem');
  assert.equal(reloaded.problem.grading.numericEquivalenceVersion, 'scalar-v1');
  assert.equal(reloaded.attempts.length, 1);
  assert.equal(reloaded.attempts[0].status, 'passed');
  assert.equal(reloaded.progress.passedCount, 1);
  console.log('SQLite roundtrip and disposable local submission passed');
} finally {
  if (database?.isOpen) database.close();
  rmSync(temp, { recursive: true, force: true });
}
