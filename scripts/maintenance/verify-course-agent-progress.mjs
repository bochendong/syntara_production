import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';
const root = process.cwd();
const jiti = createJiti(path.join(root, 'package.json'), { alias: { '@': root } });
const { resolveCourseAgentNotebookAccess } = await jiti.import(
  './lib/server/course-agent-notebook-access.ts',
);
let checkpoint;
let limit = 2;
let authorized = true;
const notebooks = [1, 2, 3].map((n) => ({
  id: `n${n}`,
  name: `Lesson ${n}`,
  createdAt: new Date(n * 1000),
  coverSlideJson: { learningOrder: n },
}));
const state = {
  version: 1,
  userId: 'student',
  courseId: 'course',
  completedNotebookIds: [],
  completedProblemIds: [],
  activeWeakPoints: [],
  conceptMastery: {},
  recentQuestions: [],
  recentProblemAttempts: [],
  reviewQueue: [],
};
const db = {
  course: {
    findUnique: async () => (authorized ? { ownerId: 'teacher', externalBinding: null } : null),
  },
  $queryRaw: async () => [{ notebookAccessLimit: limit }],
  notebook: {
    findMany: async (args) => {
      assert.equal(args.where.removedAt, null);
      return notebooks;
    },
  },
  memoryFact: {
    findFirst: async () =>
      checkpoint === undefined ? null : { valueJson: { ...state, progressCheckpoint: checkpoint } },
  },
};
const read = async () =>
  (await resolveCourseAgentNotebookAccess(db, 'student', 'course'))?.allowedNotebookIds;
assert.deepEqual(await read(), ['n1', 'n2'], 'Unknown progress preserves enrollment access');
checkpoint = { source: 'student', kind: 'not_started' };
assert.deepEqual(await read(), [], 'Zero progress must not fall back to all notebooks');
checkpoint = { source: 'student', kind: 'through_notebook', notebookId: 'n1' };
assert.deepEqual(await read(), ['n1'], 'Confirmed checkpoint restricts reads');
checkpoint = { source: 'student', kind: 'completed_all' };
assert.deepEqual(await read(), ['n1', 'n2'], 'Progress cannot expand enrollment permissions');
limit = null;
assert.deepEqual(await read(), ['n1', 'n2', 'n3']);
checkpoint = { source: 'teacher', kind: 'not_started' };
assert.deepEqual(
  await read(),
  ['n1', 'n2', 'n3'],
  'Unconfirmed progress must not impose a student checkpoint',
);
authorized = false;
assert.equal(await read(), undefined, 'Unauthorized users cannot read notebooks');
console.log('PASS: course agent reads respect enrollment and confirmed learning progress.');
