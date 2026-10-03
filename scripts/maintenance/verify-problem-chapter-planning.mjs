import assert from 'node:assert/strict';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { chapterArchivePlanSchema, normalizeChapterArchivePlan, chapterArchiveProblemText } =
  await jiti.import('../../lib/server/problem-chapter-plan.ts');
const plan = chapterArchivePlanSchema.parse({
  chapters: [
    { key: 'new-limits', name: 'Limits', description: 'Limits and continuity' },
    { key: 'new-limits', name: 'Duplicate', description: '' },
    { key: 'unused', name: 'Unused', description: '' },
    { key: 'existing', name: 'Overwrite', description: '' },
  ],
  assignments: [
    { problemId: 'p1', chapterId: 'new-limits' },
    { problemId: 'p1', chapterId: 'existing' },
    { problemId: 'p2', chapterId: 'existing' },
    { problemId: 'outside-course', chapterId: 'existing' },
    { problemId: 'p3', chapterId: 'outside-chapter' },
  ],
});
const normalized = normalizeChapterArchivePlan(
  plan,
  new Set(['p1', 'p2', 'p3']),
  new Set(['existing']),
);
assert.deepEqual(normalized.chapters, [plan.chapters[0]]);
assert.deepEqual(normalized.assignments, [plan.assignments[0], plan.assignments[2]]);
assert.equal(
  chapterArchiveProblemText({
    stem: 'Estimate the derivative.',
    assets: { images: [{ src: 'data:image/png;base64,PRIVATE' }] },
    grading: { referenceAnswer: 'PRIVATE ANSWER' },
  }),
  'Estimate the derivative.',
);
assert.equal(chapterArchiveProblemText({ stemTemplate: 'Find {{blank1}}.' }), 'Find {{blank1}}.');
assert.equal(chapterArchiveProblemText(null), '');
assert.equal(chapterArchiveProblemText({ stem: 'x'.repeat(10000) }).length, 2400);
assert.equal(
  chapterArchivePlanSchema.safeParse({
    chapters: [],
    assignments: Array.from({ length: 81 }, () => ({ problemId: 'p', chapterId: 'c' })),
  }).success,
  false,
);
console.log(
  'PASS: new chapter references, deduplication, ownership boundaries, unused chapter removal, prompt privacy and batch limits',
);
