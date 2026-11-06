import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';
import { fileURLToPath } from 'node:url';

const jiti = createJiti(import.meta.url, {
  alias: { '@': fileURLToPath(new URL('../../', import.meta.url)) },
});
const {
  courseProblemTranslationUpdateSchema,
  applyProblemTranslationPatch,
  updateCourseProblemTranslations,
} = await jiti.import('../../lib/server/course-problem-translation-updates.ts');
const { getLocalizedProblemContent } = await jiti.import('../../lib/problem-bank/i18n.ts');
const { courseProblemRevision } = await jiti.import(
  '../../lib/server/admin-course-problem-upload.ts',
);
const change = (fields) => ({ id: 'question', expectedRevision: 'a'.repeat(64), ...fields });
const parse = (fields) => courseProblemTranslationUpdateSchema.parse({ changes: [change(fields)] });

test('code section translations preserve executable code and both language versions', () => {
  const content = {
    type: 'code',
    stem: 'Compute the result.',
    starterCode: 'def f(x: int) -> int:\n    pass',
    statementSections: [
      {
        id: 'task',
        title: 'Task',
        body: 'Compute x.',
        items: ['Use a loop.'],
        code: 'f(1)',
        kind: 'overview',
      },
    ],
    sampleIO: [{ input: 'f(1)', output: '1', explanation: 'One iteration.' }],
    translations: { 'en-US': { stem: 'Compute the result.' } },
  };
  const before = structuredClone(content);
  const input = parse({
    translations: {
      'zh-CN': {
        stem: '计算结果。',
        statementSections: [{ id: 'task', title: '任务', body: '计算 x。', items: ['使用循环。'] }],
        sampleExplanations: [{ index: 0, explanation: '执行一次循环。' }],
      },
    },
  });
  const translated = applyProblemTranslationPatch(content, input.changes[0]);
  assert.deepEqual(content, before);
  assert.equal(translated.starterCode, content.starterCode);
  const zh = getLocalizedProblemContent(translated, 'zh-CN');
  assert.equal(zh.statementSections[0].title, '任务');
  assert.equal(zh.statementSections[0].code, 'f(1)');
  assert.equal(zh.statementSections[0].kind, 'overview');
  assert.equal(zh.sampleIO[0].output, '1');
  assert.equal(zh.sampleIO[0].explanation, '执行一次循环。');
  assert.deepEqual(
    getLocalizedProblemContent(translated, 'en-US').statementSections,
    content.statementSections,
  );
});

test('multipart translation retains labels, weights, dependencies and child code', () => {
  const content = {
    type: 'multipart',
    stem: 'Two tasks.',
    parts: [
      { label: 'a', points: 40, content: { type: 'short_answer', stem: 'Explain.' } },
      {
        label: 'b',
        points: 60,
        dependsOn: ['a'],
        content: { type: 'code', stem: 'Implement.', starterCode: 'pass' },
      },
    ],
  };
  const input = parse({ parts: [{ label: 'b', translations: { 'zh-CN': { stem: '实现。' } } }] });
  const result = applyProblemTranslationPatch(content, input.changes[0]);
  assert.deepEqual(result.parts[0], content.parts[0]);
  assert.equal(result.parts[1].content.starterCode, 'pass');
  assert.deepEqual(result.parts[1].dependsOn, ['a']);
  assert.equal(result.parts[1].points, 60);
  assert.equal(getLocalizedProblemContent(result, 'zh-CN').parts[1].content.stem, '实现。');
  assert.throws(() =>
    applyProblemTranslationPatch(
      content,
      change({ parts: [{ label: 'unknown', translations: { 'zh-CN': { stem: '无' } } }] }),
    ),
  );
});

test('unknown IDs and executable fields cannot enter translation updates', () => {
  const content = {
    type: 'choice',
    options: [
      { id: 'a', label: 'One' },
      { id: 'b', label: 'Two' },
    ],
  };
  assert.throws(() =>
    applyProblemTranslationPatch(
      content,
      change({
        translations: {
          'zh-CN': {
            options: [
              { id: 'b', label: '二' },
              { id: 'a', label: '一' },
            ],
          },
        },
      }),
    ),
  );
  assert.throws(() => parse({ translations: { 'zh-CN': { starterCode: 'print(1)' } } }));
  assert.throws(() =>
    parse({ translations: { 'zh-CN': { statementSections: [{ id: 'task', code: 'print(1)' }] } } }),
  );
  assert.throws(() =>
    applyProblemTranslationPatch(
      { type: 'code', statementSections: [] },
      change({ translations: { 'zh-CN': { statementSections: [{ id: 'new', title: '新增' }] } } }),
    ),
  );
  assert.throws(() =>
    applyProblemTranslationPatch(
      { type: 'code', sampleIO: [] },
      change({
        translations: { 'zh-CN': { sampleExplanations: [{ index: 0, explanation: '不存在' }] } },
      }),
    ),
  );
  assert.throws(() =>
    applyProblemTranslationPatch(
      {
        type: 'table',
        columns: [{ id: 'answer', role: 'answer', cellKind: 'text' }],
        rows: [{ id: 'r', cells: { answer: '' } }],
      },
      change({
        translations: {
          'zh-CN': { tableCells: [{ rowId: 'r', colId: 'answer', value: '泄露答案' }] },
        },
      }),
    ),
  );
});

