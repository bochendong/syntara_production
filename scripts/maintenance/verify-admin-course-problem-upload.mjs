#!/usr/bin/env node
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';

const here = dirname(fileURLToPath(import.meta.url));
const { courseProblemRevision, previewCourseProblemUpload, applyCourseProblemUpload } = createJiti(
  import.meta.url,
  { interopDefault: true },
)(join(here, '../../lib/server/admin-course-problem-upload.ts'));

const row = {
  id: 'problem-1',
  courseId: 'course-1',
  title: 'Example',
  type: 'short_answer',
  status: 'draft',
  difficulty: 'medium',
  publicContentJson: { type: 'short_answer', stem: 'What is two plus two?' },
  gradingJson: { type: 'short_answer', referenceAnswer: '4' },
  sourceMeta: { original: true },
  updatedAt: new Date('2026-09-25T00:00:00.000Z'),
};
let updates = 0;
const db = {
  course: {
    findUnique: async ({ where }) => (where.id === 'course-1' ? { id: 'course-1' } : null),
  },
  notebookProblemAttempt: { count: async () => 0 },
  notebookProblem: {
    findMany: async ({ where }) =>
      where.courseId === row.courseId && where.id.in.includes(row.id) ? [row] : [],
    updateMany: async ({ where, data }) => {
      assert.equal(where.courseId, 'course-1');
      assert.equal(where.status, 'draft');
      assert.equal(where.updatedAt, row.updatedAt);
      assert.equal(data.type, 'choice');
      assert.equal(data.publicContentJson.type, 'choice');
      updates++;
      return { count: 1 };
    },
  },
  $transaction: async (callback) => callback(db),
};

const change = {
  id: row.id,
  expectedRevision: courseProblemRevision(row),
  type: 'choice',
  publicContent: {
    type: 'choice',
    stem: 'What is two plus two?',
    selectionMode: 'single',
    options: [
      { id: 'a', label: '4' },
      { id: 'b', label: '5' },
    ],
  },
  grading: { type: 'choice', correctOptionIds: ['a'] },
};

assert.equal(
  (await previewCourseProblemUpload(db, { courseId: 'course-1', changes: [change] })).count,
  1,
);
await assert.rejects(
  previewCourseProblemUpload(db, { courseId: 'course-2', changes: [change] }),
  /Course not found/,
);
await assert.rejects(
  previewCourseProblemUpload(db, {
    courseId: 'course-1',
    changes: [{ ...change, expectedRevision: '0'.repeat(64) }],
  }),
  /changed since export/,
);
await assert.rejects(
  previewCourseProblemUpload(db, {
    courseId: 'course-1',
    changes: [{ ...change, grading: { type: 'choice', correctOptionIds: ['missing'] } }],
  }),
  /valid answer/,
);
db.notebookProblemAttempt.count = async () => 1;
await assert.rejects(
  previewCourseProblemUpload(db, { courseId: 'course-1', changes: [change] }),
  /student attempts/,
);
db.notebookProblemAttempt.count = async () => 0;
assert.equal(
  (await applyCourseProblemUpload(db, { courseId: 'course-1', changes: [change] })).updated.length,
  1,
);
assert.equal(updates, 1);
console.log('admin course problem upload: preview, scope, revision, answer, apply checks passed');
