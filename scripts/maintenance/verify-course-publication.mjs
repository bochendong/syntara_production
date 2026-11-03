// Explicit PostgreSQL integration check. All fixtures and enrollment changes roll back.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { PrismaClient } from '@prisma/client';

const root = fileURLToPath(new URL('../../', import.meta.url));
const jiti = createJiti(import.meta.url, { alias: { '@': root } });
const admissions = await jiti.import(`${root}/lib/server/course-admissions.ts`);
const contentManagement = await jiti.import(`${root}/lib/server/course-content-management.ts`);
assert.equal(
  admissions.publicationSchema.safeParse({
    name: 'Course',
    campus: '',
    organization: 'none',
    admission: { mode: 'open', fields: [] },
  }).success,
  false,
);
assert.equal(
  admissions.admissionConfigSchema.safeParse({
    mode: 'approval',
    fields: [
      { id: 'same', label: 'A', kind: 'text' },
      { id: 'same', label: 'B', kind: 'text' },
    ],
  }).success,
  false,
);
const url = process.env.COURSE_PUBLICATION_TEST_DATABASE_URL;
if (!url) {
  console.log(
    'PASS: publication field validation. SKIP database flow: set COURSE_PUBLICATION_TEST_DATABASE_URL.',
  );
  process.exit(0);
}
process.env.DATABASE_URL = url;
const db = new PrismaClient({ datasources: { db: { url } } });
const prefix = `publication-qa-${randomUUID()}`;
const rollback = new Error('EXPECTED_PUBLICATION_ROLLBACK');
const deny = (run, status) => assert.rejects(run, (error) => error.status === status);
try {
  await assert.rejects(
    db.$transaction(
      async (tx) => {
        // Nested service transactions use savepoints so expected rejections undo their writes.
        let savepoint = 0;
        const transactional = new Proxy(tx, {
          get(target, property) {
            if (property === '$transaction')
              return async (run) => {
                const name = `publication_test_${++savepoint}`;
                await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
                try {
                  const result = await run(tx);
                  await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                  return result;
                } catch (error) {
                  await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                  throw error;
                }
              };
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        globalThis.__synatraPrisma__ = transactional;
        globalThis.__synatraPrismaUrl__ = url;
        const classroom = await jiti.import(`${root}/lib/server/teacher-classroom.ts`);
        const { cloneStoreCourseForUser } = await jiti.import(
          `${root}/lib/server/services/store-purchase-service.ts`,
        );
        const { listPublicStoreCoursesForUser } = await jiti.import(
          `${root}/lib/server/repositories/store-repository.ts`,
        );
        const { findCourseAccessRole } = await jiti.import(
          `${root}/lib/server/repositories/course-enrollment-repository.ts`,
        );
        const { uploadNativeMaterial } = await jiti.import(
          `${root}/lib/server/native-materials.ts`,
        );
        const user = (name, role = 'STUDENT') =>
          tx.user.create({
            data: { email: `${prefix}-${name}@example.invalid`, name: `${prefix}-${name}`, role },
          });
        const owner = await user('owner');
        const learner = await user('learner');
        const applicant = await user('applicant');
        const manager = await user('manager', 'TEACHER');
        const admin = await user('admin', 'ADMIN');
        const retrying = await user('retrying');
        const course = await tx.course.create({
          data: { ownerId: owner.id, name: prefix, tags: [] },
        });
        await deny(
          () =>
            admissions.updateCourseProfile(tx, learner.id, course.id, {
              name: prefix,
              avatarId: null,
            }),
          403,
        );
        const profile = await admissions.updateCourseProfile(tx, owner.id, course.id, {
          name: prefix,
          avatarId: 'R01',
        });
        assert.equal(profile.canEditProfile, true);
        const privateProblem = await tx.notebookProblem.create({
          data: {
            courseId: course.id,
            ownerId: owner.id,
            title: 'Owner question',
            type: 'short_answer',
            status: 'published',
            order: 0,
            publicContentJson: {},
            gradingJson: {},
          },
        });
        const learnerProblem = await tx.notebookProblem.create({
          data: {
            courseId: course.id,
            ownerId: learner.id,
            title: 'Learner private question',
            type: 'short_answer',
            status: 'published',
            order: 1,
            publicContentJson: {},
            gradingJson: {},
          },
        });
        const publication = {
          name: prefix,
          campus: 'UTM',
          organization: 'none',
          admission: { mode: 'open', fields: [] },
        };
        await deny(() => admissions.publishCourse(tx, learner.id, course.id, publication), 403);
        await deny(() => admissions.publishCourse(tx, admin.id, course.id, publication), 403);
        await admissions.publishCourse(tx, owner.id, course.id, publication);
        assert.equal(
          (await tx.course.findUnique({ where: { id: course.id } })).organizationId,
          null,
        );
        assert.equal(
          (await tx.notebookProblem.findUnique({ where: { id: privateProblem.id } })).ownerId,
          null,
        );
        assert.equal(
          (await tx.notebookProblem.findUnique({ where: { id: learnerProblem.id } })).ownerId,
          learner.id,
        );
        assert.ok(
          (await listPublicStoreCoursesForUser(tx, learner.id)).some(
            (item) => item.id === course.id,
          ),
          'personal course appears without organization',
        );
        assert.ok(
          (await listPublicStoreCoursesForUser(tx, owner.id)).some((item) => item.id === course.id),
          'publisher can see own listing',
        );
        assert.equal(
          (await admissions.requestCourseEntry(tx, learner.id, course.id)).status,
          'joined',
        );
        assert.equal(
          (await admissions.requestCourseEntry(tx, learner.id, course.id)).created,
          false,
        );
        const approval = {
          ...publication,
          admission: {
            mode: 'approval',
            fields: [
              { id: 'phone', label: '手机尾号后四位', kind: 'phone_last4' },
              { id: 'student', label: '学生姓名', kind: 'text' },
            ],
          },
        };
        await admissions.publishCourse(tx, owner.id, course.id, approval);
        await admissions.assertCourseAdmissionForEnrollment(tx, learner.id, course.id); // Existing members retained.
        await deny(() => admissions.requestCourseEntry(tx, applicant.id, course.id, {}), 400);
        await deny(
          () =>
            admissions.requestCourseEntry(tx, applicant.id, course.id, {
              phone: 'abc4',
              student: 'Student',
            }),
          400,
        );
        const cls = await tx.courseClass.create({
          data: {
            courseId: course.id,
            teacherId: owner.id,
            academicYear: 2026,
            academicTerm: 'fall',
            name: prefix,
            joinCode: `Q${randomUUID().replaceAll('-', '').slice(0, 5).toUpperCase()}`,
          },
        });
        await deny(() => cloneStoreCourseForUser(transactional, applicant.id, course.id), 403);
        await deny(() => classroom.joinClassroomByCode(applicant.id, cls.joinCode), 403);
        assert.equal(
          await tx.courseClassMember.count({ where: { classId: cls.id, userId: applicant.id } }),
          0,
        );
        const answers = { phone: '1234', student: 'Test student' };
        assert.equal(
          (await admissions.requestCourseEntry(tx, applicant.id, course.id, answers)).status,
          'pending',
        );
        await admissions.requestCourseEntry(tx, applicant.id, course.id, answers);
        assert.equal(
          await tx.courseJoinApplication.count({
            where: { courseId: course.id, userId: applicant.id },
          }),
          1,
        );
        assert.equal(await findCourseAccessRole(tx, applicant.id, course.id), null);
        await deny(() => admissions.listCourseApplications(tx, learner.id, course.id), 403);
        const pending = await admissions.listCourseApplications(tx, owner.id, course.id);
        assert.equal(pending.total, 1);
        assert.equal(pending.applications[0].answersJson[0].value, '1234');
        await deny(
          () =>
            admissions.reviewCourseApplication(
              tx,
              learner.id,
              course.id,
              pending.applications[0].id,
              'approved',
            ),
          403,
        );
        await tx.courseManager.create({
          data: { courseId: course.id, userId: manager.id, assignedById: owner.id },
        });
        assert.equal(
          (await admissions.getCoursePublication(tx, manager.id, course.id)).canEditProfile,
          true,
        );
        await deny(
          () =>
            contentManagement.listManagedCourseContent(tx, learner.id, course.id, 'notes', 1, ''),
          403,
        );
        await contentManagement.addManagedCourseContent(
          tx,
          manager.id,
          course.id,
          'notes',
          'Managed note',
          '# Course note',
        );
        await contentManagement.addManagedCourseContent(
          tx,
          admin.id,
          course.id,
          'problems',
          'Managed question',
          'What is 2 + 2?',
        );
        const managedNotes = await contentManagement.listManagedCourseContent(
          tx,
          manager.id,
          course.id,
          'notes',
          1,
          'Managed note',
        );
        const managedProblems = await contentManagement.listManagedCourseContent(
          tx,
          manager.id,
          course.id,
          'problems',
          1,
          'Managed question',
        );
        assert.equal(managedNotes.total, 1);
        assert.equal(managedProblems.total, 1);
        assert.equal(managedProblems.items[0].status, 'draft');
        await deny(
          () =>
            contentManagement.removeManagedCourseContent(
              tx,
              learner.id,
              course.id,
              'notes',
              managedNotes.items[0].id,
            ),
          403,
        );
        await deny(
          () =>
            contentManagement.removeManagedCourseContent(
              tx,
              manager.id,
              course.id,
              'problems',
              learnerProblem.id,
            ),
          404,
        );
        await contentManagement.removeManagedCourseContent(
          tx,
          manager.id,
          course.id,
          'notes',
          managedNotes.items[0].id,
        );
        await contentManagement.removeManagedCourseContent(
          tx,
          manager.id,
          course.id,
          'problems',
          managedProblems.items[0].id,
        );
        assert.equal(
          (
            await contentManagement.listManagedCourseContent(
              tx,
              manager.id,
              course.id,
              'notes',
              1,
              'Managed note',
            )
          ).total,
          0,
        );
        assert.equal(
          (
            await contentManagement.listManagedCourseContent(
              tx,
              manager.id,
              course.id,
              'problems',
              1,
              'Managed question',
            )
          ).total,
          0,
        );
        assert.ok(await tx.notebookProblem.findUnique({ where: { id: learnerProblem.id } }));
        const uploadId = `${prefix}-manager-note`;
        const uploadResult = await uploadNativeMaterial(transactional, manager.id, {
          courseId: course.id,
          clientId: uploadId,
          kind: 'notes',
          name: 'Manager note',
          text: '# Shared note',
        });
        assert.equal(uploadResult.status, 'saved');
        assert.equal((await tx.notebook.findUnique({ where: { id: uploadId } })).ownerId, owner.id);
        await admissions.updateCourseProfile(tx, manager.id, course.id, {
          name: prefix,
          avatarId: null,
        });
        await deny(
          () =>
            admissions.updateCourseProfile(tx, learner.id, course.id, {
              name: prefix,
              avatarId: null,
            }),
          403,
        );
        await deny(
          () =>
            admissions.updateCourseProfile(tx, manager.id, course.id, {
              name: prefix,
              avatarId: 'invalid',
            }),
          400,
        );
        assert.equal(
          (
            await classroom.listTeachableCourses({ userId: manager.id, role: 'TEACHER' }, tx)
          ).courses.find((item) => item.id === course.id).pendingApplications,
          1,
        );
        assert.equal(
          (await admissions.getCoursePublication(tx, manager.id, course.id)).canPublish,
          true,
        );
        assert.equal(
          (await admissions.getCoursePublication(tx, admin.id, course.id)).canPublish,
          true,
        );
        await admissions.publishCourse(tx, manager.id, course.id, approval);
        await admissions.publishCourse(tx, admin.id, course.id, approval);
        await deny(() => admissions.publishCourse(tx, learner.id, course.id, approval), 403);
        assert.equal(
          (await tx.notebookProblem.findUnique({ where: { id: learnerProblem.id } })).ownerId,
          learner.id,
        );
        await admissions.reviewCourseApplication(
          tx,
          manager.id,
          course.id,
          pending.applications[0].id,
          'approved',
        );
        assert.equal(
          (
            await classroom.listTeachableCourses({ userId: manager.id, role: 'TEACHER' }, tx)
          ).courses.find((item) => item.id === course.id).pendingApplications,
          0,
        );
        await admissions.reviewCourseApplication(
          tx,
          manager.id,
          course.id,
          pending.applications[0].id,
          'approved',
        );
        assert.equal(await findCourseAccessRole(tx, applicant.id, course.id), 'enrolled');
        assert.equal(
          await tx.courseEnrollment.count({ where: { courseId: course.id, userId: applicant.id } }),
          1,
        );
        assert.equal(
          await tx.courseClassMember.count({ where: { classId: cls.id, userId: applicant.id } }),
          0,
          'approval does not add to class',
        );
        assert.equal((await admissions.listCourseApplications(tx, owner.id, course.id)).total, 0);
        assert.equal(
          (await classroom.joinClassroomByCode(applicant.id, cls.joinCode)).kind,
          'class',
          'approved student joins class separately',
        );
        await admissions.requestCourseEntry(tx, retrying.id, course.id, answers);
        const retry = await tx.courseJoinApplication.findUnique({
          where: { courseId_userId: { courseId: course.id, userId: retrying.id } },
        });
        await admissions.reviewCourseApplication(tx, owner.id, course.id, retry.id, 'rejected');
        assert.equal(await findCourseAccessRole(tx, retrying.id, course.id), null);
        await admissions.requestCourseEntry(tx, retrying.id, course.id, answers);
        assert.equal(
          (await tx.courseJoinApplication.findUnique({ where: { id: retry.id } })).status,
          'pending',
        );
        await tx.user.update({ where: { id: manager.id }, data: { role: 'STUDENT' } });
        await deny(
          () => admissions.reviewCourseApplication(tx, manager.id, course.id, retry.id, 'approved'),
          403,
        );
        throw rollback;
      },
      { timeout: 60_000 },
    ),
    (error) => error === rollback,
  );
  assert.equal(await db.user.count({ where: { email: { startsWith: prefix } } }), 0);
  assert.equal(await db.course.count({ where: { name: prefix } }), 0);
  console.log(
    'PASS: ordinary-user publication; personal store listing; creator privacy; open enrollment; required phone/custom fields; pending isolation; legacy/class-code bypass protection; owner/manager-only review; idempotent approval; separate class enrollment; rejection/resubmission; role revocation; all fixtures rolled back.',
  );
} finally {
  await db.$disconnect();
}
