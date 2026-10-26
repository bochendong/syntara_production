import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { createJiti } from 'jiti';
const jiti = createJiti(import.meta.url, { alias: { '@': path.resolve('.') } });
const { archiveAdminCourseSource, CourseSourceArchiveConflict } = await jiti.import(
  '../../lib/server/admin-course-source-archive.ts',
);
test('original archive preview is read-only; commit and replay preserve exact bytes and course owner', async () => {
  let row = null;
  let writes = 0;
  const db = {
    $transaction: async (fn) => fn(db),
    course: { findUnique: async () => ({ id: 'course', ownerId: 'owner' }) },
    courseSource: {
      findUnique: async () => row,
      create: async ({ data }) => {
        writes++;
        row = { id: 'source', ...data };
        return row;
      },
    },
  };
  const input = {
    courseId: 'course',
    actorId: 'admin',
    name: 'original.zip',
    mime: 'application/zip',
    bytes: new Uint8Array([80, 75, 1, 2]),
    apply: false,
  };
  const preview = await archiveAdminCourseSource(db, input);
  assert.equal(writes, 0);
  await assert.rejects(
    () => archiveAdminCourseSource(db, { ...input, apply: true, expectedHash: 'wrong' }),
    CourseSourceArchiveConflict,
  );
  const applied = await archiveAdminCourseSource(db, {
    ...input,
    apply: true,
    expectedHash: preview.payloadHash,
  });
  assert.equal(applied.mode, 'saved');
  assert.equal(row.ownerId, 'owner');
  assert.equal(row.metadataJson.uploadedByAdmin, 'admin');
  assert.deepEqual([...row.fileData], [...input.bytes]);
  assert.equal(row.indexStatus, 'skipped');
  const replay = await archiveAdminCourseSource(db, {
    ...input,
    apply: true,
    expectedHash: preview.payloadHash,
  });
  assert.equal(replay.replayed, true);
  assert.equal(writes, 1);
  row.title = 'Different original.zip';
  await assert.rejects(() => archiveAdminCourseSource(db, input), CourseSourceArchiveConflict);
  assert.equal(writes, 1);
});
