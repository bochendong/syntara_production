import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { PrismaClient } from '@prisma/client';

const root = fileURLToPath(new URL('../../', import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const { organizeCourseProblems, courseProblemOrganizationSchema } = await jiti.import(
  '../../lib/server/course-problem-organization.ts',
);
const databaseUrl = process.env.SYNTARA_ORGANIZATION_TEST_DATABASE_URL;
if (databaseUrl) {
  const url = new URL(databaseUrl);
  assert(['localhost', '127.0.0.1'].includes(url.hostname));
  assert.match(url.pathname, /^\/organization_fixture(?:_[a-z0-9]+)?$/);
}
const clone = (value) => JSON.parse(JSON.stringify(value));

test('organization payload cannot contain question content, answers or actor overrides', () => {
  const base = {
    courseId: 'fixture',
    expectedContentVersion: 1,
    chapters: [
      {
        id: 'chapter',
        name: '01 Basics',
        description: '',
        position: 0,
        expectedUpdatedAt: '2026-11-05T00:00:00.000Z',
      },
    ],
    retiredChapters: [],
    questions: [
      {
        id: 'question',
        chapterId: 'chapter',
        order: 0,
        problemNumber: 1,
        status: 'published',
        expectedUpdatedAt: '2026-11-05T00:00:00.000Z',
      },
    ],
  };
  assert(courseProblemOrganizationSchema.safeParse(base).success);
  for (const extra of [
    { publicContent: {} },
    { grading: {} },
    { secretJudge: {} },
    { ownerId: 'other' },
  ]) {
    assert(
      !courseProblemOrganizationSchema.safeParse({
        ...base,
        questions: [{ ...base.questions[0], ...extra }],
      }).success,
    );
  }
  assert(!courseProblemOrganizationSchema.safeParse({ ...base, userId: 'other' }).success);
});

test(
  'real PostgreSQL organization preserves contents/history and rejects stale or partial writes',
  { skip: !databaseUrl },
  async () => {
    const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
    const suffix = randomUUID();
    const owner = 'organization-owner-' + suffix;
    const learner = 'organization-learner-' + suffix;
    let course;
    try {
      await db.user.createMany({
        data: [
          { id: owner, email: owner + '@example.test' },
          { id: learner, email: learner + '@example.test' },
        ],
      });
      course = await db.course.create({
        data: { ownerId: owner, name: 'Disposable organization fixture', tags: [] },
      });
      const chapters = [];
      for (const [position, name] of ['Old A', 'Old B', 'Retire me'].entries())
        chapters.push(
          await db.courseProblemChapter.create({ data: { courseId: course.id, name, position } }),
        );
      const questions = [];
      for (const [index, status] of ['published', 'published', 'archived'].entries())
        questions.push(
          await db.notebookProblem.create({
            data: {
              courseId: course.id,
              chapterId: chapters[index % 2].id,
              title: 'Original source ' + index,
              type: 'short_answer',
              status,
              order: index,
              problemNumber: index + 1,
              tags: ['keep-me'],
              publicContentJson: {
                type: 'short_answer',
                stem: 'Original stem',
                translations: { 'zh-CN': { stem: '原题', chapterName: '旧专题' } },
              },
              gradingJson: { type: 'short_answer', referenceAnswer: 'Original private answer' },
              sourceMeta: { sourceNumber: index + 1 },
            },
          }),
        );
      await db.notebookProblemSecret.create({
        data: { problemId: questions[0].id, secretJudgeJson: { marker: 'keep-secret-tests' } },
      });
      const privateQuestion = await db.notebookProblem.create({
        data: {
          courseId: course.id,
          chapterId: chapters[2].id,
          ownerId: learner,
          title: 'Learner private',
          type: 'short_answer',
          order: 0,
          tags: [],
          publicContentJson: {},
          gradingJson: {},
        },
      });
      const note = await db.notebook.create({
        data: {
          courseId: course.id,
          ownerId: owner,
          name: '01 Original notes',
          tags: [],
          notebookKind: 'markdown',
        },
      });
      await db.markdownNotebookSection.create({
        data: {
          notebookId: note.id,
          courseId: course.id,
          title: 'Original section',
          order: 0,
          markdown: 'Keep original lecture wording.',
        },
      });
      const attempt = await db.notebookProblemAttempt.create({
        data: {
          problemId: questions[0].id,
          userId: learner,
          kind: 'submit',
          answerJson: { text: 'Learner answer' },
          resultJson: { feedback: 'Keep feedback' },
          status: 'passed',
          score: 100,
        },
      });
      await db.notebookProblemProgress.create({
        data: {
          problemId: questions[0].id,
          userId: learner,
          latestAttemptId: attempt.id,
          status: 'passed',
          score: 100,
          attemptedCount: 1,
          passedCount: 1,
        },
      });
      const snapshot = async () =>
        clone({
          course: await db.course.findUnique({ where: { id: course.id } }),
          chapters: await db.courseProblemChapter.findMany({
            where: { courseId: course.id },
            orderBy: { id: 'asc' },
          }),
          problems: await db.notebookProblem.findMany({
            where: { courseId: course.id },
            include: { secret: true },
            orderBy: { id: 'asc' },
          }),
          notes: await db.notebook.findMany({
            where: { courseId: course.id },
            include: { markdownSections: true },
          }),
          attempts: await db.notebookProblemAttempt.findMany({
            where: { problem: { courseId: course.id } },
          }),
          progress: await db.notebookProblemProgress.findMany({
            where: { problem: { courseId: course.id } },
          }),
        });
      const plan = {
        courseId: course.id,
        expectedContentVersion: course.contentVersion,
        // Swap existing names to exercise transient unique-name conflicts as well.
        chapters: chapters.slice(0, 2).map((c, i) => ({
          id: c.id,
          name: chapters[1 - i].name,
          description: 'Reviewed order',
          position: 1 - i,
          expectedUpdatedAt: c.updatedAt.toISOString(),
        })),
        retiredChapters: [
          { id: chapters[2].id, expectedUpdatedAt: chapters[2].updatedAt.toISOString() },
        ],
        questions: questions.map((q, i) => ({
          id: q.id,
          chapterId: chapters[i === 0 ? 1 : 0].id,
          order: i === 2 ? 2 : 1 - i,
          problemNumber: i === 2 ? 3 : 2 - i,
          status: q.status,
          expectedUpdatedAt: q.updatedAt.toISOString(),
        })),
      };
      const original = await snapshot();
      await assert.rejects(
        organizeCourseProblems(db, learner, plan, 'preview'),
        (error) => error.status === 404,
      );
      await assert.rejects(
        organizeCourseProblems(
          db,
          owner,
          { ...plan, questions: plan.questions.slice(0, 2) },
          'preview',
        ),
        (error) => error.status === 409,
      );
      await assert.rejects(
        organizeCourseProblems(db, owner, { ...plan, expectedContentVersion: 999 }, 'preview'),
        (error) => error.status === 409,
      );
      const duplicate = clone(plan);
      duplicate.questions[1].id = duplicate.questions[0].id;
      await assert.rejects(
        organizeCourseProblems(db, owner, duplicate, 'preview'),
        (error) => error.status === 400,
      );
      const preview = await organizeCourseProblems(db, owner, plan, 'preview');
      assert.equal(preview.status, 'preview');
      assert.deepEqual(await snapshot(), original, 'Preview must not write anything');
      await assert.rejects(
        organizeCourseProblems(db, owner, plan, 'commit', '0'.repeat(64)),
        (error) => error.status === 409,
      );
      await assert.rejects(
        organizeCourseProblems(db, owner, plan, 'commit', preview.expectedHash),
        (error) => error.status === 409 && /still referenced/.test(error.message),
      );
      assert.deepEqual(
        await snapshot(),
        original,
        'A private chapter reference must roll back every intermediate update',
      );
      await db.notebookProblem.update({
        where: { id: privateQuestion.id },
        data: { chapterId: chapters[0].id },
      });
      const before = await snapshot();
      const reviewed = await organizeCourseProblems(db, owner, plan, 'preview');
      const saved = await organizeCourseProblems(db, owner, plan, 'commit', reviewed.expectedHash);
      assert.equal(saved.status, 'committed');
      assert.equal(saved.version, course.contentVersion + 1);
      assert.equal(saved.preservedQuestionContentsAndSecrets, true);
      const after = await snapshot();
      for (const field of ['notes', 'attempts', 'progress'])
        assert.deepEqual(after[field], before[field]);
      assert.deepEqual(
        after.problems.find((q) => q.id === privateQuestion.id),
        before.problems.find((q) => q.id === privateQuestion.id),
      );
      for (const q of questions) {
        const old = before.problems.find((p) => p.id === q.id);
        const current = after.problems.find((p) => p.id === q.id);
        for (const key of Object.keys(old).filter(
          (k) =>
            !['chapterId', 'order', 'problemNumber', 'updatedAt', 'releaseUpdatedIn'].includes(k),
        ))
          assert.deepEqual(current[key], old[key], key);
      }
      assert.equal(after.chapters.length, 2);
      assert.equal(
        (await organizeCourseProblems(db, owner, plan, 'commit', reviewed.expectedHash)).status,
        'unchanged',
      );
      assert.deepEqual(await snapshot(), after, 'Identical retry must be a no-op');
      const stale = clone(plan);
      stale.chapters[0].description = 'A different operation';
      await assert.rejects(
        organizeCourseProblems(db, owner, stale, 'commit', reviewed.expectedHash),
        (error) => error.status === 409,
      );
      const next = clone(plan);
      next.expectedContentVersion = saved.version;
      next.retiredChapters = [];
      for (const c of next.chapters)
        c.expectedUpdatedAt = after.chapters.find((row) => row.id === c.id).updatedAt;
      for (const q of next.questions)
        q.expectedUpdatedAt = after.problems.find((row) => row.id === q.id).updatedAt;
      const nextPreview = await organizeCourseProblems(db, owner, next, 'preview');
      await db.notebookProblem.update({
        where: { id: questions[0].id },
        data: { title: 'Concurrent owner edit' },
      });
      await assert.rejects(
        organizeCourseProblems(db, owner, next, 'commit', nextPreview.expectedHash),
        (error) => error.status === 409,
      );
      assert.equal(
        (await db.notebookProblem.findUnique({ where: { id: questions[0].id } })).title,
        'Concurrent owner edit',
      );
    } finally {
      if (course) await db.course.delete({ where: { id: course.id } });
      await db.user.deleteMany({ where: { id: { in: [owner, learner] } } });
      await db.$disconnect();
    }
  },
);
