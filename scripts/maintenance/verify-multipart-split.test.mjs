import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('.') } });
const { splitCourseMultipartGroups, splitGroupId } = await jiti.import(
  '../../lib/server/course-problem-multipart-split.ts',
);
const { courseProblemRevision } = await jiti.import(
  '../../lib/server/admin-course-problem-upload.ts',
);
function setup() {
  const original = {
    id: 'source',
    courseId: 'course',
    notebookId: null,
    chapterId: 'chapter',
    ownerId: null,
    title: 'Twenty independent limits',
    type: 'short_answer',
    status: 'published',
    source: 'manual',
    order: 4,
    problemNumber: 12,
    points: 100,
    tags: ['limits'],
    difficulty: 'medium',
    publicContentJson: { type: 'short_answer', stem: 'Original twenty tasks' },
    gradingJson: { type: 'short_answer', referenceAnswer: 'Original full answer' },
    sourceMeta: { file: 'source.pdf' },
    updatedAt: new Date('2026-01-01'),
  };
  let rows = [structuredClone(original)],
    version = 0;
  const tx = {
    course: {
      findUnique: async ({ where }) => (where.id === 'course' ? { id: 'course' } : null),
      update: async () => {
        version++;
      },
    },
    notebookProblem: {
      findMany: async ({ where }) =>
        rows.filter(
          (r) =>
            r.courseId === where.courseId &&
            (!where.id?.in || where.id.in.includes(r.id)) &&
            (!where.id?.notIn || !where.id.notIn.includes(r.id)) &&
            (!where.dedupeKey || where.dedupeKey.in.includes(r.dedupeKey)),
        ),
      aggregate: async () => ({
        _max: { problemNumber: Math.max(...rows.map((r) => r.problemNumber)) },
      }),
      create: async ({ data }) => {
        assert(!rows.some((r) => r.id === data.id));
        rows.push({ ...data, updatedAt: new Date('2026-01-02') });
      },
      updateMany: async ({ where, data }) => {
        const r = rows.find((r) => r.id === where.id && +r.updatedAt === +where.updatedAt);
        if (!r) return { count: 0 };
        Object.assign(r, data, { updatedAt: new Date('2026-01-02') });
        return { count: 1 };
      },
    },
  };
  const db = {
    $transaction: async (fn) => {
      const before = structuredClone(rows),
        v = version;
      try {
        return await fn(tx);
      } catch (e) {
        rows = before;
        version = v;
        throw e;
      }
    },
  };
  const group = (from, to) => ({
    title: `Limits ${from}–${to}`,
    publicContent: {
      type: 'multipart',
      stem: 'Calculate each limit.',
      parts: Array.from({ length: to - from + 1 }, (_, i) => ({
        label: String(from + i),
        points: 10,
        content: { type: 'short_answer', stem: `Find limit ${from + i}.` },
      })),
    },
    grading: {
      type: 'multipart',
      graderKind: 'per_part',
      parts: Array.from({ length: to - from + 1 }, (_, i) => ({
        label: String(from + i),
        grading: {
          type: 'short_answer',
          referenceAnswer: '3',
          rubricCriteria: [{ id: `answer-${from + i}`, points: 10, description: 'Correct value.' }],
        },
      })),
    },
  });
  const input = {
    reviewHash: 'f'.repeat(64),
    changes: [
      {
        id: original.id,
        expectedRevision: courseProblemRevision(original),
        sourceLabels: Array.from({ length: 20 }, (_, i) => String(i + 1)),
        groups: [group(1, 10), group(11, 20)],
      },
    ],
  };
  return {
    db,
    input,
    original,
    get rows() {
      return rows;
    },
    get version() {
      return version;
    },
  };
}
test('20 independent parts become two ten-part groups; preview is read-only; originals and history are retained; identical replay is read-only', async () => {
  const s = setup();
  const preview = await splitCourseMultipartGroups(s.db, 'course', s.input);
  assert.equal(preview.groups, 2);
  assert.equal(preview.parts, 20);
  assert.equal(s.rows.length, 1);
  assert.equal(s.version, 0);
  const applied = await splitCourseMultipartGroups(s.db, 'course', { ...s.input, apply: true });
  assert.equal(applied.created, 2);
  assert.equal(applied.archived, 1);
  assert.equal(s.version, 1);
  assert.equal(s.rows[0].status, 'archived');
  for (const key of [
    'publicContentJson',
    'gradingJson',
    'title',
    'points',
    'problemNumber',
    'notebookId',
    'chapterId',
  ])
    assert.deepEqual(s.rows[0][key], s.original[key]);
  assert.equal(s.rows[0].sourceMeta.file, 'source.pdf');
  assert.deepEqual(
    s.rows.slice(1).map((r) => r.problemNumber),
    [13, 14],
  );
  assert.deepEqual(
    s.rows.slice(1).map((r) => r.publicContentJson.parts.length),
    [10, 10],
  );
  assert.equal(s.rows[1].id, splitGroupId('course', 'source', 0));
  assert.equal(
    (await splitCourseMultipartGroups(s.db, 'course', { ...s.input, apply: true })).unchanged,
    1,
  );
  assert.equal(s.version, 1);
  assert.equal(s.rows.length, 3);
});
test('stale revisions, foreign courses, missing or repeated parts and over-capacity groups reject before writing', async () => {
  for (const mutate of [
    (i) => {
      i.changes[0].expectedRevision = '0'.repeat(64);
    },
    (i) => {
      i.changes[0].sourceLabels.pop();
    },
    (i) => {
      i.changes[0].groups[1].publicContent.parts[0].label = '1';
    },
    (i) => {
      i.changes[0].groups[0].publicContent.parts.push(
        ...i.changes[0].groups[1].publicContent.parts,
      );
    },
  ]) {
    const s = setup();
    mutate(s.input);
    await assert.rejects(() =>
      splitCourseMultipartGroups(s.db, 'course', { ...s.input, apply: true }),
    );
    assert.equal(s.rows.length, 1);
    assert.equal(s.rows[0].status, 'published');
    assert.equal(s.version, 0);
  }
  const s = setup();
  await assert.rejects(() =>
    splitCourseMultipartGroups(s.db, 'other', { ...s.input, apply: true }),
  );
  assert.equal(s.rows.length, 1);
});
test('a changed replacement cannot be overwritten by replay', async () => {
  const s = setup();
  await splitCourseMultipartGroups(s.db, 'course', { ...s.input, apply: true });
  s.rows[1].title = 'Teacher edited';
  await assert.rejects(() =>
    splitCourseMultipartGroups(s.db, 'course', { ...s.input, apply: true }),
  );
  assert.equal(s.rows[1].title, 'Teacher edited');
  assert.equal(s.version, 1);
});
