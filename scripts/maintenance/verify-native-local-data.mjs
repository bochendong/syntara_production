#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

const snapshotPath = path.join(
  ROOT,
  'apps/native/src/data/snapshots/production-problem-bank.v1.json',
);
const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8'));
const snapshotHash = createHash('sha256')
  .update(JSON.stringify({ courses: snapshot.courses, problems: snapshot.problems }))
  .digest('hex');
assert.equal(snapshotHash, snapshot.integrity.value, '内置题库快照哈希应匹配');
assert.equal(snapshot.problems.length, 1_223, '内置题库应包含 1,223 道已发布题目');
const now = 1_785_000_000_000;

const calendarDatabase = new DatabaseSync(':memory:');
await migrate(calendarDatabase);
for (const [id, name] of [
  ['calendar-course-a', '课程 A'],
  ['calendar-course-b', '课程 B'],
]) {
  calendarDatabase
    .prepare(
      `INSERT INTO courses
        (id, name, description, language, tags_json, purpose, university, course_code,
         created_at, updated_at)
       VALUES (?, ?, '', 'zh-CN', '[]', 'daily', NULL, NULL, ?, ?)`,
    )
    .run(id, name, now, now);
}
const calendarRepository = new SqliteLocalRepository();
calendarRepository.connection = new NodeSqliteAdapter(calendarDatabase);
const calendarEvent = {
  id: 'shared-external-event-id',
  courseId: 'calendar-course-a',
  title: '课程 A 的复习',
  date: '2026-08-01',
  note: '',
  kind: 'progress',
  source: 'ai-proposal',
  status: 'active',
  createdAt: now,
  updatedAt: now,
};
await calendarRepository.upsertCourseEvents([calendarEvent]);
await assert.rejects(
  calendarRepository.upsertCourseEvents([
    { ...calendarEvent, courseId: 'calendar-course-b', title: '不应覆盖课程 A' },
  ]),
  /其他课程/,
);
await calendarRepository.deleteCourseEvent('calendar-course-b', calendarEvent.id);
assert.equal(
  calendarDatabase.prepare('SELECT course_id FROM course_events WHERE id = ?').get(calendarEvent.id)
    .course_id,
  'calendar-course-a',
  '错误课程不能删除另一门课程的日历事项',
);
await calendarRepository.deleteCourseEvent('calendar-course-a', calendarEvent.id);
assert.equal(
  calendarDatabase
    .prepare('SELECT COUNT(*) AS count FROM course_events WHERE id = ?')
    .get(calendarEvent.id).count,
  0,
  '正确课程可以删除自己的日历事项',
);
for (const [id, courseId, name] of [
  ['calendar-notebook-a', 'calendar-course-a', '课程 A 笔记'],
  ['calendar-notebook-b', 'calendar-course-b', '课程 B 笔记'],
]) {
  calendarDatabase
    .prepare(
      `INSERT INTO notebooks
        (id, course_id, name, description, kind, tags_json, section_count, created_at, updated_at)
       VALUES (?, ?, ?, '', 'markdown', '[]', 1, ?, ?)`,
    )
    .run(id, courseId, name, now, now);
}
assert.equal(
  await calendarRepository.getCourseLearningState('calendar-course-a'),
  null,
  '尚未写入的课程不应伪造学习进度',
);
const savedLearningState = await calendarRepository.saveCourseLearningState({
  courseId: 'calendar-course-a',
  completedNotebookCount: 1,
  currentNotebookId: 'calendar-notebook-a',
  updatedAt: now + 1,
});
assert.deepEqual(savedLearningState, {
  courseId: 'calendar-course-a',
  completedNotebookCount: 1,
  currentNotebookId: 'calendar-notebook-a',
  updatedAt: now + 1,
});
assert.deepEqual(
  await calendarRepository.getCourseLearningState('calendar-course-a'),
  savedLearningState,
  '课程学习进度应从本地数据库完整读回',
);
const updatedLearningState = await calendarRepository.saveCourseLearningState({
  courseId: 'calendar-course-a',
  completedNotebookCount: 0,
  updatedAt: now + 2,
});
assert.equal(
  updatedLearningState.currentNotebookId,
  'calendar-notebook-a',
  '省略当前笔记本时应保留已有选择',
);
await assert.rejects(
  calendarRepository.saveCourseLearningState({
    courseId: 'calendar-course-a',
    completedNotebookCount: 2,
  }),
  /0 到 1/,
);
await assert.rejects(
  calendarRepository.saveCourseLearningState({
    courseId: 'calendar-course-a',
    completedNotebookCount: 0,
    currentNotebookId: 'calendar-notebook-b',
  }),
  /不属于这门课程/,
);
calendarDatabase.close();

