import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createJiti } from 'jiti';

const jiti = createJiti(import.meta.url);
const { courseProblemRevision } = await jiti.import(
  '../../lib/server/admin-course-problem-upload.ts',
);
const { reviseCourseProblems, CourseProblemRevisionConflict } = await jiti.import(
  '../../lib/server/course-problem-revisions.ts',
);

const row = (id, type = 'short_answer') => ({
  id,
  courseId: 'course',
  ownerId: null,
  title: id,
  status: 'published',
  type,
  difficulty: 'medium',
  updatedAt: new Date('2026-11-20T00:00:00.000Z'),
  publicContentJson: { type, stem: 'Original prompt' },
  gradingJson: { type, referenceAnswer: 'Original answer' },
  sourceMeta: { paper: 'original' },
});
const target = (problem) => ({
  id: problem.id,
  expectedRevision: courseProblemRevision(problem),
});
const options = [
  { id: 'a', label: 'First' },
  { id: 'b', label: 'Second' },
];
const convert = (problem) => ({
  ...target(problem),
  action: 'convert-to-choice',
  publicContent: {
    type: 'choice',
    stem: 'Choose one',
    selectionMode: 'single',
    options,
    translations: {
      'en-US': { stem: 'Choose one', options },
      'zh-CN': { stem: '请选择一项', options },
    },
  },
  grading: { type: 'choice', graderKind: 'exact_choice', correctOptionIds: ['b'] },
});

function fixture(...rows) {
  let version = 1;
  const state = new Map(rows.map((item) => [item.id, structuredClone(item)]));
  return {
    state,
    version: () => version,
    db: {
      async $transaction(work) {
        const next = structuredClone(state);
        let revision = version;
        const result = await work({
          notebookProblem: {
            findMany: async ({ where }) =>
              [...next.values()].filter(
                (p) =>
                  p.ownerId === where.ownerId &&
                  p.courseId === where.courseId &&
                  where.id.in.includes(p.id),
              ),
            updateMany: async ({ where, data }) => {
              const p = next.get(where.id);
              assert.equal(p.courseId, where.courseId);
              assert.equal(p.status, where.status);
              assert.deepEqual(p.updatedAt, where.updatedAt);
              next.set(p.id, { ...p, ...data, updatedAt: new Date('2026-11-22T00:00:00.000Z') });
              return { count: 1 };
            },
          },
          course: {
            update: async ({ data }) => {
              revision += data.contentVersion.increment;
            },
          },
        });
        for (const [id, item] of next) state.set(id, item);
        version = revision;
        return result;
      },
    },
  };
}

test('previews then converts, archives and updates presentation on the same question IDs', async () => {
  const original = row('convert');
  const proof = row('proof', 'proof');
  const code = row('display', 'code');
  code.publicContentJson.statementSections = [
    { id: 'requirements', code: 'for i in range(n):', codeLanguage: 'text' },
  ];
  const untouched = row('unrelated');
  const { state, db, version } = fixture(original, proof, code, untouched);
  const input = {
    changes: [
      convert(original),
      { ...target(proof), action: 'archive' },
      {
        ...target(code),
        action: 'display',
        sections: [{ id: 'requirements', codeLanguage: 'python' }],
      },
    ],
  };
  assert.equal((await reviseCourseProblems(db, 'course', input)).updated, 0);
  assert.equal(version(), 1);
  assert.deepEqual(state.get('convert'), original);

  assert.equal((await reviseCourseProblems(db, 'course', { ...input, apply: true })).updated, 3);
  assert.equal(version(), 2);
  assert.equal(state.get('convert').type, 'choice');
  assert.deepEqual(state.get('convert').sourceMeta, original.sourceMeta);
  assert.equal(state.get('proof').status, 'archived');
  assert.deepEqual(state.get('proof').gradingJson, proof.gradingJson);
  assert.equal(state.get('display').publicContentJson.statementSections[0].codeLanguage, 'python');
  assert.deepEqual(state.get('display').gradingJson, code.gradingJson);
  assert.deepEqual(state.get('unrelated'), untouched);
  assert.equal((await reviseCourseProblems(db, 'course', { ...input, apply: true })).unchanged, 3);
  assert.equal(version(), 2);
});

test('rejects stale, foreign and private questions as well as invalid option IDs', async () => {
  const question = row('question');
  const foreign = { ...row('foreign'), courseId: 'other' };
  const privateQuestion = { ...row('private'), ownerId: 'student' };
  const { db, version } = fixture(question, foreign, privateQuestion);
  const stale = { ...convert(question), expectedRevision: '0'.repeat(64) };
  const invalid = { ...convert(question), grading: { type: 'choice', correctOptionIds: ['x'] } };
  for (const proposal of [stale, invalid, convert(foreign), convert(privateQuestion)]) {
    await assert.rejects(
      reviseCourseProblems(db, 'course', { changes: [proposal], apply: true }),
      CourseProblemRevisionConflict,
    );
  }
  assert.equal(version(), 1);
});
