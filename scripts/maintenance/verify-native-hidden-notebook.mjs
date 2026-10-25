#!/usr/bin/env node

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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

const [{ parseSyntaraArchive }, { SqliteLocalRepository }] = await Promise.all([
  import(path.join(ROOT, 'apps/native/src/data/archive.ts')),
  import(path.join(ROOT, 'apps/native/src/data/sqlite-repository.ts')),
]);

const migrationFiles = [
  '0001_core.sql',
  '0002_learning_content.sql',
  '0003_assets.sql',
  '0004_asset_file_storage.sql',
  '0005_local_course_search.sql',
  '0006_app_metadata.sql',
  '0007_course_events_and_lectures.sql',
  '0008_message_metadata.sql',
];

async function migrate(database) {
  for (const migrationFile of migrationFiles) {
    database.exec(
      await readFile(path.join(ROOT, 'apps/native/src-tauri/migrations', migrationFile), 'utf8'),
    );
  }
}

const now = 1_785_000_000_000;
const database = new DatabaseSync(':memory:');
await migrate(database);

const archive = parseSyntaraArchive({
  format: 'syntara-native-archive',
  version: 1,
  exportedAt: now,
  source: { kind: 'postgresql' },
  courses: [
    {
      id: 'course-fixture',
      name: '离线迁移验证',
      description: 'fixture',
      language: 'zh-CN',
      tags: [],
      purpose: 'university',
      university: null,
      courseCode: 'LOCAL101',
      createdAt: now,
      updatedAt: now,
    },
  ],
  notebooks: [
    {
      id: 'notebook-fixture',
      courseId: 'course-fixture',
      name: '本地笔记',
      description: '',
      kind: 'image',
      tags: [],
      sectionCount: 1,
      createdAt: now,
      updatedAt: now,
    },
  ],
  notebookPages: [
    {
      id: 'page-fixture',
      notebookId: 'notebook-fixture',
      courseId: 'course-fixture',
      sourceSceneId: null,
      title: '第一页',
      type: 'slide',
      order: 0,
      content: {
        type: 'slide',
        canvas: {
          elements: [{ type: 'image', src: '/generated-notebooks/fixture/page.png' }],
        },
      },
      actions: [{ type: 'speech', text: '本地讲解' }],
      whiteboard: null,
      createdAt: now,
      updatedAt: now,
    },
  ],
  markdownSections: [],
  problems: [
    {
      id: 'problem-fixture',
      courseId: 'course-fixture',
      notebookId: 'notebook-fixture',
      title: '本地题目',
      type: 'multiple_choice',
      status: 'published',
      difficulty: 'easy',
      tags: ['fixture'],
      publicContent: { statement: '1 + 1 等于多少？', options: ['1', '2'] },
      grading: {},
      createdAt: now,
      updatedAt: now,
    },
  ],
  problemAttempts: [
    {
      id: 'attempt-fixture',
      problemId: 'problem-fixture',
      kind: 'manual',
      answer: { value: '2' },
      result: { correct: true },
      score: 1,
      status: 'passed',
      createdAt: now,
      updatedAt: now,
    },
  ],
  problemProgress: [
    {
      id: 'progress-fixture',
      problemId: 'problem-fixture',
      latestAttemptId: 'attempt-fixture',
      status: 'passed',
      score: 1,
      attemptedCount: 1,
      passedCount: 1,
      lastAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ],
  conversations: [
    {
      id: 'conversation-fixture',
      courseId: 'course-fixture',
      notebookId: null,
      title: '本地对话',
      createdAt: now,
      updatedAt: now,
    },
  ],
  messages: [
    {
      id: 'message-fixture',
      conversationId: 'conversation-fixture',
      role: 'user',
      text: '你好',
      createdAt: now,
    },
  ],
  studyMemories: [],
  assets: [
    {
      id: 'asset-fixture',
      path: '/generated-notebooks/fixture/page.png',
      mimeType: 'image/png',
      sizeBytes: 8,
      sha256: 'fixture',
      source: 'verification',
      dataBase64: 'iVBORw0KGgo=',
      createdAt: now,
      updatedAt: now,
    },
  ],
  pageAssets: [
    {
      id: 'page-asset-fixture',
      pageId: 'page-fixture',
      assetId: 'asset-fixture',
      role: 'image',
      order: 0,
      meta: {},
      createdAt: now,
      updatedAt: now,
    },
  ],
  notebookAssets: [
    {
      id: 'notebook-asset-fixture',
      notebookId: 'notebook-fixture',
      assetId: 'asset-fixture',
      createdAt: now,
      updatedAt: now,
    },
  ],
  missingAssetPaths: [],
});

const repository = new SqliteLocalRepository();
repository.connection = new NodeSqliteAdapter(database);

await repository.importArchive(archive);
await repository.removeNotebook('notebook-fixture');
assert.equal(await repository.loadNotebookDocument('notebook-fixture'), null);
const problem = await repository.loadProblemDocument('problem-fixture');
assert(problem);
assert.equal(problem.problem.notebookId, null);
assert.equal(problem.attempts.length, 1);
assert.equal(problem.progress.status, 'passed');
assert.equal(database.prepare('SELECT COUNT(*) AS n FROM conversations').get().n, 1);
assert.equal(database.prepare('SELECT COUNT(*) AS n FROM messages').get().n, 1);
assert.equal(database.prepare('SELECT COUNT(*) AS n FROM notebook_pages').get().n, 0);
assert.equal(database.prepare('SELECT COUNT(*) AS n FROM page_assets').get().n, 0);
assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
assert.equal(database.prepare('SELECT COUNT(*) AS n FROM pragma_foreign_key_check').get().n, 0);
await repository.removeNotebook('notebook-fixture');
assert.equal((await repository.loadProblemDocument('problem-fixture')).attempts.length, 1);
database.close();
console.log(
  'Native hidden notebook removal: content removed, questions/attempts/progress/conversations retained, repeated removal and SQLite integrity passed.',
);
