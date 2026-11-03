/** Publication regression test. Uses only a disposable local PostgreSQL database;
 * every fixture and release is rolled back. Never loads application env files. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { PrismaClient } from '@prisma/client';

const url = new URL(process.env.COURSE_RELEASE_TEST_DATABASE_URL || 'invalid:');
assert.match(url.protocol, /^postgres(?:ql)?:$/);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local fixtures only');
const root = fileURLToPath(new URL('../../', import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const db = new PrismaClient({ datasources: { db: { url: url.href } } });
const { stageContent, contentDrafts, undoContentDraft } = await jiti.import(
  root + 'lib/server/course-content-drafts.ts',
);
const { managedReleaseStatus } = await jiti.import(
  root + 'lib/server/course-content-management.ts',
);
const { releaseCourseVersion, courseUpdateSummariesForUser } = await jiti.import(
  root + 'lib/server/store-course-layers.ts',
);
const { readNativeProblems } = await jiti.import(root + 'lib/server/native-problem-sync.ts');
const rollback = new Error('EXPECTED_ROLLBACK');
try {
  await assert.rejects(
    db.$transaction(
      async (tx) => {
        const owner = await tx.user.create({ data: { email: `${randomUUID()}@example.invalid` } });
        const student = await tx.user.create({
          data: { email: `${randomUUID()}@example.invalid` },
        });
        const course = await tx.course.create({
          data: {
            ownerId: owner.id,
            name: 'Pending release regression',
            tags: [],
            contentVersion: 18,
          },
        });
        const notes = Array.from({ length: 4 }, () => randomUUID());
        const problems = Array.from({ length: 187 }, () => randomUUID());
        await tx.notebook.createMany({
          data: notes.map((id) => ({
            id,
            courseId: course.id,
            ownerId: owner.id,
            name: id,
            tags: [],
            notebookKind: 'markdown',
          })),
        });
        await tx.notebookProblem.createMany({
          data: problems.map((id, order) => ({
            id,
            courseId: course.id,
            title: id,
            order,
            tags: [],
            type: 'short_answer',
            status: 'published',
            publicContentJson: { type: 'short_answer', stem: 'Explain even numbers.' },
            gradingJson: {
              type: 'short_answer',
              referenceAnswer: 'Divisible by two.',
              rubric: 'Correctly explain divisibility by two.',
            },
          })),
        });
        await tx.courseEnrollment.create({
          data: {
            userId: student.id,
            courseId: course.id,
            seenContentVersion: 18,
            newSinceVersion: 18,
          },
        });
        const status = () => managedReleaseStatus(tx, owner.id, course.id);
        const snapshot = () => readNativeProblems(tx, student.id, course.id, null);
        const transactional = new Proxy(tx, {
          get(target, key) {
            if (key === '$transaction')
              return async (work) => {
                await tx.$executeRawUnsafe('SAVEPOINT pending_release');
                try {
                  const result = await work(tx);
                  await tx.$executeRawUnsafe('RELEASE SAVEPOINT pending_release');
                  return result;
                } catch (error) {
                  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT pending_release');
                  throw error;
                }
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        const release = () => releaseCourseVersion(transactional, course.id, owner.id);
        const empty = {
          addedProblems: 0,
          updatedProblems: 0,
          addedNotebooks: 0,
          updatedNotebooks: 0,
          deletions: 0,
        };

        assert.equal(
          (await status()).total,
          0,
          '187 live questions + 4 live notes must not count as 191 pending changes',
        );
        assert.equal(
          (await snapshot()).problemIds.length,
          187,
          'All live questions remain visible',
        );
        const before = await tx.course.findUniqueOrThrow({ where: { id: course.id } });
        assert.deepEqual(await release(), { version: 18, ...empty });
        assert.deepEqual(
          await tx.course.findUniqueOrThrow({ where: { id: course.id } }),
          before,
          'No-op release must not mutate course metadata',
        );
        assert.equal(
          (await tx.notebookProblem.findUniqueOrThrow({ where: { id: problems[0] } }))
            .releaseAddedIn,
          null,
          'No-op must not stamp legacy content',
        );
        console.log(
          'PASS: already-visible 191 items are excluded; empty publication preserves course version and content.',
        );

        await tx.notebookProblem.update({
          where: { id: problems[0] },
          data: { title: 'Direct live change' },
        });
        await tx.notebook.update({
          where: { id: notes[0] },
          data: { contentVersion: { increment: 1 } },
        });
        assert.equal(
          (await status()).total,
          0,
          'Changes already applied by another entry point are not pending',
        );
        await stageContent(tx, owner.id, course.id, 'problems', null, {
          title: 'Unready draft',
          text: 'Incomplete',
        });
        assert.equal((await status()).draftCount, 1);
        assert.equal((await status()).total, 0);
        assert.deepEqual(await release(), { version: 18, ...empty });
        assert.equal((await contentDrafts(tx, course.id)).length, 1, 'Unready draft retained');
        console.log(
          'PASS: direct live changes and unready question drafts do not create pending publication.',
        );

        await stageContent(tx, owner.id, course.id, 'notes', notes[0], { title: 'Updated note' });
        await stageContent(tx, owner.id, course.id, 'problems', problems[0], {
          title: 'Updated question',
        });
        await stageContent(tx, owner.id, course.id, 'notes', null, {
          title: 'New note',
          text: '# New',
        });
        await stageContent(tx, owner.id, course.id, 'problems', null, {
          title: 'New question',
          type: 'short_answer',
          status: 'published',
          publicContent: { type: 'short_answer', stem: 'Explain odd numbers.' },
          grading: {
            type: 'short_answer',
            referenceAnswer: 'Not divisible by two.',
            rubric: 'Explain the remainder of one when divided by two.',
          },
        });
        await stageContent(tx, owner.id, course.id, 'problems', problems[1], {}, true);
        const pending = await status();
        assert.equal(pending.total, 5);
        const expected = {
          addedProblems: 1,
          updatedProblems: 1,
          addedNotebooks: 1,
          updatedNotebooks: 1,
          deletions: 1,
        };
        for (const [key, value] of Object.entries(expected)) assert.equal(pending[key], value, key);
        assert.equal(
          (await snapshot()).problems.find((row) => row.id === problems[0]).title,
          'Direct live change',
          'Draft edit remains private',
        );
        assert.ok((await snapshot()).problemIds.includes(problems[1]), 'Deletion not yet applied');
        assert.equal((await snapshot()).problemIds.length, 187, 'New draft not yet visible');
        assert.deepEqual(await release(), { version: 19, ...expected });
        assert.equal((await status()).total, 0);
        assert.equal((await status()).draftCount, 1);
        const published = await snapshot();
        assert.equal(
          published.problems.find((row) => row.id === problems[0]).title,
          'Updated question',
        );
        assert.ok(!published.problemIds.includes(problems[1]));
        const added = published.problems.find((row) => row.title === 'New question');
        assert.equal(added.releaseAddedIn, 19);
        const updated = await tx.notebookProblem.findUniqueOrThrow({ where: { id: problems[0] } });
        assert.equal(updated.releaseUpdatedIn, 19);
        assert.equal(updated.releaseAddedIn, 0, 'Legacy question is updated, not re-added');
        assert.equal(
          (await tx.notebook.findUniqueOrThrow({ where: { id: notes[0] } })).releaseUpdatedIn,
          19,
        );
        assert.equal(
          (await tx.notebookProblem.findUniqueOrThrow({ where: { id: problems[2] } }))
            .releaseAddedIn,
          null,
          'Untouched live questions must not get false new badges',
        );
        const summary = (await courseUpdateSummariesForUser(tx, student.id, [course.id])).get(
          course.id,
        );
        for (const key of [
          'addedProblems',
          'updatedProblems',
          'addedNotebooks',
          'updatedNotebooks',
        ])
          assert.equal(summary[key], 1, `Student summary ${key}`);
        assert.deepEqual(
          await release(),
          { version: 19, ...empty },
          'Repeat publication is idempotent',
        );
        console.log(
          'PASS: only staged additions/edits/deletion publish; counts match student visibility and version badges.',
        );

        await stageContent(tx, owner.id, course.id, 'notes', notes[1], {
          title: 'Cancelled change',
        });
        assert.equal((await status()).total, 1);
        await undoContentDraft(tx, owner.id, course.id, 'notes', notes[1]);
        assert.equal((await status()).total, 0);
        await stageContent(tx, owner.id, course.id, 'notes', notes[1], {}, true);
        assert.deepEqual(await release(), { version: 20, ...empty, deletions: 1 });
        assert.ok((await tx.notebook.findUniqueOrThrow({ where: { id: notes[1] } })).removedAt);
        assert.equal((await status()).total, 0);
        console.log(
          'PASS: undo clears pending count; deletion-only release applies and advances one version.',
        );
        throw rollback;
      },
      { timeout: 60000 },
    ),
    (error) => error === rollback,
  );
} finally {
  await db.$disconnect();
}
