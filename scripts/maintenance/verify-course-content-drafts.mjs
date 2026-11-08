import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createJiti } from 'jiti';
import { PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const url = process.env.COURSE_DRAFT_TEST_DATABASE_URL;
assert.ok(url, 'Set COURSE_DRAFT_TEST_DATABASE_URL; fixtures run inside a rollback transaction.');
const db = new PrismaClient({ datasources: { db: { url } } });
const drafts = await jiti.import(`${root}/lib/server/course-content-drafts.ts`);
const rollback = new Error('EXPECTED_ROLLBACK');
const { readNativeProblems } = await jiti.import(root + '/lib/server/native-problem-sync.ts');
const { buildNativeNotebookArchive } = await jiti.import(
  root + '/lib/server/native-course-sync.ts',
);
const { releaseCourseVersion } = await jiti.import(root + '/lib/server/store-course-layers.ts');
try {
  await assert.rejects(
    db.$transaction(
      async (tx) => {
        const exists =
          await tx.$queryRaw`SELECT to_regclass('public."CourseContentDraft"')::text AS name`;
        if (!exists[0].name)
          await tx.$executeRawUnsafe(
            readFileSync(
              `${root}/prisma/migrations/20261103090000_course_content_drafts/migration.sql`,
              'utf8',
            ),
          );
        const suffix = randomUUID();
        const owner = await tx.user.create({
          data: { email: `draft-${suffix}@example.invalid`, name: 'Draft QA' },
        });
        const student = await tx.user.create({
          data: { email: `student-${suffix}@example.invalid`, name: 'Student QA' },
        });
        const course = await tx.course.create({
          data: { ownerId: owner.id, name: 'Draft QA', tags: [] },
        });
        const book = await tx.notebook.create({
          data: {
            ownerId: owner.id,
            courseId: course.id,
            name: 'Original',
            tags: [],
            notebookKind: 'markdown',
          },
        });
        await drafts.stageContent(tx, owner.id, course.id, 'notes', book.id, { title: 'Edited' });
        assert.equal((await tx.notebook.findUnique({ where: { id: book.id } })).name, 'Original');
        assert.equal((await drafts.contentDrafts(tx, course.id))[0].payload.name, 'Edited');
        await assert.rejects(
          drafts.stageContent(tx, student.id, course.id, 'notes', book.id, { title: 'Forbidden' }),
          (e) => e.status === 403,
        );
        const transactional = new Proxy(tx, {
          get(target, key) {
            if (key === '$transaction')
              return async (fn) => {
                await tx.$executeRawUnsafe('SAVEPOINT draft_publish');
                try {
                  const result = await fn(tx);
                  await tx.$executeRawUnsafe('RELEASE SAVEPOINT draft_publish');
                  return result;
                } catch (error) {
                  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT draft_publish');
                  throw error;
                }
              };
            const value = Reflect.get(target, key);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        await releaseCourseVersion(transactional, course.id);
        assert.equal((await tx.notebook.findUnique({ where: { id: book.id } })).name, 'Edited');
        await drafts.stageContent(tx, owner.id, course.id, 'notes', book.id, {}, true);
        assert.equal((await tx.notebook.findUnique({ where: { id: book.id } })).removedAt, null);
        await drafts.undoContentDraft(tx, owner.id, course.id, 'notes', book.id);
        assert.equal((await drafts.contentDrafts(tx, course.id)).length, 0);
        await drafts.stageContent(tx, owner.id, course.id, 'notes', null, {
          title: 'New note',
          text: '# New',
        });
        assert.equal(await tx.notebook.count({ where: { courseId: course.id } }), 1);
        await drafts.applyContentDrafts(tx, course.id);
        assert.equal(await tx.notebook.count({ where: { courseId: course.id } }), 2);
        await drafts.stageContent(tx, owner.id, course.id, 'problems', null, {
          title: 'Unready question',
          text: 'What?',
        });
        await drafts.applyContentDrafts(tx, course.id);
        assert.equal(await tx.notebookProblem.count({ where: { courseId: course.id } }), 0);
        assert.equal((await drafts.contentDrafts(tx, course.id)).length, 1);
        const problem = await tx.notebookProblem.create({
          data: {
            courseId: course.id,
            title: 'Live question',
            type: 'short_answer',
            status: 'published',
            order: 0,
            tags: [],
            publicContentJson: { type: 'short_answer', stem: 'Question' },
            gradingJson: { type: 'short_answer', referenceAnswer: 'Answer' },
          },
        });
        await tx.courseEnrollment.create({ data: { userId: student.id, courseId: course.id } });
        const manager = await tx.user.create({
          data: {
            email: 'manager-' + suffix + '@example.invalid',
            role: 'TEACHER',
            name: 'Manager QA',
          },
        });
        await tx.courseManager.create({
          data: { courseId: course.id, userId: manager.id, assignedById: owner.id },
        });
        const privateQuestion = await tx.notebookProblem.create({
          data: {
            courseId: course.id,
            ownerId: owner.id,
            title: 'Owner private',
            type: 'short_answer',
            status: 'draft',
            order: 9,
            tags: [],
            publicContentJson: { type: 'short_answer', stem: 'Private' },
            gradingJson: { type: 'short_answer' },
          },
        });
        const privateNote = await tx.notebook.create({
          data: {
            courseId: course.id,
            ownerId: student.id,
            name: 'Private student note',
            notebookKind: 'markdown',
            tags: [],
          },
        });
        const managed = await drafts.readManagedCourseProblems(tx, manager.id, course.id);
        assert.ok(managed.problemIds.includes(problem.id));
        assert.ok(!managed.problemIds.includes(privateQuestion.id));
        assert.deepEqual(managed.progress, []);
        await assert.rejects(
          drafts.readManagedCourseProblems(tx, student.id, course.id),
          (e) => e.status === 403,
        );
        assert.equal(
          (
            await buildNativeNotebookArchive(tx, manager.id, book.id, {
              managedCourseId: course.id,
            })
          ).notebook.name,
          'Edited',
        );
        assert.equal(
          await buildNativeNotebookArchive(tx, manager.id, privateNote.id, {
            managedCourseId: course.id,
          }),
          null,
        );
        await assert.rejects(
          drafts.stageContent(tx, owner.id, course.id, 'problems', problem.id, {
            grading: { type: 'proof', referenceProof: 'Proof' },
          }),
          (e) => e.status === 400,
        );
        const stableTime = (
          await tx.notebook.findUnique({ where: { id: book.id } })
        ).updatedAt.getTime();
        await tx.notebookProblemSecret.create({
          data: {
            problemId: problem.id,
            secretJudgeJson: { supportCode: '# private support', language: 'python' },
          },
        });
        await drafts.stageContent(tx, owner.id, course.id, 'problems', problem.id, {
          title: 'Metadata preserved',
        });
        await drafts.applyContentDrafts(tx, course.id);
        assert.equal(
          (await tx.notebookProblem.findUnique({ where: { id: problem.id } })).sourceMeta
            .normalizedOrder,
          0,
        );
        assert.equal(
          (await tx.notebookProblemSecret.findUnique({ where: { problemId: problem.id } }))
            .secretJudgeJson.supportCode,
          '# private support',
        );
        assert.equal(
          (await tx.notebook.findUnique({ where: { id: book.id } })).updatedAt.getTime(),
          stableTime,
        );
        await drafts.stageContent(tx, owner.id, course.id, 'problems', problem.id, {
          status: 'draft',
        });
        await tx.notebookProblem.update({
          where: { id: problem.id },
          data: { title: 'Live question', updatedAt: new Date(Date.now() + 10000) },
        });
        await drafts.stageContent(tx, owner.id, course.id, 'notes', null, {
          title: 'Ready despite stale question draft',
          text: '# Ready',
        });
        await drafts.applyContentDrafts(tx, course.id);
        assert.ok(
          (await drafts.contentDrafts(tx, course.id)).some((row) => row.targetId === problem.id),
        );
        await drafts.undoContentDraft(tx, owner.id, course.id, 'problems', problem.id);
        await drafts.stageContent(tx, owner.id, course.id, 'problems', problem.id, {
          notebookId: book.id,
        });
        await drafts.stageContent(tx, owner.id, course.id, 'notes', book.id, {}, true);
        await assert.rejects(drafts.applyContentDrafts(tx, course.id), (e) => e.status === 409);
        assert.equal((await tx.notebook.findUnique({ where: { id: book.id } })).removedAt, null);
        await drafts.undoContentDraft(tx, owner.id, course.id, 'notes', book.id);
        await drafts.undoContentDraft(tx, owner.id, course.id, 'problems', problem.id);
        assert.ok(
          (await readNativeProblems(tx, student.id, course.id, null)).problemIds.includes(
            problem.id,
          ),
        );
        await drafts.stageContent(tx, owner.id, course.id, 'problems', problem.id, {
          title: 'Changed question',
        });
        assert.equal(
          (await readNativeProblems(tx, student.id, course.id, null)).problems.find(
            (row) => row.id === problem.id,
          ).title,
          'Live question',
        );
        await drafts.undoContentDraft(tx, owner.id, course.id, 'problems', problem.id);
        const attempt = await tx.notebookProblemAttempt.create({
          data: {
            problemId: problem.id,
            userId: student.id,
            kind: 'answer',
            status: 'passed',
            answerJson: { text: 'Answer' },
          },
        });
        await drafts.stageContent(tx, owner.id, course.id, 'problems', problem.id, {}, true);
        assert.equal(
          (await tx.notebookProblem.findUnique({ where: { id: problem.id } })).status,
          'published',
        );
        await drafts.applyContentDrafts(tx, course.id);
        assert.equal(
          (await tx.notebookProblem.findUnique({ where: { id: problem.id } })).status,
          'archived',
        );
        assert.ok(await tx.notebookProblemAttempt.findUnique({ where: { id: attempt.id } }));
        assert.ok(
          !(await readNativeProblems(tx, student.id, course.id, null)).problemIds.includes(
            problem.id,
          ),
        );
        await drafts.stageContent(tx, owner.id, course.id, 'notes', book.id, {
          title: 'Concurrent edit',
        });
        await tx.notebook.update({
          where: { id: book.id },
          data: { name: 'Other editor', updatedAt: new Date(Date.now() + 10000) },
        });
        await assert.rejects(drafts.applyContentDrafts(tx, course.id), (e) => e.status === 409);
        assert.equal(
          (await tx.notebook.findUnique({ where: { id: book.id } })).name,
          'Other editor',
        );
        await drafts.undoContentDraft(tx, owner.id, course.id, 'notes', book.id);
        const table = await tx.notebookProblem.create({
          data: {
            courseId: course.id,
            title: 'Dictionary trace',
            type: 'table',
            status: 'published',
            order: 10,
            problemNumber: 42,
            points: 70,
            tags: [],
            publicContentJson: { type: 'table', stem: 'Trace a dictionary.' },
            gradingJson: { type: 'table', cells: [] },
          },
        });
        const oldAnswer = { kind: 'table', cells: { 'r:answer': '3' } };
        const historic = await tx.notebookProblemAttempt.create({
          data: { problemId: table.id, userId: student.id, kind: 'answer', answerJson: oldAnswer },
        });
        const labels = ['a', 'b'];
        const choice = {
          type: 'choice',
          selectionMode: 'single',
          stem: 'Which value does the lookup produce?',
          options: [
            { id: 'a', label: '3' },
            { id: 'b', label: '5' },
          ],
        };
        const patch = {
          type: 'multipart',
          publicContent: {
            type: 'multipart',
            stem: 'Read the dictionary.',
            parts: labels.map((label) => ({ label, points: 35, content: choice })),
          },
          grading: {
            type: 'multipart',
            parts: labels.map((label) => ({
              label,
              grading: { type: 'choice', correctOptionIds: ['a'] },
            })),
          },
        };
        const stage = (expected) =>
          drafts.stageContent(
            tx,
            owner.id,
            course.id,
            'problems',
            table.id,
            patch,
            false,
            expected,
          );
        await assert.rejects(stage(), (e) => e.status === 400);
        await assert.rejects(stage(table.updatedAt.getTime() - 1), (e) => e.status === 409);
        await stage(table.updatedAt.getTime());
        assert.equal(
          (await tx.notebookProblem.findUnique({ where: { id: table.id } })).type,
          'table',
        );
        await assert.rejects(stage(table.updatedAt.getTime()), (e) => e.status === 409);
        await drafts.stageContent(tx, owner.id, course.id, 'notes', book.id, {
          title: 'Unrelated draft',
        });
        await assert.rejects(
          releaseCourseVersion(transactional, course.id, owner.id, [table.id]),
          (e) => e.status === 409,
        );
        await drafts.undoContentDraft(tx, owner.id, course.id, 'notes', book.id);
        const converted = await releaseCourseVersion(transactional, course.id, owner.id, [
          table.id,
        ]);
        assert.equal(converted.updatedProblems, 1);
        const updated = await tx.notebookProblem.findUnique({ where: { id: table.id } });
        assert.equal(updated.type, 'multipart');
        assert.equal(updated.problemNumber, 42);
        assert.equal(updated.points, 70);
        assert.deepEqual(
          (await tx.notebookProblemAttempt.findUnique({ where: { id: historic.id } })).answerJson,
          oldAnswer,
        );
        throw rollback;
      },
      { timeout: 60000 },
    ),
    (e) => e === rollback,
  );
  console.log(
    'PASS: draft isolation, publication, scoped type conversion, preserved history, undo deletion, new notes, unready questions, authorization. All fixtures rolled back.',
  );
} finally {
  await db.$disconnect();
}
