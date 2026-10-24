import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createJiti } from 'jiti';

const root = path.resolve(import.meta.dirname, '../..');
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const { getNativeStoreCourseDetail } = jiti('../../lib/server/native-store.ts');
const { findPublicStoreCourseDetail } = jiti('../../lib/server/repositories/store-repository.ts');

function fixture({ listed = true } = {}) {
  const courseId = 'institution-course';
  const course = {
    id: courseId,
    ownerId: 'institution-owner',
    name: 'CSC108',
    courseCode: 'CSC108',
    description: null,
    avatarUrl: null,
    organization: { id: 'institution', name: 'Speedup', logoUrl: null, verified: false },
    notebookCount: 1,
    sceneCount: 0,
    publishedProblemCount: 0,
    purpose: 'university',
    university: null,
    tags: [],
    notebooks: [],
    _count: { notebooks: 1 },
    updatedAt: new Date('2026-10-23T12:00:00Z'),
  };
  const notebooks = [
    { id: 'official', ownerId: course.ownerId, courseId, removedAt: null },
    { id: 'viewer-private', ownerId: 'viewer', courseId, removedAt: null },
    { id: 'other-student-private', ownerId: 'other-student', courseId, removedAt: null },
    { id: 'removed-official', ownerId: course.ownerId, courseId, removedAt: new Date() },
  ].map((row) => ({
    ...row,
    name: row.id,
    description: null,
    sceneCount: 0,
    publishedProblemCount: 0,
  }));
  let notebookReads = 0;
  const readNotebooks = async ({ where }) => {
    notebookReads += 1;
    return notebooks.filter((row) => {
      if (where.courseId && row.courseId !== where.courseId) return false;
      if (where.removedAt === null && row.removedAt !== null) return false;
      if (where.ownerId?.not && row.ownerId === where.ownerId.not) return false;
      if (where.owner?.courses?.some?.id) return row.ownerId === course.ownerId;
      return true;
    });
  };
  const db = {
    course: {
      findMany: async () => (listed ? [course] : []),
      findFirst: async ({ include }) =>
        listed ? { ...course, notebooks: await readNotebooks(include.notebooks) } : null,
    },
    coursePurchase: { findMany: async () => [] },
    courseEnrollment: { groupBy: async () => [] },
    courseReview: { groupBy: async () => [], findMany: async () => [] },
    notebook: { findMany: readNotebooks },
    $queryRaw: async () => [],
  };
  return { db, courseId, notebookReads: () => notebookReads };
}

test('App storefront detail exposes institution notebooks, excluding every student private layer', async () => {
  const { db, courseId } = fixture();
  const detail = await getNativeStoreCourseDetail(db, 'viewer', courseId);
  assert.deepEqual(
    detail.notebooks.map((row) => row.id),
    ['official'],
  );
});

test('web storefront detail uses the same institution-only notebook boundary', async () => {
  const { db, courseId } = fixture();
  const detail = await findPublicStoreCourseDetail(db, 'viewer', courseId);
  assert.deepEqual(
    detail.notebooks.map((row) => row.id),
    ['official'],
  );
});

test('unlisted courses do not trigger a notebook detail read', async () => {
  const { db, courseId, notebookReads } = fixture({ listed: false });
  assert.equal(await getNativeStoreCourseDetail(db, 'viewer', courseId), null);
  assert.equal(notebookReads(), 0);
});
