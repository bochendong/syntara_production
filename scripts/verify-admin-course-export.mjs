import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const path = 'lib/server/admin-course-export.ts';
const code = ts.transpileModule(readFileSync(path, 'utf8'), {
  fileName: path,
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
}).outputText;
const loaded = { exports: {} };
new Function('require', 'module', 'exports', code)(require, loaded, loaded.exports);
const { buildAdminCourseArchive, archiveResponse } = loaded.exports;

const empty = async () => [];
const db = {
  course: { findMany: async () => [{ id: 'course-1', ownerId: 'teacher-1', name: '课程 A' }] },
  courseSource: {
    findMany: async () => [
      {
        id: 'raw-1',
        title: '讲义.pdf',
        kind: 'upload',
        sourceCategory: 'school_teacher_notes',
        fileSize: 3,
      },
      {
        id: 'bank-1',
        title: '题库.txt',
        kind: 'problem_bank',
        sourceCategory: 'problem_bank',
        fileSize: 1,
      },
      { id: 'missing-1', title: '旧资料.pdf', kind: 'upload', sourceCategory: null, fileSize: 90 },
    ],
    findUnique: async ({ where }) =>
      ({
        'raw-1': { fileData: Buffer.from('PDF'), extractedText: '原始文本' },
        'bank-1': { fileData: Buffer.from('Q'), extractedText: '原题文本' },
        'missing-1': { fileData: null, extractedText: null },
      })[where.id],
  },
  notebook: {
    findMany: async () => [{ id: 'notebook-1', name: '整理笔记', notebookKind: 'markdown' }],
  },
  markdownNotebookSection: {
    findMany: async () => [
      {
        id: 'section-1',
        title: '第一章',
        order: 0,
        markdown: '# 课文\n![](/generated-notebooks/a.png)\n![](/generated-notebooks/missing.png)',
      },
    ],
  },
  scene: { findMany: empty },
  notebookPage: { findMany: empty },
  courseProblemChapter: { findMany: empty },
  courseProblemTagNode: { findMany: empty },
  notebookProblem: {
    findMany: async () => [
      {
        id: 'problem-1',
        order: 0,
        title: '原题',
        publicContentJson: { statement: '题面' },
        gradingJson: { answer: '答案' },
        secret: { secretJudgeJson: { test: '隐藏测试' } },
      },
    ],
  },
  problemImportBatch: {
    findMany: async () => [{ id: 'import-1', draftSnapshotJson: { prompt: '原始题库导入草稿' } }],
  },
  courseHardRule: { findMany: empty },
  notebookImageAsset: {
    findUnique: async ({ where, select }) =>
      where.path === '/generated-notebooks/a.png'
        ? select.data
          ? { data: Buffer.from('PNG') }
          : { path: where.path }
        : null,
  },
};
const zip = await buildAdminCourseArchive(db, ['course-1']);
const response = archiveResponse(zip, 'test-export');
assert.equal(response.headers.get('content-type'), 'application/zip');
const contents = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
const names = Object.keys(contents.files);
const find = (suffix) => {
  const name = names.find((entry) => entry.endsWith(suffix));
  assert.ok(name, `missing ${suffix}`);
  return contents.file(name).async('string');
};
assert.equal(await find('/original/讲义.pdf'), 'PDF');
assert.equal(await find('/extracted-text.txt'), '原始文本');
assert.equal(await find('/original/题库.txt'), 'Q');
assert.match(await find('.md'), /# 课文/);
assert.equal(await find('/media/generated-notebooks/a.png'), 'PNG');
assert.match(await find('problem-1.json'), /隐藏测试/);
assert.match(await find('import-1.json'), /原始题库导入草稿/);
const manifest = JSON.parse(await find('manifest.json'));
assert.deepEqual(manifest.courses[0].unavailableOriginalFiles, ['missing-1']);
assert.deepEqual(manifest.courses[0].unavailableGeneratedImages, [
  '/generated-notebooks/missing.png',
]);
assert.equal(manifest.courses[0].problems, 1);
console.log(
  'PASS admin archive: originals, extracted text, notebooks, problems, import records, missing-file manifest',
);

for (const [routePath, expectedLookup] of [
  ['app/api/admin/teachers/[teacherId]/export/route.ts', 'teacher'],
  ['app/api/admin/courses/[id]/export/route.ts', 'course'],
]) {
  const routeCode = ts.transpileModule(readFileSync(routePath, 'utf8'), {
    fileName: routePath,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const route = { exports: {} };
  let lookedUp = false;
  let allowed = false;
  const fakeDb = {
    user: {
      findFirst: async ({ where }) => {
        lookedUp = true;
        assert.deepEqual(where, { id: 'target-1', role: 'TEACHER' });
        return null;
      },
    },
    course: {
      findUnique: async ({ where }) => {
        lookedUp = true;
        assert.deepEqual(where, { id: 'target-1' });
        return null;
      },
    },
  };
  new Function('require', 'module', 'exports', routeCode)(
    (name) =>
      ({
        'next/server': { NextResponse: { json: (_body, options) => ({ status: options.status }) } },
        '@/lib/server/admin-auth': {
          requireAdmin: async () =>
            allowed ? { identity: { userId: 'admin-1' } } : { response: { status: 401 } },
        },
        '@/lib/server/prisma-safe': { getOptionalPrisma: () => fakeDb },
        '@/lib/server/admin-course-export': { buildAdminCourseArchive, archiveResponse },
      })[name],
    route,
    route.exports,
  );
  const context = { params: Promise.resolve({ id: 'target-1', teacherId: 'target-1' }) };
  assert.equal((await route.exports.GET(new Request('http://localhost'), context)).status, 401);
  assert.equal(lookedUp, false, `${expectedLookup} lookup must require admin authentication`);
  allowed = true;
  assert.equal((await route.exports.GET(new Request('http://localhost'), context)).status, 404);
  assert.equal(lookedUp, true, `${expectedLookup} must be checked before export`);
}
console.log('PASS admin export routes: authentication and target scoping');
