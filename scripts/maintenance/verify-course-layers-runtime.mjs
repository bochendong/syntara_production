/** Disposable-schema integration test. Run migration against the same schema between
 * --seed-baseline and the normal run. Never accepts the application's normal URL. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { createJiti } from 'jiti';

const url = new URL(process.env.SYNTARA_LAYER_TEST_DATABASE_URL || 'invalid:');
assert.match(url.protocol, /^postgres(?:ql)?:$/);
assert.match(url.searchParams.get('schema') || '', /^qa_layers_[a-z0-9_]+$/);
process.env.DATABASE_URL = url.href;
process.env.NODE_ENV = 'test';
const root = path.resolve(import.meta.dirname, '../..');
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const { prisma: db } = await jiti.import('../../lib/server/prisma.ts');
const ids = {
  publisher: 'qa-publisher',
  a: 'qa-a',
  b: 'qa-b',
  outsider: 'qa-outsider',
  limited: 'qa-limited',
  course: 'qa-course',
  public: 'qa-public',
  locked: 'qa-locked',
  privateA: 'qa-private-a',
  privateB: 'qa-private-b',
  problem: 'qa-problem',
  legacy: 'qa-legacy-private',
};
const problemData = (id, notebookId, overrides = {}) => ({
  id,
  courseId: ids.course,
  notebookId,
  title: id,
  type: 'short_answer',
  status: 'published',
  source: 'manual',
  order: 1,
  problemNumber: 1,
  tags: [],
  publicContentJson: { type: 'short_answer', stem: id },
  gradingJson: { type: 'short_answer' },
  ...overrides,
});
try {
  if (process.argv.includes('--seed-baseline')) {
    assert.equal(await db.user.count(), 0, 'schema must be empty');
    for (const id of [ids.publisher, ids.a, ids.b, ids.outsider, ids.limited])
      await db.user.create({ data: { id, email: `${id}@example.invalid` }, select: { id: true } });
    await db.course.create({
      data: {
        id: ids.course,
        ownerId: ids.publisher,
        name: 'QA layer fixtures',
        tags: [],
        contentVersion: 1,
      },
      select: { id: true },
    });
    for (const [id, ownerId, name] of [
      [ids.public, ids.publisher, '01 Public'],
      [ids.locked, ids.publisher, '02 Locked'],
      [ids.privateA, ids.a, '03 Private A'],
      [ids.privateB, ids.b, '04 Private B'],
    ])
      await db.notebook.create({
        data: { id, ownerId, courseId: ids.course, name, tags: [] },
        select: { id: true },
      });
    await db.notebookProblem.create({
      data: problemData(ids.problem, ids.public),
      select: { id: true },
    });
    await db.notebookProblem.create({
      data: problemData(ids.legacy, ids.privateA, {
        dedupeKey: 'legacy-private-dedupe',
        problemNumber: 2,
      }),
      select: { id: true },
    });
    await db.notebookProblem.create({
      data: problemData('qa-legacy-null-course', ids.privateA, {
        courseId: null,
        problemNumber: 3,
      }),
      select: { id: true },
    });
    await db.notebookProblemAttempt.create({
      data: {
        id: 'qa-attempt',
        userId: ids.a,
        problemId: ids.problem,
        kind: 'answer',
        answerJson: { text: 'saved answer' },
        status: 'passed',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    });
    for (const [userId, limit] of [
      [ids.a, null],
      [ids.b, null],
      [ids.limited, 1],
    ])
      await db.$executeRaw`INSERT INTO "CourseEnrollment" ("id", "userId", "courseId", "seenContentVersion", "notebookAccessLimit") VALUES (${`qa-enrollment-${userId}`}, ${userId}, ${ids.course}, 1, ${limit})`;
    console.log('Baseline fixtures seeded in disposable schema.');
  } else {
    const layers = await jiti.import('../../lib/server/store-course-layers.ts');
    const access = await jiti.import(
      '../../lib/server/repositories/course-enrollment-repository.ts',
    );
    const sync = await jiti.import('../../lib/server/native-problem-sync.ts');
    const service = await jiti.import('../../lib/server/notebook-problems/service.ts');
    const schema = await jiti.import('../../lib/problem-bank/schema.ts');
    const materials = await jiti.import('../../lib/server/native-materials.ts');
    const target = (targetType, targetId, userId = ids.a) => ({
      userId,
      courseId: ids.course,
      targetType,
      targetId,
    });
    const migrated = await db.notebookProblem.findUniqueOrThrow({ where: { id: ids.legacy } });
    assert.equal(migrated.ownerId, ids.a);
    assert.equal(
      (await db.notebookProblem.findUniqueOrThrow({ where: { id: 'qa-legacy-null-course' } }))
        .ownerId,
      ids.a,
    );
    assert.equal(migrated.dedupeKey, null);
    assert.equal(migrated.problemNumber, null);
    assert.equal(
      (await db.notebookProblem.findUniqueOrThrow({ where: { id: ids.problem } })).releaseAddedIn,
      0,
    );
    assert.deepEqual(
      (await access.resolveCourseNotebookAccess(db, ids.a, ids.course)).allowedNotebookIds.sort(),
      [ids.public, ids.locked, ids.privateA].sort(),
    );
    assert.deepEqual(
      (
        await access.resolveCourseNotebookAccess(db, ids.publisher, ids.course)
      ).allowedNotebookIds.sort(),
      [ids.public, ids.locked].sort(),
    );
    assert.equal(await access.resolveCourseNotebookAccess(db, ids.outsider, ids.course), null);
    assert.deepEqual(
      (await access.resolveCourseNotebookAccess(db, ids.limited, ids.course)).allowedNotebookIds,
      [ids.public],
    );
    await assert.rejects(
      layers.courseLayersForUser(db, ids.outsider, ids.course),
      layers.CourseContentNotFoundError,
    );
    await assert.rejects(
      layers.removeCourseContentForUser(db, target('notebook', ids.privateB)),
      layers.CourseContentNotFoundError,
    );
    await assert.rejects(
      layers.copyCourseContentToMine(db, target('notebook', ids.locked, ids.limited)),
      layers.CourseContentNotFoundError,
    );
    await assert.rejects(service.listNotebookProblemsForUser(ids.b, ids.privateA));
    assert.equal(
      await layers.removeCourseContentForUser(db, target('notebook', ids.public)),
      'hidden',
    );
    assert.equal(
      (await db.notebook.findUniqueOrThrow({ where: { id: ids.public } })).removedAt,
      null,
    );
    assert.ok(
      !(
        await access.resolveCourseNotebookAccess(db, ids.a, ids.course)
      ).allowedNotebookIds.includes(ids.public),
    );
    assert.ok(
      (await access.resolveCourseNotebookAccess(db, ids.b, ids.course)).allowedNotebookIds.includes(
        ids.public,
      ),
    );
    assert.equal((await layers.courseLayersForUser(db, ids.a, ids.course)).hidden.length, 1);
    await layers.restoreCourseContentForUser(db, target('notebook', ids.public));
    assert.ok(
      (await access.resolveCourseNotebookAccess(db, ids.a, ids.course)).allowedNotebookIds.includes(
        ids.public,
      ),
    );
    assert.equal(
      await layers.removeCourseContentForUser(db, target('problem', ids.problem)),
      'hidden',
    );
    assert.ok(
      !(await sync.readNativeProblems(db, ids.a, ids.course, null)).problemIds.includes(
        ids.problem,
      ),
    );
    assert.ok(
      (await sync.readNativeProblems(db, ids.b, ids.course, null)).problemIds.includes(ids.problem),
    );
    assert.ok(await db.notebookProblemAttempt.findUnique({ where: { id: 'qa-attempt' } }));
    await layers.restoreCourseContentForUser(db, target('problem', ids.problem));
    const publicMaxBefore = (
      await db.notebookProblem.aggregate({
        where: { courseId: ids.course, ownerId: null },
        _max: { problemNumber: true },
      })
    )._max.problemNumber;
    const draft = schema.notebookProblemImportDraftSchema.parse({
      draftId: 'qa-manual',
      title: 'Private draft',
      type: 'short_answer',
      status: 'draft',
      source: 'manual',
      publicContent: { type: 'short_answer', stem: 'Only learner A sees this' },
      grading: { type: 'short_answer' },
    });
    const created = await service.createManualCourseProblem({
      userId: ids.a,
      courseId: ids.course,
      draft,
    });
    const privateProblem = await db.notebookProblem.findUniqueOrThrow({
      where: { id: created.id },
    });
    assert.equal(privateProblem.ownerId, ids.a);
    assert.equal(privateProblem.problemNumber, null);
    assert.ok(
      (await sync.readNativeProblems(db, ids.a, ids.course, null)).problemIds.includes(created.id),
    );
    assert.ok(
      !(await sync.readNativeProblems(db, ids.b, ids.course, null)).problemIds.includes(created.id),
    );
    assert.ok(
      !(await sync.readNativeProblems(db, ids.publisher, ids.course, null)).problemIds.includes(
        created.id,
      ),
    );
    await assert.rejects(service.getCourseProblemForUser(ids.b, ids.course, created.id));
    await assert.rejects(
      layers.removeCourseContentForUser(db, target('problem', created.id, ids.publisher)),
      layers.CourseContentNotFoundError,
    );
    const copied = await layers.copyCourseContentToMine(db, target('problem', ids.problem));
    const clone = await db.notebookProblem.findUniqueOrThrow({ where: { id: copied.id } });
    assert.equal(clone.ownerId, ids.a);
    assert.equal(clone.problemNumber, null);
    assert.equal(clone.notebookId, null);
    assert.equal(await db.notebookProblemAttempt.count({ where: { problemId: copied.id } }), 0);
    assert.ok(await db.notebookProblemAttempt.findUnique({ where: { id: 'qa-attempt' } }));
    await layers.restoreCourseContentForUser(db, target('problem', ids.problem));
    const copiedNotebook = await layers.copyCourseContentToMine(db, target('notebook', ids.public));
    assert.equal(
      (await db.notebook.findUniqueOrThrow({ where: { id: copiedNotebook.id } })).ownerId,
      ids.a,
    );
    await layers.restoreCourseContentForUser(db, target('notebook', ids.public));
    assert.equal(
      await layers.removeCourseContentForUser(db, target('notebook', copiedNotebook.id)),
      'deleted',
    );
    assert.ok(
      (await db.notebook.findUniqueOrThrow({ where: { id: copiedNotebook.id } })).removedAt,
    );
    assert.equal(
      await layers.removeCourseContentForUser(db, target('problem', copied.id)),
      'deleted',
    );
    assert.equal(await db.notebookProblem.findUnique({ where: { id: copied.id } }), null);
    const uploaded = await materials.uploadNativeMaterial(db, ids.a, {
      courseId: ids.course,
      kind: 'notes',
      clientId: 'qa-upload',
      name: 'Private upload',
      text: 'private notebook content',
    });
    assert.equal(uploaded.status, 'saved');
    assert.ok(
      !(
        await access.resolveCourseNotebookAccess(db, ids.b, ids.course)
      ).allowedNotebookIds.includes('qa-upload'),
    );
    const maxAfter = (
      await db.notebookProblem.aggregate({
        where: { courseId: ids.course, ownerId: null },
        _max: { problemNumber: true },
      })
    )._max.problemNumber;
    assert.equal(maxAfter, publicMaxBefore, 'private content never consumes public numbering');
    const snapshotTime = Date.now();
    await db.notebookProblem.update({
      where: { id: ids.problem },
      data: { title: 'Edited public question' },
    });
    await db.notebookProblem.create({
      data: problemData('qa-new-problem', ids.public, { problemNumber: 2, order: 2 }),
    });
    await db.notebook.create({
      data: {
        id: 'qa-new-notebook',
        ownerId: ids.publisher,
        courseId: ids.course,
        name: '05 New',
        tags: [],
      },
    });
    await db.notebook.update({
      where: { id: ids.public },
      data: { contentVersion: { increment: 1 } },
    });
    await db.notebookProblem.create({
      data: problemData('qa-public-draft', ids.public, {
        status: 'draft',
        problemNumber: 3,
        order: 3,
      }),
    });
    const release = await layers.releaseCourseVersion(db, ids.course);
    assert.equal(release.addedProblems, 1);
    assert.equal(release.updatedProblems, 1);
    assert.equal(release.addedNotebooks, 1);
    assert.equal(release.updatedNotebooks, 1);
    const beforeSeen = await layers.courseLayersForUser(db, ids.a, ids.course);
    assert.equal(beforeSeen.update.addedProblems, 1);
    assert.equal(beforeSeen.update.updatedProblems, 1);
    assert.ok(beforeSeen.newNotebookIds.includes('qa-new-notebook'));
    await access.markCourseEnrollmentSeen(db, ids.a, ids.course);
    assert.equal((await layers.courseLayersForUser(db, ids.a, ids.course)).update, null);
    const snapshot = await sync.readNativeProblems(db, ids.a, ids.course, snapshotTime);
    assert.ok(
      snapshot.problems.some(
        (p) => p.id === 'qa-new-problem' && p.releaseAddedIn === release.version,
      ),
    );
    assert.ok(
      snapshot.problems.some(
        (p) => p.id === ids.problem && p.contentUpdatedAt > new Date('2026-01-01').getTime(),
      ),
    );
    assert.equal(snapshot.newSinceVersion, 1);
    assert.equal(
      (await db.notebookProblemAttempt.findUniqueOrThrow({ where: { id: 'qa-attempt' } }))
        .answerJson.text,
      'saved answer',
    );
    const concurrent = await Promise.all([
      layers.releaseCourseVersion(db, ids.course),
      layers.releaseCourseVersion(db, ids.course),
    ]);
    assert.equal(
      new Set(concurrent.map((r) => r.version)).size,
      2,
      'concurrent release versions are serialized',
    );
    assert.ok(
      concurrent.every(
        (r) => !r.addedProblems && !r.updatedProblems && !r.addedNotebooks && !r.updatedNotebooks,
      ),
    );
    console.log(
      'Course layer runtime: migration, ownership, limits, hide/restore/delete/copy, private upload/numbering, incremental sync, version summary and preserved attempts passed.',
    );
  }
} finally {
  await db.$disconnect();
}
