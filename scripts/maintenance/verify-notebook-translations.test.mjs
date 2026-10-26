import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const moduleUrl = (source) =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
const { groupNotebookTranslations, notebookVariants, notebookSearchText } = await import(
  moduleUrl(compile(read('apps/native/src/lib/notebook-translations.ts')))
);
const notebook = (id, language, number = 1, courseId = 'course') => ({
  id,
  courseId,
  name: `[${language === 'en' ? 'EN' : '中文'}] ${String(number).padStart(2, '0')} ${language === 'en' ? 'Sets' : '集合'}`,
  kind: 'markdown',
  sectionCount: 4,
  tags: [
    `translation-source:${String(number).padStart(64, '0')}`,
    `translation-language:${language}`,
  ],
});

test('24 stored editions become 12 ordered lectures, searchable in both languages', () => {
  const stored = Array.from({ length: 12 }, (_, i) => [
    notebook(`en-${i}`, 'en', i + 1),
    notebook(`zh-${i}`, 'zh-CN', i + 1),
  ]).flat();
  const before = JSON.stringify(stored);
  const grouped = groupNotebookTranslations(stored);
  assert.equal(grouped.length, 12);
  assert.equal(grouped[0].name, '01 集合');
  assert.equal(grouped.at(-1).name, '12 集合');
  for (const lecture of grouped) {
    assert.equal(notebookVariants(stored, lecture.id).length, 2);
    assert.match(notebookSearchText(stored, lecture.id), /sets/);
    assert.match(notebookSearchText(stored, lecture.id), /集合/);
  }
  assert.equal(JSON.stringify(stored), before);
});

test('same number alone, different courses and ambiguous copies never merge', () => {
  const pair = [notebook('en', 'en'), notebook('zh', 'zh-CN')];
  assert.equal(groupNotebookTranslations(pair).length, 1);
  assert.equal(groupNotebookTranslations(pair.map((n) => ({ ...n, tags: [] }))).length, 2);
  assert.equal(groupNotebookTranslations([pair[0], { ...pair[1], courseId: 'other' }]).length, 2);
  assert.equal(groupNotebookTranslations([...pair, { ...pair[0], id: 'copy' }]).length, 3);
  assert.equal(groupNotebookTranslations([pair[0]]).length, 1);
  assert.equal(groupNotebookTranslations([{ ...pair[0], tags: [] }])[0].name, pair[0].name);
});

test('sync exposes only source-verified language metadata and preserves readable IDs', async () => {
  const dependencies = moduleUrl(`
    export const createEmptyLearnerCourseState=()=>({});
    export const isLearnerCourseState=()=>false;
    export const previewLearnerProgressCheckpoint=()=>({});
    export const upsertMemoryFact=async()=>{};
    export const listReadableNotebookLibraryItems=async db=>db.readable;
    export const canReadCourseNotebook=async()=>true;
    export const listStudyMemoriesForViewer=async()=>[];
    export const resolveReadableStudyMemoryTarget=async db=>db.allowed?{}:null;
  `);
  let source = compile(read('lib/server/native-course-sync.ts'));
  source = source.replace(/from '(@\/[^']+)'/g, `from '${dependencies}'`);
  const { buildNativeCourseData, buildNativeNotebookArchive } = await import(moduleUrl(source));
  const row = {
    ...notebook('en', 'en'),
    language: 'en',
    notebookKind: 'markdown',
    coverSlideJson: { sourceSha256: 'a'.repeat(64) },
    tags: ['teacher-course'],
    ownerId: 'owner',
    removedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let metadataQuery;
  const db = {
    allowed: true,
    readable: [row],
    notebook: {
      findMany: async (query) => {
        metadataQuery = query;
        return [row];
      },
      findUnique: async () => row,
    },
    memoryFact: { findFirst: async () => null },
    learningCalendarEvent: { findMany: async () => [] },
    backgroundJob: { findMany: async () => [] },
    notebookPage: { findMany: async () => [] },
    scene: { findMany: async () => [] },
    markdownNotebookSection: { findMany: async () => [] },
  };
  const synced = await buildNativeCourseData(db, 'viewer', 'course');
  assert.deepEqual(metadataQuery.where, { id: { in: ['en'] } });
  assert.equal(synced.notebooks[0].id, 'en');
  assert.deepEqual(synced.notebooks[0].tags, [
    'teacher-course',
    `translation-source:${'a'.repeat(64)}`,
    'translation-language:en',
  ]);
  const detail = await buildNativeNotebookArchive(db, 'viewer', 'en');
  assert.deepEqual(detail.notebook.tags, synced.notebooks[0].tags);
  row.coverSlideJson = {};
  assert.deepEqual((await buildNativeCourseData(db, 'viewer', 'course')).notebooks[0].tags, [
    'teacher-course',
  ]);
  db.allowed = false;
  assert.equal(await buildNativeCourseData(db, 'viewer', 'course'), null);
});