const snapshotDatabase = new DatabaseSync(':memory:');
await migrate(snapshotDatabase);
const snapshotRepository = new SqliteLocalRepository();
snapshotRepository.connection = new NodeSqliteAdapter(snapshotDatabase);
await snapshotRepository.bootstrap();
await snapshotRepository.bootstrap();
const expectedProblemCounts = {
  MAT136: 227,
  CSC148: 298,
  MAT102: 412,
  CSC108: 286,
};
const snapshotSummaries = await snapshotRepository.listCourseSummaries();
for (const [courseCode, expectedCount] of Object.entries(expectedProblemCounts)) {
  const summary = snapshotSummaries.find((course) => course.courseCode === courseCode);
  assert(summary, `Learn 首页应显示 ${courseCode}`);
  assert.equal(
    summary.problemCount,
    expectedCount,
    `${courseCode} 课程卡片题数应为 ${expectedCount}`,
  );
  const workspace = await snapshotRepository.loadCourseWorkspace(summary.id);
  assert(workspace, `应能打开 ${courseCode} 本地课程`);
  assert.equal(
    workspace.problems.length,
    expectedCount,
    `${courseCode} 资料库应读取 ${expectedCount} 道题`,
  );
  const row = snapshotDatabase
    .prepare(
      `SELECT COUNT(*) AS count
         FROM problems
         JOIN courses ON courses.id = problems.course_id
        WHERE courses.course_code = ? AND problems.status = 'published'`,
    )
    .get(courseCode);
  assert.equal(row.count, expectedCount, `${courseCode} 内置题数应为 ${expectedCount}`);
}
assert.equal(
  snapshotDatabase.prepare('SELECT COUNT(*) AS count FROM problems').get().count,
  1_223,
  '重复 bootstrap 不应重复插入内置题目',
);
assert.equal(
  snapshotDatabase
    .prepare("SELECT COUNT(*) AS count FROM local_course_search WHERE source_type = 'problem'")
    .get().count,
  1_223,
  '内置题目应全部进入本机 FTS，且不受笔记与记忆索引数量影响',
);
assert.equal(
  snapshotDatabase
    .prepare(
      "SELECT COUNT(*) AS count FROM app_metadata WHERE key = 'bundled-problem-snapshot-version'",
    )
    .get().count,
  1,
  '内置题库版本应只记录一次',
);
assert.equal(snapshotDatabase.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
snapshotDatabase.close();

const upgradeDatabase = new DatabaseSync(':memory:');
await migrate(upgradeDatabase);
upgradeDatabase
  .prepare(
    `INSERT INTO courses
      (id, name, description, language, tags_json, purpose, university, course_code,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  .run(
    'existing-local-course',
    '用户已有课程',
    '升级前已经存在',
    'zh-CN',
    '[]',
    'daily',
    null,
    'LOCAL999',
    now,
    now,
  );
const upgradeRepository = new SqliteLocalRepository();
upgradeRepository.connection = new NodeSqliteAdapter(upgradeDatabase);
await upgradeRepository.bootstrap();
await upgradeRepository.bootstrap();
assert.equal(
  upgradeDatabase
    .prepare("SELECT COUNT(*) AS count FROM courses WHERE id = 'existing-local-course'")
    .get().count,
  1,
  '安装内置题库不应覆盖或删除用户已有课程',
);
assert.equal(
  upgradeDatabase.prepare('SELECT COUNT(*) AS count FROM problems').get().count,
  1_223,
  '已有课程的数据库也应收到完整内置题库',
);
assert.equal(
  upgradeDatabase.prepare('SELECT COUNT(*) AS count FROM courses').get().count,
  5,
  '已有课程应与四门内置课程共存',
);
assert.equal(upgradeDatabase.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
upgradeDatabase.close();

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

const first = await repository.importArchive(archive);
const second = await repository.importArchive(archive);
assert.deepEqual(second, first, '重复导入的摘要应保持一致');

const notebook = await repository.loadNotebookDocument('notebook-fixture');
assert(notebook, '应能读取导入的笔记本');
assert.equal(notebook.pages.length, 1);
assert.equal(notebook.assets.length, 1);
assert.equal(notebook.assets[0].dataBase64, 'iVBORw0KGgo=');

const problem = await repository.loadProblemDocument('problem-fixture');
assert(problem, '应能读取导入的题目');
assert.equal(problem.attempts.length, 1);
assert.equal(problem.progress?.status, 'passed');

const searchResults = await repository.searchCourse('course-fixture', '等于多少');
assert.equal(searchResults[0]?.resourceId, 'problem-fixture');
assert.equal(searchResults[0]?.type, 'problem');
const ftsSearchResults = await repository.searchCourse('course-fixture', 'fixture');
assert.equal(ftsSearchResults[0]?.resourceId, 'problem-fixture');

for (const table of [
  'courses',
  'notebooks',
  'notebook_pages',
  'assets',
  'page_assets',
  'notebook_assets',
  'problems',
  'problem_attempts',
  'problem_progress',
  'conversations',
  'messages',
  'local_course_search',
]) {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
  const expected = table === 'local_course_search' ? 2 : 1;
  assert.equal(row.count, expected, `${table} 应在重复导入后保持 ${expected} 行`);
}

assert.equal(database.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
console.log(
  JSON.stringify(
    {
      ok: true,
      idempotent: true,
      notebookPages: notebook.pages.length,
      notebookAssets: notebook.assets.length,
      problemAttempts: problem.attempts.length,
      searchResults: searchResults.length,
      ftsSearchResults: ftsSearchResults.length,
      bundledProblemSnapshot: {
        total: snapshot.problems.length,
        courses: expectedProblemCounts,
        integrity: snapshotHash,
      },
      integrity: 'ok',
    },
    null,
    2,
  ),
);