test('preview never writes, stale revisions reject, matching retries are no-ops', async () => {
  const row = {
    id: 'question',
    courseId: 'course',
    title: 'Explain',
    type: 'short_answer',
    status: 'published',
    difficulty: 'easy',
    publicContentJson: { type: 'short_answer', stem: 'Explain.' },
    gradingJson: { private: 'answer' },
    sourceMeta: {},
    updatedAt: new Date('2026-01-01'),
  };
  const writes = [];
  const tx = {
    notebookProblem: {
      findMany: async () => [row],
      updateMany: async (value) => {
        writes.push(value);
        row.publicContentJson = value.data.publicContentJson;
        return { count: 1 };
      },
    },
    course: { update: async () => {} },
  };
  const db = { $transaction: async (callback) => callback(tx) };
  const input = {
    changes: [
      {
        id: row.id,
        expectedRevision: courseProblemRevision(row),
        translations: { 'zh-CN': { stem: '说明。' } },
      },
    ],
  };
  assert.equal((await updateCourseProblemTranslations(db, 'course', input)).mode, 'preview');
  assert.equal(writes.length, 0);
  await assert.rejects(
    updateCourseProblemTranslations(db, 'course', {
      ...input,
      changes: [{ ...input.changes[0], expectedRevision: 'b'.repeat(64) }],
      apply: true,
    }),
    /changed after review/,
  );
  assert.equal(writes.length, 0);
  assert.equal(
    (await updateCourseProblemTranslations(db, 'course', { ...input, apply: true })).updated,
    1,
  );
  assert.deepEqual(Object.keys(writes[0].data).sort(), ['contentUpdatedAt', 'publicContentJson']);
  assert.deepEqual(row.gradingJson, { private: 'answer' });
  assert.equal(
    (await updateCourseProblemTranslations(db, 'course', { ...input, apply: true })).unchanged,
    1,
  );
  assert.equal(writes.length, 1);
});

test('multipart accepts standard 100-point and legacy weighted rubrics without changing shares', async () => {
  const { normalizeDraftMathFields } = await jiti.import(
    '../../lib/server/notebook-problems/import.core.drafts.ts',
  );
  const draft = {
    draftId: 'parts',
    title: 'Two explanations',
    type: 'multipart',
    status: 'published',
    source: 'manual',
    points: 100,
    tags: [],
    difficulty: 'easy',
    sourceMeta: {},
    validationErrors: [],
    publicContent: {
      type: 'multipart',
      stem: 'Explain the two Boolean expressions.',
      parts: [
        { label: 'a', points: 40, content: { type: 'short_answer', stem: 'Explain conjunction.' } },
        { label: 'b', points: 60, content: { type: 'short_answer', stem: 'Explain disjunction.' } },
      ],
    },
    grading: {
      type: 'multipart',
      parts: ['a', 'b'].map((label) => ({
        label,
        grading: {
          type: 'short_answer',
          referenceAnswer: 'An explanation.',
          rubricCriteria: [{ id: 'correct', description: 'Correct explanation.', points: 100 }],
        },
      })),
    },
  };
  assert.deepEqual(normalizeDraftMathFields(draft).validationErrors, []);
  draft.grading.parts[0].grading.rubricCriteria[0].points = 40;
  draft.grading.parts[1].grading.rubricCriteria[0].points = 60;
  assert.deepEqual(normalizeDraftMathFields(draft).validationErrors, []);
  draft.grading.parts[0].grading.rubricCriteria[0].points = 75;
  assert.match(normalizeDraftMathFields(draft).validationErrors.join('\n'), /评分量表总分/);
  assert.deepEqual(
    draft.publicContent.parts.map((part) => part.points),
    [40, 60],
  );
});
