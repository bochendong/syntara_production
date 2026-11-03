// Explicit local PostgreSQL regression. Every fixture is rolled back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { PrismaClient } from '@prisma/client';

const root = fileURLToPath(new URL('../../', import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const { listManagedCourseStudents, getManagedCourseStudent } = await jiti.import(
  `${root}/lib/server/course-content-management.ts`,
);
const url = process.env.COURSE_INSIGHTS_TEST_DATABASE_URL;
assert.ok(url, 'Set COURSE_INSIGHTS_TEST_DATABASE_URL to a disposable local database.');
assert.ok(['localhost', '127.0.0.1'].includes(new URL(url).hostname), 'Local fixtures only.');
const db = new PrismaClient({ datasources: { db: { url } } });
const rollback = new Error('EXPECTED_ROLLBACK');
try {
  await assert.rejects(
    db.$transaction(
      async (tx) => {
        const prefix = randomUUID();
        const users = {};
        for (const [name, role] of Object.entries({
          owner: 'USER',
          teacher: 'TEACHER',
          admin: 'ADMIN',
          claimed: 'STUDENT',
          student: 'STUDENT',
          outsider: 'TEACHER',
          orgMember: 'STUDENT',
        })) {
          users[name] = await tx.user.create({
            data: { name, role, email: `${name}-${prefix}@example.invalid` },
          });
        }
        const organization = await tx.organization.create({ data: { slug: prefix, name: 'QA' } });
        await tx.organizationMember.create({
          data: { organizationId: organization.id, userId: users.orgMember.id },
        });
        const course = await tx.course.create({
          data: {
            name: 'Insights QA',
            ownerId: users.owner.id,
            organizationId: organization.id,
            claimedTeacherId: users.claimed.id,
            tags: [],
            managers: { create: { userId: users.teacher.id, assignedById: users.admin.id } },
          },
        });
        const other = await tx.course.create({
          data: { name: 'Other', ownerId: users.outsider.id, tags: [] },
        });
        await tx.courseEnrollment.create({
          data: {
            courseId: course.id,
            userId: users.student.id,
            source: 'store',
          },
        });
        for (const [title, courseId, ownerId] of [
          ['Visible shared', course.id, null],
          ['Private excluded', course.id, users.student.id],
          ['Other course excluded', other.id, null],
        ]) {
          const problem = await tx.notebookProblem.create({
            data: {
              title,
              courseId,
              ownerId,
              type: 'short_answer',
              status: 'published',
              order: 0,
              tags: [],
              publicContentJson: {},
              gradingJson: {},
            },
          });
          await tx.notebookProblemAttempt.create({
            data: {
              problemId: problem.id,
              userId: users.student.id,
              kind: 'answer',
              status: 'passed',
              answerJson: { text: title },
            },
          });
          await tx.notebookProblemProgress.create({
            data: {
              problemId: problem.id,
              userId: users.student.id,
              status: 'passed',
            },
          });
        }
        for (const [courseId, deletedAt, text] of [
          [course.id, null, 'Course question'],
          [other.id, null, 'Other course question'],
          [course.id, new Date(), 'Deleted conversation'],
        ]) {
          const conversation = await tx.courseConversation.create({
            data: {
              id: randomUUID(),
              ownerId: users.student.id,
              courseId,
              sessionId: randomUUID(),
              deletedAt,
            },
          });
          await tx.courseConversationMessage.create({
            data: {
              id: randomUUID(),
              conversationId: conversation.id,
              ownerId: users.student.id,
              courseId,
              sequence: 1n,
              role: 'user',
              content: { text },
              plainText: text,
            },
          });
        }
        for (const name of ['owner', 'teacher', 'admin', 'claimed']) {
          const roster = await listManagedCourseStudents(tx, users[name].id, course.id);
          assert.equal(roster.total, 1, name);
          const detail = await getManagedCourseStudent(
            tx,
            users[name].id,
            course.id,
            users.student.id,
          );
          assert.equal(detail.insights.attemptCount, 1, name);
          assert.equal(detail.insights.attempted, 1, name);
          assert.equal(detail.insights.passed, 1, name);
          assert.deepEqual(
            detail.insights.attempts.map((a) => a.title),
            ['Visible shared'],
          );
          assert.deepEqual(
            detail.insights.questions.map((q) => q.text),
            ['Course question'],
          );
        }
        const denied = async (userId) => {
          await assert.rejects(
            listManagedCourseStudents(tx, userId, course.id),
            (e) => e.status === 403,
          );
          await assert.rejects(
            getManagedCourseStudent(tx, userId, course.id, users.student.id),
            (e) => e.status === 403,
          );
        };
        for (const name of ['student', 'outsider', 'orgMember']) await denied(users[name].id);
        await assert.rejects(
          getManagedCourseStudent(tx, users.teacher.id, course.id, users.outsider.id),
          (e) => e.status === 404,
        );
        await tx.courseManager.delete({
          where: { courseId_userId: { courseId: course.id, userId: users.teacher.id } },
        });
        await denied(users.teacher.id);
        await tx.course.update({ where: { id: course.id }, data: { claimedTeacherId: null } });
        await denied(users.claimed.id);
        await tx.user.update({ where: { id: users.admin.id }, data: { isActive: false } });
        await denied(users.admin.id);
        await tx.course.update({ where: { id: course.id }, data: { organizationId: null } });
        assert.equal(
          (await getManagedCourseStudent(tx, users.owner.id, course.id, users.student.id)).insights,
          null,
        );
        throw rollback;
      },
      { timeout: 30000 },
    ),
    (error) => error === rollback,
  );
  console.log(
    'PASS: owner, assigned teacher, administrator and claimant access; course/private isolation; unrelated, revoked and inactive accounts denied; private-course policy preserved. Fixtures rolled back.',
  );
} finally {
  await db.$disconnect();
}
