// Explicit database integration check. Fixtures and assignments always roll back.
// ADMIN_COURSE_TEST_DATABASE_URL=... node scripts/maintenance/verify-admin-course-management.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { PrismaClient } from '@prisma/client';
import JSZip from 'jszip';

const url = process.env.ADMIN_COURSE_TEST_DATABASE_URL;
if (!url) {
  console.log('SKIP: set ADMIN_COURSE_TEST_DATABASE_URL to run rollback-only database fixtures.');
  process.exit(0);
}
const root = fileURLToPath(new URL('../../', import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const {
  setAdminCourseManager,
  listAdminManagedCourses,
  searchAdminCourseAssignees,
  listAdminCourseStudents,
  removeAdminCourseStudent,
} = await jiti.import(`${root}/lib/server/admin-course-management.ts`);
const { buildAdminCourseArchive } = await jiti.import(`${root}/lib/server/admin-course-export.ts`);
const { hasTeacherCourseAccess } = await jiti.import(
  `${root}/lib/server/external-course-access.ts`,
);
const { findCourseAccessRole } = await jiti.import(
  `${root}/lib/server/repositories/course-enrollment-repository.ts`,
);
const { listAccessibleCoursesForUser } = await jiti.import(
  `${root}/lib/server/repositories/course-repository.ts`,
);
const { listReadableNotebookLibraryItems } = await jiti.import(
  `${root}/lib/server/repositories/notebook-repository.ts`,
);
const { teachableCourseWhere, listTeachableCourses } = await jiti.import(
  `${root}/lib/server/teacher-classroom.ts`,
);
const db = new PrismaClient({ datasources: { db: { url } } });
const prefix = `admin-course-qa-${randomUUID()}`;
const rollback = new Error('EXPECTED_FIXTURE_ROLLBACK');
try {
  await assert.rejects(
    db.$transaction(
      async (tx) => {
        const person = (name, role, isActive = true) =>
          tx.user.create({
            data: {
              email: `${prefix}-${name}@example.invalid`,
              name: `${prefix}-${name}`,
              role,
              isActive,
            },
          });
        const actor = await person('actor', 'ADMIN');
        const teacher = await person('teacher', 'TEACHER');
        const admin = await person('admin', 'ADMIN');
        const student = await person('student', 'STUDENT');
        const inactive = await person('inactive', 'TEACHER', false);
        const owner = await person('owner', 'TEACHER');
        const course = await tx.course.create({
          data: { ownerId: owner.id, name: `${prefix}-course`, tags: [] },
        });
        const other = await tx.course.create({
          data: { ownerId: owner.id, name: `${prefix}-other`, tags: [] },
        });
        const viewer = { userId: actor.id, email: actor.email };
        const assign = (userId, assigned = true) =>
          setAdminCourseManager(tx, viewer, { courseId: course.id, userId, assigned });
        await assert.rejects(
          () =>
            setAdminCourseManager(
              tx,
              { userId: student.id },
              { courseId: course.id, userId: teacher.id, assigned: true },
            ),
          (e) => e.status === 403,
        );
        await assert.rejects(
          () => assign(student.id),
          (e) => e.status === 400,
        );
        await assert.rejects(
          () => assign(inactive.id),
          (e) => e.status === 400,
        );
        await assert.rejects(
          () => assign(owner.id),
          (e) => e.status === 400,
        );
        await assert.rejects(
          () =>
            setAdminCourseManager(tx, viewer, {
              courseId: 'missing-course',
              userId: teacher.id,
              assigned: true,
            }),
          (e) => e.status === 404,
        );
        assert.equal(await hasTeacherCourseAccess(tx, teacher.id, course.id), false);
        await assign(teacher.id);
        await assign(teacher.id);
        assert.equal(
          await tx.courseManager.count({ where: { courseId: course.id, userId: teacher.id } }),
          1,
        );
        assert.equal((await tx.course.findUnique({ where: { id: course.id } })).ownerId, owner.id);
        assert.equal(await hasTeacherCourseAccess(tx, teacher.id, course.id), true);
        assert.equal(await hasTeacherCourseAccess(tx, teacher.id, other.id), false);
        assert.equal(await findCourseAccessRole(tx, teacher.id, course.id), 'owner');
        assert.equal(
          await tx.course.count({ where: { id: course.id, ...teachableCourseWhere(teacher.id) } }),
          1,
        );
        await tx.courseEnrollment.create({ data: { courseId: course.id, userId: teacher.id } });
        const accessible = await listAccessibleCoursesForUser(tx, teacher.id, teacher.email);
        assert.deepEqual(
          accessible.map((item) => item.id),
          [course.id],
          'an assigned and enrolled course appears once',
        );
        await assign(admin.id);
        assert.equal(await hasTeacherCourseAccess(tx, admin.id, course.id), true);
        const catalog = await listAdminManagedCourses(tx, course.name, 1);
        assert.equal(catalog.total, 1);
        assert.equal(catalog.courses[0].managers.length, 2);
        assert.deepEqual(
          new Set(catalog.courses[0].responsiblePeople.map((person) => person.id)),
          new Set([owner.id, teacher.id, admin.id]),
        );
        assert.ok(catalog.courses[0].responsiblePeople.every((person) => 'image' in person));
        const candidates = await searchAdminCourseAssignees(tx, prefix);
        assert.ok(candidates.some((item) => item.id === teacher.id));
        assert.ok(candidates.some((item) => item.id === admin.id));
        assert.ok(!candidates.some((item) => item.id === student.id || item.id === inactive.id));
        await assign(teacher.id, false);
        assert.equal(await hasTeacherCourseAccess(tx, teacher.id, course.id), false);
        await assign(teacher.id);
        await tx.user.update({ where: { id: teacher.id }, data: { role: 'STUDENT' } });
        await tx.courseEnrollment.deleteMany({ where: { userId: teacher.id } });
        assert.equal(await hasTeacherCourseAccess(tx, teacher.id, course.id), false);
        assert.equal(await findCourseAccessRole(tx, teacher.id, course.id), null);
        assert.equal((await listAccessibleCoursesForUser(tx, teacher.id, teacher.email)).length, 0);
        await assign(teacher.id, false);
        const systemOwner = await tx.user.create({
          data: {
            id: `system:${prefix}`,
            email: `${prefix}-system@example.invalid`,
            name: 'System course holder',
          },
        });
        const unassigned = await tx.course.create({
          data: { ownerId: systemOwner.id, name: `${prefix}-unassigned`, tags: [] },
        });
        const unassignedPage = await listAdminManagedCourses(tx, unassigned.name, 1);
        assert.deepEqual(unassignedPage.courses[0].responsiblePeople, []);
        const assignedView = await setAdminCourseManager(tx, viewer, {
          courseId: unassigned.id,
          userId: admin.id,
          assigned: true,
        });
        assert.deepEqual(
          assignedView.responsiblePeople.map((person) => person.id),
          [admin.id],
        );
        const managedIds = Array.from({ length: 101 }, (_, index) => `${prefix}-managed-${index}`);
        await tx.course.createMany({
          data: managedIds.map((id) => ({
            id,
            ownerId: owner.id,
            name: `${prefix}-${id}`,
            tags: [],
          })),
        });
        await tx.courseManager.createMany({
          data: managedIds.map((courseId) => ({
            courseId,
            userId: admin.id,
            assignedById: actor.id,
          })),
        });
        const teaching = await listTeachableCourses({ userId: admin.id, role: 'ADMIN' }, tx);
        assert.deepEqual(
          new Set(teaching.courses.map((item) => item.id)),
          new Set([course.id, unassigned.id, ...managedIds]),
          'teaching includes every assigned course beyond 100, and excludes courses without management access',
        );
        // Deduplicated roster; removal affects only this course and never the account/materials.
        await tx.courseEnrollment.createMany({
          data: [
            { courseId: course.id, userId: student.id },
            { courseId: other.id, userId: student.id },
            { courseId: course.id, userId: owner.id },
            { courseId: course.id, userId: admin.id },
          ],
        });
        const clone = await tx.course.create({
          data: { ownerId: student.id, name: `${prefix}-clone`, tags: [] },
        });
        await tx.coursePurchase.create({
          data: { buyerId: student.id, sourceCourseId: course.id, clonedCourseId: clone.id },
        });
        const addedStats = (
          await listTeachableCourses({ userId: admin.id, role: 'ADMIN' }, tx)
        ).courses.find((item) => item.id === course.id);
        assert.equal(addedStats.learnerCount, 2, 'owner excluded and legacy purchase deduplicated');
        const cls = await tx.courseClass.create({
          data: {
            courseId: course.id,
            academicYear: 2026,
            academicTerm: 'fall',
            name: prefix,
            teacherId: owner.id,
            joinCode: randomUUID().replaceAll('-', '').slice(0, 12),
          },
        });
        await tx.courseClassMember.create({ data: { classId: cls.id, userId: student.id } });
        const binding = await tx.externalCourseBinding.create({
          data: {
            provider: 'qa',
            externalCourseId: prefix,
            courseId: course.id,
            activatedById: actor.id,
            externalCourseName: prefix,
          },
        });
        await tx.externalCourseMembership.create({
          data: { bindingId: binding.id, userId: student.id, role: 'STUDENT' },
        });
        const extraIds = Array.from({ length: 22 }, (_, index) => `${prefix}-roster-${index}`);
        await tx.user.createMany({
          data: extraIds.map((id) => ({
            id,
            email: `${id}@example.invalid`,
            name: id,
            role: 'STUDENT',
          })),
        });
        await tx.courseEnrollment.createMany({
          data: extraIds.map((userId) => ({ courseId: course.id, userId })),
        });
        const first = await listAdminCourseStudents(tx, course.id, '', 1);
        const second = await listAdminCourseStudents(tx, course.id, '', 2);
        assert.equal(first.total, 23);
        assert.equal(first.students.length, 20);
        assert.equal(second.students.length, 3);
        assert.equal(
          new Set([...first.students, ...second.students].map((row) => row.id)).size,
          23,
        );
        assert.deepEqual(
          (await listAdminCourseStudents(tx, course.id, student.email, 99)).students.map(
            (row) => row.id,
          ),
          [student.id],
        );
        await assert.rejects(
          () =>
            removeAdminCourseStudent(
              tx,
              { userId: student.id },
              { courseId: course.id, userId: extraIds[0] },
            ),
          (error) => error.status === 403,
        );
        for (const userId of [owner.id, admin.id]) {
          await assert.rejects(
            () => removeAdminCourseStudent(tx, viewer, { courseId: course.id, userId }),
            (error) => error.status === 400,
          );
        }
        assert.equal(
          (await removeAdminCourseStudent(tx, viewer, { courseId: course.id, userId: student.id }))
            .removed,
          true,
        );
        assert.equal(
          (await removeAdminCourseStudent(tx, viewer, { courseId: course.id, userId: student.id }))
            .removed,
          false,
        );
        assert.equal((await listAdminCourseStudents(tx, course.id, student.email, 1)).total, 0);
        assert.equal(await findCourseAccessRole(tx, student.id, course.id), null);
        assert.equal(await findCourseAccessRole(tx, student.id, other.id), 'enrolled');
        assert.equal(
          await tx.courseClassMember.count({ where: { classId: cls.id, userId: student.id } }),
          0,
        );
        assert.equal(
          await tx.externalCourseMembership.count({
            where: { bindingId: binding.id, userId: student.id, active: true },
          }),
          0,
        );
        assert.ok(await tx.user.findUnique({ where: { id: student.id } }));
        assert.ok(await tx.course.findUnique({ where: { id: clone.id } }));
        const lecture = await tx.notebook.create({
          data: {
            courseId: course.id,
            ownerId: owner.id,
            name: 'Shared lecture',
            notebookKind: 'markdown',
            tags: [],
          },
        });
        await tx.markdownNotebookSection.create({
          data: {
            notebookId: lecture.id,
            courseId: course.id,
            title: 'Chapter',
            order: 0,
            markdown: '# Shared lecture\nCourse material.',
          },
        });
        const privateLecture = await tx.notebook.create({
          data: {
            courseId: course.id,
            ownerId: student.id,
            name: 'Student private note',
            tags: [],
          },
        });
        const noteStats = (
          await listTeachableCourses({ userId: admin.id, role: 'ADMIN' }, tx)
        ).courses.find((item) => item.id === course.id);
        assert.equal(noteStats.notebookCount, 1, 'student private notes excluded');
        const managerNotebooks = await listReadableNotebookLibraryItems(tx, admin.id, course.id);
        assert.ok(
          managerNotebooks.some((item) => item.id === lecture.id),
          'manager can read course notes',
        );
        assert.ok(
          !managerNotebooks.some((item) => item.id === privateLecture.id),
          'student private notes remain hidden',
        );
        const problem = await tx.notebookProblem.create({
          data: {
            courseId: course.id,
            title: 'Shared question',
            type: 'short_answer',
            order: 0,
            tags: [],
            publicContentJson: { question: '1+1?' },
            gradingJson: { answer: '2' },
            secret: { create: { secretJudgeJson: { answer: '2' } } },
          },
        });
        const privateProblem = await tx.notebookProblem.create({
          data: {
            courseId: course.id,
            ownerId: student.id,
            title: 'Private question',
            type: 'short_answer',
            order: 1,
            tags: [],
            publicContentJson: {},
            gradingJson: {},
          },
        });
        await tx.courseSource.create({
          data: {
            courseId: course.id,
            ownerId: owner.id,
            sourceHash: prefix,
            title: 'lecture.txt',
            fileData: Buffer.from('original lecture'),
            fileSize: 16,
            extractedText: 'original lecture',
          },
        });
        const zip = await buildAdminCourseArchive(tx, [course.id], { materialsOnly: true });
        const bytes = await zip.generateAsync({ type: 'nodebuffer' });
        const reopened = await JSZip.loadAsync(bytes);
        const names = Object.keys(reopened.files);
        assert.ok(names.some((name) => name.endsWith('.md')));
        assert.ok(names.some((name) => name.endsWith(`/original/lecture.txt`)));
        const questionPath = names.find((name) => name.endsWith(`_${problem.id}.json`));
        assert.ok(questionPath);
        assert.equal(
          JSON.parse(await reopened.file(questionPath).async('string')).secret.secretJudgeJson
            .answer,
          '2',
        );
        assert.ok(
          !names.some(
            (name) => name.includes(privateLecture.id) || name.includes(privateProblem.id),
          ),
        );
        const manifest = JSON.parse(await reopened.file('manifest.json').async('string'));
        assert.equal(manifest.courses[0].notebooks, 1);
        assert.equal(manifest.courses[0].problems, 1);
        throw rollback;
      },
      { timeout: 60_000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await db.user.count({ where: { email: { startsWith: prefix } } }), 0);
  assert.equal(await db.course.count({ where: { name: { startsWith: prefix } } }), 0);
  console.log(
    'PASS: admin-only assignment; scoped access; roster search/pagination/deduplication; scoped student removal; owner protection; ZIP lectures/originals/questions/answers; private student content excluded; all fixtures rolled back.',
  );
} finally {
  await db.$disconnect();
}
