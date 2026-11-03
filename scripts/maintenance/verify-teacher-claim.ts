#!/usr/bin/env node
// 老师认领课程 + 学生 Speedup 手机尾号的规则检查。
//   pnpm test:teacher-claim                                 只跑不需要数据库的部分
//   CLAIM_TEST_DATABASE_URL=postgres://… pnpm test:teacher-claim
//                                                            再在一次性数据库上走一遍
// 数据库部分会写入测试数据，只能指向本机临时库，不要指向测试服或正式服。

import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';

async function main() {
  const root = path.resolve(__dirname, '../..');
  type ResolveFilename = (
    request: string,
    parent: NodeModule | undefined,
    isMain: boolean,
    options?: { paths?: string[] },
  ) => string;
  const commonJsModule = Module as unknown as { _resolveFilename: ResolveFilename };
  const originalResolveFilename = commonJsModule._resolveFilename;
  commonJsModule._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    const resolvedRequest = request.startsWith('@/') ? path.join(root, request.slice(2)) : request;
    return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
  };

  const testDatabaseUrl = process.env.CLAIM_TEST_DATABASE_URL;
  if (testDatabaseUrl) {
    const target = new URL(testDatabaseUrl);
    assert.ok(
      ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname),
      '认领测试只能使用本机一次性数据库。',
    );
    process.env.DATABASE_URL = testDatabaseUrl;
  }

  const phone = await import('../../lib/server/speedup-phone');
  assert.equal(phone.parsePhoneLast4('1234'), '1234');
  assert.equal(phone.parsePhoneLast4(' 0042 '), '0042');
  assert.equal(phone.parsePhoneLast4('123'), null);
  assert.equal(phone.parsePhoneLast4('12a4'), null);
  assert.equal(phone.parsePhoneLast4(1234), null);
  console.log('ok  手机尾号格式');

  if (!testDatabaseUrl) {
    console.log('skip 数据库流程（没有设置 CLAIM_TEST_DATABASE_URL）');
    return;
  }

  const { prisma } = await import('../../lib/server/prisma');
  const claim = await import('../../lib/server/teacher-course-claim');
  const classroom = await import('../../lib/server/teacher-classroom');
  const admissions = await import('../../lib/server/course-admissions');
  const { findCourseAccessRole } =
    await import('../../lib/server/repositories/course-enrollment-repository');
  const { setAdminCourseManager } = await import('../../lib/server/admin-course-management');
  const run = `c${Date.now().toString(36)}`;
  const user = (name: string) =>
    prisma.user.create({
      data: { id: `${run}-${name}`, name, email: `${run}-${name}@example.test` },
      select: { id: true },
    });
  const [owner, teacherA, teacherB, student, newStudent] = await Promise.all(
    ['owner', 'a', 'b', 'student', 'new'].map(user),
  );
  const speedup = await prisma.organization.create({
    data: { slug: `${run}-speedup-staging`, name: 'Speedup' },
  });
  const otherOrg = await prisma.organization.create({
    data: { slug: `${run}-school`, name: `${run} 学校` },
  });
  const course = (name: string, courseCode: string, organizationId: string | null) =>
    prisma.course.create({
      data: { ownerId: owner.id, name, courseCode, organizationId, listedInCourseStore: true },
      select: { id: true },
    });
  const cpsc = await course(`${run} CPSC110`, `${run}-CPSC 110`, speedup.id);
  const csc = await course(`${run} CSC108`, `${run}-CSC 108`, speedup.id);
  const mat = await course(`${run} MAT102`, `${run}-MAT 102`, otherOrg.id);
  const personal = await course(`${run} 自己的课`, `${run}-ME 1`, null);

  const hidden = await course(run + ' Hidden', run + '-HIDDEN', speedup.id);
  await prisma.course.update({ where: { id: hidden.id }, data: { listedInCourseStore: false } });
  const external = await course(run + ' External', run + '-EXTERNAL', speedup.id);
  await prisma.externalCourseBinding.create({
    data: {
      provider: 'claim-qa',
      externalCourseId: run,
      courseId: external.id,
      activatedById: owner.id,
      externalCourseName: 'External',
    },
  });
  const managerTeacher = await prisma.user.create({
    data: { id: run + '-manager', email: run + '-manager@example.test', role: 'TEACHER' },
  });
  const admin = await prisma.user.create({
    data: { id: run + '-admin', email: run + '-admin@example.test', role: 'ADMIN' },
  });
  const adminViewer = { userId: admin.id, email: admin.email };
  const assign = (courseId: string, userId: string, assigned = true) =>
    prisma.$transaction((tx) =>
      setAdminCourseManager(tx, adminViewer, { courseId, userId, assigned }),
    );
  const A = { userId: teacherA.id, role: 'USER' };
  const B = { userId: teacherB.id, role: 'USER' };
  const expectError = async (promise: Promise<unknown>, status: number) => {
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof classroom.ClassroomError);
      assert.equal(error.status, status);
      return true;
    });
  };
  const mineOf = async (viewer: typeof A) =>
    (await classroom.listTeachableCourses(viewer)).courses
      .filter((c) => c.claimedByMe)
      .map((c) => c.id);

  // 1. 只有机构课能认领；个人课不在列表里
  const listed = (await claim.listClaimableCourses(A, run)).courses.map((c) => c.id);
  assert.deepEqual(new Set(listed), new Set([cpsc.id, csc.id, mat.id]));
  await expectError(claim.claimCourse(A, personal.id), 404);
  await expectError(claim.claimCourse(A, hidden.id), 404);
  await expectError(claim.claimCourse(A, external.id), 404);
  await prisma.user.update({ where: { id: teacherA.id }, data: { isActive: false } });
  await expectError(claim.claimCourse(A, cpsc.id), 403);
  await expectError(claim.listClaimableCourses(A, run), 403);
  await prisma.user.update({ where: { id: teacherA.id }, data: { isActive: true } });
  // 搜索按课号
  const searched = (await claim.listClaimableCourses(A, `${run}-CPSC`)).courses.map((c) => c.id);
  assert.deepEqual(searched, [cpsc.id]);
  console.log('ok  可认领列表与搜索');

  // 2. 认领后出现在教学里；一门课只有一位老师
  assert.equal((await classroom.listTeachableCourses(A)).courses.length, 0);
  await claim.claimCourse(A, cpsc.id);
  await claim.claimCourse(A, cpsc.id); // 重复认领不报错
  const home = await classroom.listTeachableCourses(A);
  assert.deepEqual(
    home.courses.map((c) => [c.id, c.claimedByMe]),
    [[cpsc.id, true]],
  );
  await expectError(claim.claimCourse(B, cpsc.id), 409);
  const seenByB = (await claim.listClaimableCourses(B, run)).courses;
  assert.ok(!seenByB.some((c) => c.id === cpsc.id), '其他老师认领的课程不出现在认领列表');
  assert.ok(
    !(await claim.listClaimableCourses(A, run)).courses.some((c) => c.id === cpsc.id),
    '自己认领的课程也不出现在认领列表',
  );
  assert.deepEqual(
    (await claim.listClaimableCourses(A, `${run}-CPSC`)).courses,
    [],
    '搜索同样排除已认领课程',
  );
  assert.deepEqual(await mineOf(A), [cpsc.id]);
  assert.equal(await findCourseAccessRole(prisma, teacherA.id, cpsc.id), 'owner');
  const rights = await admissions.getCoursePublication(prisma, teacherA.id, cpsc.id);
  assert.equal(rights.canEditProfile, true);
  assert.equal(rights.canPublish, true);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: teacherA.id } })).role, 'USER');
  await prisma.user.update({ where: { id: teacherA.id }, data: { isActive: false } });
  assert.notEqual(await findCourseAccessRole(prisma, teacherA.id, cpsc.id), 'owner');
  await prisma.user.update({ where: { id: teacherA.id }, data: { isActive: true } });
  // 认领的老师可以开班
  const classId = await classroom.ensureCurrentTermClass(A, cpsc.id);
  assert.ok(classId);
  await expectError(classroom.ensureCurrentTermClass(B, cpsc.id), 404);
  console.log('ok  一门课一位老师，认领后可以开班');

  // 3. 同时认领：只有一个成功
  const race = await Promise.allSettled([
    claim.claimCourse(A, csc.id),
    claim.claimCourse(B, csc.id),
  ]);
  assert.equal(race.filter((r) => r.status === 'fulfilled').length, 1);
  const cscRow = await prisma.course.findUnique({
    where: { id: csc.id },
    select: { claimedTeacherId: true },
  });
  assert.ok([teacherA.id, teacherB.id].includes(cscRow?.claimedTeacherId ?? ''));
  console.log('ok  同时认领只有一位成功');

  // 4. 退出认领：只有认领的老师能退；退出后别人可以认领
  await expectError(claim.releaseCourseClaim(B, cpsc.id), 404);
  await claim.releaseCourseClaim(A, cpsc.id);
  assert.ok(
    (await claim.listClaimableCourses(B, run)).courses.some((c) => c.id === cpsc.id),
    '退出认领后重新出现在列表',
  );
  await claim.claimCourse(B, cpsc.id);
  assert.ok((await mineOf(B)).includes(cpsc.id));
  assert.ok(!(await mineOf(A)).includes(cpsc.id));
  assert.equal(
    (await prisma.courseClass.findUnique({ where: { id: classId }, select: { id: true } }))?.id,
    classId,
    '退出认领不删已开的班',
  );
  await expectError(classroom.ensureCurrentTermClass(B, cpsc.id), 409);
  console.log('ok  退出认领；原班级不被新认领者接管');

  await assign(mat.id, managerTeacher.id);
  await expectError(claim.claimCourse(A, mat.id), 409);
  assert.ok(
    !(await claim.listClaimableCourses(A, run)).courses.some((c) => c.id === mat.id),
    '已分配负责老师的课程不出现在列表',
  );
  const managerViewer = { userId: managerTeacher.id, role: 'TEACHER' };
  assert.ok(
    !(await claim.listClaimableCourses(managerViewer, run)).courses.some((c) => c.id === mat.id),
    '负责老师本人也不会在认领列表看到该课程',
  );
  await assign(mat.id, managerTeacher.id, false);
  await assign(mat.id, admin.id);
  await claim.claimCourse(A, mat.id);
  assert.equal(
    await findCourseAccessRole(prisma, A.userId, mat.id),
    'owner',
    'ADMIN 协管不阻止老师认领',
  );
  await assign(mat.id, managerTeacher.id);
  assert.equal(
    (await prisma.course.findUniqueOrThrow({ where: { id: mat.id } })).claimedTeacherId,
    null,
    '管理员明确分配老师时撤销其他自助认领',
  );
  await expectError(claim.claimCourse(A, mat.id), 409);
  await assign(mat.id, managerTeacher.id, false);
  const assignmentRace = await Promise.allSettled([
    claim.claimCourse(A, mat.id),
    assign(mat.id, managerTeacher.id),
  ]);
  assert.equal(assignmentRace[1].status, 'fulfilled');
  const finalCourse = await prisma.course.findUniqueOrThrow({ where: { id: mat.id } });
  assert.equal(finalCourse.claimedTeacherId, null, '并发认领与管理员分配后只有分配的老师');
  assert.equal(
    await prisma.courseManager.count({
      where: { courseId: mat.id, user: { role: 'TEACHER', isActive: true } },
    }),
    1,
  );
  await assign(mat.id, managerTeacher.id, false);
  await claim.claimCourse(A, mat.id);
  await assign(mat.id, A.userId, false);
  assert.equal(
    (await prisma.course.findUniqueOrThrow({ where: { id: mat.id } })).claimedTeacherId,
    null,
    '管理员移除自助认领者可撤销课程权限',
  );
  console.log('ok  管理员协管、老师分配与认领并发串行、移除认领权限');

  // 5. 手机尾号：有 Speedup 课才问，几门课只问一次，填过不再问
  await prisma.courseEnrollment.createMany({
    data: [
      { userId: student.id, courseId: cpsc.id },
      { userId: student.id, courseId: csc.id },
      { userId: student.id, courseId: mat.id },
      { userId: newStudent.id, courseId: mat.id },
    ],
  });
  const before = await phone.getSpeedupPhoneState(prisma, student.id);
  assert.equal(before.needed, true);
  assert.deepEqual(new Set(before.courses), new Set([`${run}-CPSC 110`, `${run}-CSC 108`]));
  assert.deepEqual(await phone.getSpeedupPhoneState(prisma, newStudent.id), {
    needed: false,
    courses: [],
  });
  await phone.saveSpeedupPhoneLast4(prisma, student.id, '0428');
  assert.equal((await phone.getSpeedupPhoneState(prisma, student.id)).needed, false);
  const saved = await prisma.user.findUnique({
    where: { id: student.id },
    select: { speedupPhoneLast4: true, speedupPhoneSavedAt: true },
  });
  assert.equal(saved?.speedupPhoneLast4, '0428');
  assert.ok(saved?.speedupPhoneSavedAt);
  console.log('ok  Speedup 手机尾号只问一次');

  // 已认领课程必须在数据库取列表上限之前排除，避免可认领课程被挤出。
  const occupied = Array.from({ length: 301 }, (_, index) => ({
    id: `${run}-occupied-${index}`,
    ownerId: owner.id,
    organizationId: speedup.id,
    name: `${run}-limit A${index}`,
    courseCode: `${run}-LIMIT-${index}`,
    listedInCourseStore: true,
    claimedTeacherId: teacherA.id,
    claimedAt: new Date(),
  }));
  const available = Array.from({ length: 2 }, (_, index) => ({
    id: `${run}-available-${index}`,
    ownerId: owner.id,
    organizationId: speedup.id,
    name: `${run}-limit Z${index}`,
    courseCode: `${run}-LIMIT-FREE-${index}`,
    listedInCourseStore: true,
  }));
  await prisma.course.createMany({ data: [...occupied, ...available] });
  const afterLimit = (await claim.listClaimableCourses(B, `${run}-LIMIT`)).courses;
  assert.deepEqual(new Set(afterLimit.map((c) => c.id)), new Set(available.map((c) => c.id)));
  assert.ok(afterLimit.every((c) => c.claim === 'free'));
  console.log('ok  已认领课程在查询上限前排除');

  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
