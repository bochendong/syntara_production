import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('.') } });
const {
  readCourseProblemLocalizations,
  updateCourseProblemLocalizations,
  ProblemLocalizationConflict,
  courseProblemLocalizationsSchema,
} = await jiti.import('../../lib/server/course-problem-localizations.ts');
function fixture() {
  let row = {
    id: 'p',
    courseId: 'course',
    title: 'English',
    type: 'choice',
    status: 'published',
    difficulty: 'medium',
    publicContentJson: {
      type: 'choice',
      stem: 'Which?',
      options: [
        { id: 'A', label: 'One' },
        { id: 'B', label: 'Two' },
      ],
    },
    gradingJson: { type: 'choice', correctOptionIds: ['A'] },
    sourceMeta: { source: 'fixture' },
    chapter: { name: 'Sets' },
    updatedAt: new Date('2026-10-26T00:00:00Z'),
  };
  let versions = 0;
  const untouched = {
    attempts: [{ id: 'attempt', answer: { selectedOptionIds: ['A'] } }],
    progress: [{ attemptedCount: 1, status: 'passed' }],
  };
  const db = {
    notebookProblem: {
      findMany: async ({ where }) =>
        where.courseId === row.courseId && (!where.id || where.id.in.includes(row.id))
          ? [structuredClone(row)]
          : [],
      updateMany: async ({ where, data }) => {
        if (where.updatedAt.getTime() !== row.updatedAt.getTime()) return { count: 0 };
        row = { ...row, ...data, updatedAt: new Date('2026-10-26T01:00:00Z') };
        return { count: 1 };
      },
    },
    course: {
      update: async () => {
        versions++;
      },
    },
    $transaction: async (fn) => {
      const before = structuredClone(row);
      const v = versions;
      try {
        return await fn(db);
      } catch (e) {
        row = before;
        versions = v;
        throw e;
      }
    },
  };
  return {
    db,
    get row() {
      return row;
    },
    get versions() {
      return versions;
    },
    untouched,
  };
}
const content = {
  title: '集合选择题',
  chapterName: '集合',
  stem: '选择哪一个？',
  options: [
    { id: 'A', label: '一' },
    { id: 'B', label: '二' },
  ],
};
async function patch(f) {
  const current = await readCourseProblemLocalizations(f.db, 'course');
  return { changes: [{ id: 'p', expectedRevision: current.problems[0].revision, content }] };
}
test('preview and apply translations on published questions preserve original content, grading and learner history', async () => {
  const f = fixture(),
    input = await patch(f),
    before = structuredClone(f.row),
    history = structuredClone(f.untouched);
  const preview = await updateCourseProblemLocalizations(f.db, 'course', input);
  assert.equal(preview.mode, 'preview');
  assert.deepEqual(f.row, before);
  const result = await updateCourseProblemLocalizations(f.db, 'course', { ...input, apply: true });
  assert.equal(result.updated, 1);
  assert.equal(f.versions, 1);
  const { translations, ...base } = f.row.publicContentJson;
  assert.deepEqual(base, before.publicContentJson);
  assert.deepEqual(translations['zh-CN'], content);
  assert.deepEqual(f.row.gradingJson, before.gradingJson);
  assert.deepEqual(f.untouched, history);
  assert.equal(f.row.status, 'published');
  assert.equal(f.row.title, 'English');
  const repeat = await updateCourseProblemLocalizations(f.db, 'course', { ...input, apply: true });
  assert.equal(repeat.updated, 0);
  assert.equal(f.versions, 1);
});
test('foreign IDs, stale revisions and reordered options are rejected without writes', async () => {
  for (const change of [
    { id: 'foreign' },
    { expectedRevision: '0'.repeat(64) },
    { content: { ...content, options: [...content.options].reverse() } },
  ]) {
    const f = fixture(),
      input = await patch(f),
      before = structuredClone(f.row);
    input.changes[0] = { ...input.changes[0], ...change };
    await assert.rejects(
      () => updateCourseProblemLocalizations(f.db, 'course', { ...input, apply: true }),
      ProblemLocalizationConflict,
    );
    assert.deepEqual(f.row, before);
    assert.equal(f.versions, 0);
  }
});
test('the localization contract rejects unrelated replacement fields', () => {
  assert.equal(
    courseProblemLocalizationsSchema.safeParse({
      changes: [
        {
          id: 'p',
          expectedRevision: 'a'.repeat(64),
          content,
          grading: { correctOptionIds: ['B'] },
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    courseProblemLocalizationsSchema.safeParse({
      changes: [
        { id: 'p', expectedRevision: 'a'.repeat(64), content: { ...content, type: 'proof' } },
      ],
    }).success,
    false,
  );
});
