#!/usr/bin/env node
// 老师端班级 / 课堂练习的规则检查。
//   pnpm test:teacher-classroom                       只跑不需要数据库的部分
//   CLASSROOM_TEST_DATABASE_URL=postgres://… pnpm test:teacher-classroom
//                                                      再在一个一次性数据库上把整个上课流程走一遍
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

  const testDatabaseUrl = process.env.CLASSROOM_TEST_DATABASE_URL;
  if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;

  const classroom = await import('../../lib/server/teacher-classroom');

  // 1. 码的格式
  assert.deepEqual(classroom.normalizeJoinCode(' 123 456 '), { kind: 'session', code: '123456' });
  assert.deepEqual(classroom.normalizeJoinCode('ab-c2d9'), { kind: 'class', code: 'ABC2D9' });
  assert.equal(classroom.normalizeJoinCode('12345'), null);
  assert.equal(classroom.normalizeJoinCode('ABCDEFG'), null);
  for (let index = 0; index < 500; index += 1) {
    const classCode = classroom.generateClassJoinCode();
    assert.match(classCode, /^[A-HJ-NP-Z2-9]{6}$/);
    assert.match(classCode, /[A-Z]/, '班级码至少有一个字母，才不会被当成课堂码');
    assert.equal(classroom.normalizeJoinCode(classCode)?.kind, 'class');
    const sessionCode = classroom.generateSessionCode();
    assert.match(sessionCode, /^\d{6}$/);
    assert.equal(classroom.normalizeJoinCode(sessionCode)?.kind, 'session');
  }
  assert.deepEqual(classroom.currentAcademicPeriod(new Date(2026, 10, 2)), {
    academicYear: 2026,
    academicTerm: 'fall',
  });
  assert.equal(classroom.currentAcademicPeriod(new Date(2026, 1, 1)).academicTerm, 'winter');
  assert.equal(classroom.currentAcademicPeriod(new Date(2026, 5, 1)).academicTerm, 'summer');
  console.log('ok  码的格式与学期');

  // 检查开班前置条件；只替换查询方法，不连接数据库或创建真实班级。
  process.env.DATABASE_URL ??= 'postgresql://fixture:fixture@127.0.0.1:1/fixture';
  const { prisma } = await import('../../lib/server/prisma');
  const originalFindCourse = prisma.course.findFirst;
  const originalFindClass = prisma.courseClass.findUnique;
  const originalCreateClass = prisma.courseClass.create;
  try {
    prisma.course.findFirst = (async () => ({
      id: 'fixture-course',
      name: 'Fixture',
      courseCode: null,
      ownerId: 'fixture-owner',
      organizationId: null,
      listedInCourseStore: false,
    })) as typeof prisma.course.findFirst;
    prisma.courseClass.findUnique = (async () =>
      null) as unknown as typeof prisma.courseClass.findUnique;
    let created = false;
    prisma.courseClass.create = (async () => {
      created = true;
      throw new Error('unexpected create');
    }) as unknown as typeof prisma.courseClass.create;
    await assert.rejects(
      classroom.ensureCurrentTermClass({ userId: 'fixture-owner' }, 'fixture-course'),
      (error: unknown) =>
        error instanceof classroom.ClassroomError &&
        error.status === 400 &&
        error.message.includes('先将课程发布'),
    );
    assert.equal(created, false, '未发布课程不能创建班级');
    prisma.courseClass.findUnique = (async () => ({
      id: 'existing-class',
      teacherId: 'fixture-owner',
    })) as unknown as typeof prisma.courseClass.findUnique;
    assert.equal(
      await classroom.ensureCurrentTermClass({ userId: 'fixture-owner' }, 'fixture-course'),
      'existing-class',
    );
    console.log('ok  未发布课程不能开班，已有班级仍可打开');
  } finally {
    prisma.course.findFirst = originalFindCourse;
    prisma.courseClass.findUnique = originalFindClass;
    prisma.courseClass.create = originalCreateClass;
  }

  if (!testDatabaseUrl) {
    console.log('skip 数据库流程（没有设置 CLASSROOM_TEST_DATABASE_URL）');
    return;
  }

  const run = `t${Date.now().toString(36)}`;
  const user = (name: string) =>
    prisma.user.create({
      data: { id: `${run}-${name}`, name, email: `${run}-${name}@example.test` },
      select: { id: true },
    });
  const [teacher, otherTeacher, owner, alice, bob, carol] = await Promise.all(
    ['teacher', 'other', 'owner', 'alice', 'bob', 'carol'].map(user),
  );
  const org = await prisma.organization.create({
    data: {
      slug: `${run}-speedup`,
      name: '速成',
      members: {
        create: [
          { userId: teacher.id, role: 'editor' },
          { userId: otherTeacher.id, role: 'editor' },
        ],
      },
    },
  });
  const course = await prisma.course.create({
    data: {
      ownerId: owner.id,
      name: '测试课',
      courseCode: 'TST 101',
      organizationId: org.id,
      listedInCourseStore: true,
    },
  });
  const problem = (order: number, status: 'published' | 'draft' = 'published') =>
    prisma.notebookProblem.create({
      data: {
        courseId: course.id,
        title: `第 ${order} 题`,
        type: 'short_answer',
        status,
        order,
        problemNumber: order,
        publicContentJson: {},
        gradingJson: {},
      },
      select: { id: true },
    });
  const [p1, p2, draft] = await Promise.all([problem(1), problem(2), problem(3, 'draft')]);
  // carol 是从商城加的课，不在班里
  await prisma.courseEnrollment.create({ data: { userId: carol.id, courseId: course.id } });

  const T = { userId: teacher.id, role: 'USER' };
  const T2 = { userId: otherTeacher.id, role: 'USER' };
  const expectError = async (promise: Promise<unknown>, status: number) => {
    await assert.rejects(promise, (error: unknown) => {
      assert.ok(error instanceof classroom.ClassroomError, String(error));
      assert.equal(error.status, status, error.message);
      return true;
    });
  };
  const attempt = (userId: string, problemId: string, status: string, at: Date, kind = 'submit') =>
    prisma.notebookProblemAttempt.create({
      data: {
        userId,
        problemId,
        kind: kind as 'submit',
        status: status as 'passed',
        answerJson: {},
        createdAt: at,
      },
    });
  const seconds = (offset: number) => new Date(Date.now() + offset * 1000);

  try {
    // 2. 开班：机构成员能开，一门课一学期一个班，别的老师不能抢
    const listed = await classroom.listTeachableCourses(T);
    assert.ok(listed.courses.some((entry) => entry.id === course.id));
    assert.equal(
      (await classroom.listTeachableCourses({ userId: carol.id })).courses.length,
      0,
      '学生看不到可以开班的课',
    );
    const classId = await classroom.ensureCurrentTermClass(T, course.id);
    assert.equal(await classroom.ensureCurrentTermClass(T, course.id), classId);
    await expectError(classroom.ensureCurrentTermClass(T2, course.id), 409);
    await expectError(classroom.ensureCurrentTermClass({ userId: carol.id }, course.id), 404);
    await expectError(classroom.getClassOverview(T2, classId), 404);
    console.log('ok  一门课每学期一个班，只有本班老师能看');

    // 3. alice 用班级码进班
    const cls = await prisma.courseClass.findUniqueOrThrow({ where: { id: classId } });
    const joinedClass = await classroom.joinClassroomByCode(alice.id, cls.joinCode.toLowerCase());
    assert.equal(joinedClass.kind, 'class');
    assert.ok(
      await prisma.courseEnrollment.findUnique({
        where: { userId_courseId: { userId: alice.id, courseId: course.id } },
      }),
      '进班顺便加课',
    );

    // 4. 上课：再点一次「开始上课」回到同一节
    const sessionId = await classroom.startClassSession(T, classId);
    assert.equal(await classroom.startClassSession(T, classId), sessionId);
    const session = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } });
    assert.match(session.code ?? '', /^\d{6}$/);

    // 本班的人还没点进来时看得到这节课，但看不到题
    let aliceState = await classroom.getStudentClassroomState(alice.id);
    assert.equal(aliceState.sessions.length, 1);
    assert.equal(aliceState.sessions[0].joined, false);
    assert.equal((await classroom.getStudentClassroomState(carol.id)).sessions.length, 0);
    await expectError(classroom.joinClassroomSession(carol.id, sessionId), 404);
    await classroom.joinClassroomSession(alice.id, sessionId);

    // bob 输课堂码进来（旁听），顺便加课
    const joinedSession = await classroom.joinClassroomByCode(bob.id, session.code!);
    assert.equal(joinedSession.kind, 'session');
    const bobEnrollment = await prisma.courseEnrollment.findUniqueOrThrow({
      where: { userId_courseId: { userId: bob.id, courseId: course.id } },
    });
    assert.equal(bobEnrollment.source, 'classroom');

    // 锁门后 carol 输码进不来；开门后才行（但这次不进）
    await classroom.applyClassSessionAction(T, sessionId, { action: 'lock', locked: true });
    await expectError(classroom.joinClassroomByCode(carol.id, session.code!), 403);
    await classroom.applyClassSessionAction(T, sessionId, { action: 'lock', locked: false });
    await expectError(
      classroom.joinClassroomByCode(carol.id, '000000' === session.code ? '111111' : '000000'),
      404,
    );
    console.log('ok  班级名单点一下进，其他人输码进，锁门挡住新人');

    // 5. 发题前在家做过的不算
    await attempt(alice.id, p1.id, 'failed', seconds(-60));
    await expectError(
      classroom.applyClassSessionAction(T, sessionId, { action: 'push', problemIds: [draft.id] }),
      400,
    );
    await classroom.applyClassSessionAction(T, sessionId, {
      action: 'push',
      problemIds: [p2.id, p1.id],
    });
    let board = await classroom.getClassSessionDashboard(T, sessionId);
    assert.deepEqual(
      board.items.map((item) => item.problemId),
      [p2.id, p1.id],
      '按老师选的顺序发',
    );
    const item1 = board.items.find((item) => item.problemId === p1.id)!;
    assert.equal(item1.submittedCount, 0, '发题之前的提交不算');

    // 课上：alice 对，bob 先错后对，carol（不在场）也做了，run 不算提交
    await attempt(alice.id, p1.id, 'passed', seconds(2));
    await attempt(bob.id, p1.id, 'failed', seconds(3));
    await attempt(bob.id, p1.id, 'passed', seconds(4));
    await attempt(bob.id, p2.id, 'failed', seconds(4), 'run');
    await attempt(carol.id, p1.id, 'passed', seconds(4));
    board = await classroom.getClassSessionDashboard(T, sessionId);
    assert.equal(board.participants.length, 2);
    const live1 = board.items.find((item) => item.problemId === p1.id)!;
    assert.equal(live1.submittedCount, 2);
    assert.equal(live1.passedCount, 2);
    assert.equal(live1.results.find((row) => row.userId === bob.id)?.attempts, 2);
    assert.ok(!live1.results.some((row) => row.userId === carol.id), '不在场的人不出现');
    assert.equal(board.items.find((item) => item.problemId === p2.id)!.submittedCount, 0);

    aliceState = await classroom.getStudentClassroomState(alice.id);
    assert.equal(aliceState.sessions[0].joined, true);
    assert.equal(
      aliceState.sessions[0].items.find((item) => item.problemId === p1.id)?.myStatus,
      'passed',
    );
    console.log('ok  只统计在场的人、发题之后的提交');

    // 6. 收卷之后再交不算
    await classroom.applyClassSessionAction(T, sessionId, { action: 'close', itemId: live1.id });
    await prisma.classSessionItem.update({
      where: { id: live1.id },
      data: { closedAt: seconds(5) },
    });
    await attempt(alice.id, p1.id, 'failed', seconds(8));
    board = await classroom.getClassSessionDashboard(T, sessionId);
    assert.equal(
      board.items
        .find((item) => item.id === live1.id)!
        .results.find((row) => row.userId === alice.id)?.status,
      'passed',
    );
    console.log('ok  收卷之后的提交不算');

    // 7. 班级总表：名单 + 旁听，看不到 carol
    const overview = await classroom.getClassOverview(T, classId);
    assert.deepEqual(
      overview.roster.map((row) => row.userId),
      [alice.id],
    );
    assert.deepEqual(
      overview.visitors.map((row) => row.userId),
      [bob.id],
    );
    assert.ok(!overview.progress.some((row) => row.userId === carol.id));
    assert.equal(overview.problems.length, 2, '只列已发布的公有题');
    console.log('ok  老师只看得到名单和进过课堂的人');

    // 8. 下课：码失效
    await classroom.applyClassSessionAction(T, sessionId, { action: 'end' });
    const ended = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } });
    assert.equal(ended.status, 'ended');
    assert.equal(ended.code, null);
    await expectError(classroom.joinClassroomByCode(carol.id, session.code!), 404);
    assert.equal((await classroom.getStudentClassroomState(alice.id)).sessions.length, 0);
    await expectError(
      classroom.applyClassSessionAction(T, sessionId, { action: 'push', problemIds: [p1.id] }),
      409,
    );
    console.log('ok  下课后课堂码失效');
  } finally {
    await prisma.course.delete({ where: { id: course.id } }).catch(() => undefined);
    await prisma.organization.delete({ where: { id: org.id } }).catch(() => undefined);
    await prisma.user.deleteMany({ where: { id: { startsWith: `${run}-` } } });
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
