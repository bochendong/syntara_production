#!/usr/bin/env node
// 老师端班级 / 课堂练习的规则检查。
//   pnpm test:teacher-classroom                       只跑不需要数据库的部分
//   CLASSROOM_TEST_DATABASE_URL=postgres://… pnpm test:teacher-classroom
//                                                      再在一个一次性数据库上把备课、上课、下课走一遍
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
  if (testDatabaseUrl) {
    const url = new URL(testDatabaseUrl);
    assert.match(url.protocol, /^postgres(?:ql)?:$/);
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Local fixtures only');
    process.env.DATABASE_URL = url.href;
  }

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
        publicContentJson: { type: 'short_answer', stem: `第 ${order} 题的题干` },
        gradingJson: { referenceAnswer: `第 ${order} 题的参考答案` },
      },
      select: { id: true },
    });
  const [p1, p2, draft] = await Promise.all([problem(1), problem(2), problem(3, 'draft')]);
  const choiceProblem = await prisma.notebookProblem.create({
    data: {
      courseId: course.id,
      title: '选择题',
      type: 'choice',
      status: 'published',
      order: 4,
      problemNumber: 4,
      points: 10,
      publicContentJson: {
        type: 'choice',
        stem: '选一个',
        options: [
          { id: 'A', label: '甲' },
          { id: 'B', label: '乙' },
          { id: 'C', label: '丙' },
        ],
      },
      gradingJson: { type: 'choice', correctOptionIds: ['B'] },
    },
    select: { id: true },
  });
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
  const { classSessionForAttempt } = await import('../../lib/server/class-session-attempts');
  const { countNotebookProblemSubmissions, getLatestNotebookProblemSubmission } =
    await import('../../lib/server/notebook-problems/service');
  let attemptClock = Date.now();
  /** 和提交接口一样：先核对课堂标记，再写作答。每次提交间隔一秒，先后顺序才确定。 */
  const attempt = async (
    userId: string,
    problemId: string,
    status: string,
    classSessionId: string | null,
    extra: { kind?: string; answerJson?: object; score?: number } = {},
  ) =>
    prisma.notebookProblemAttempt.create({
      data: {
        userId,
        problemId,
        kind: (extra.kind ?? 'answer') as 'answer',
        status: status as 'passed',
        answerJson: extra.answerJson ?? {},
        score: extra.score,
        createdAt: new Date((attemptClock += 1000)),
        classSessionId: await classSessionForAttempt({ userId, problemId, classSessionId }),
      },
    });

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

    // 4. 往届的课导入成备课：照着题单复制，下架的题不带，别的老师不能导
    const pastClass = await prisma.courseClass.create({
      data: {
        courseId: course.id,
        academicYear: 2020,
        academicTerm: 'fall',
        name: '往届',
        teacherId: teacher.id,
        joinCode: `Z${run.slice(-5)}`.toUpperCase().padEnd(6, 'Z').slice(0, 6),
      },
    });
    const pastSession = await prisma.classSession.create({
      data: {
        classId: pastClass.id,
        teacherId: teacher.id,
        number: 1,
        name: '函数与变量',
        status: 'ended',
        startedAt: new Date('2020-10-01'),
        endedAt: new Date('2020-10-01'),
        items: {
          create: [
            { problemId: p2.id, position: 1 },
            { problemId: draft.id, position: 2 },
            { problemId: p1.id, position: 3 },
          ],
        },
      },
    });
    const importable = await classroom.listImportableSessions(T, classId);
    assert.deepEqual(
      importable.map((source) => source.sessions.map((row) => row.id)),
      [[pastSession.id]],
    );
    await expectError(classroom.listImportableSessions(T2, classId), 404);
    assert.equal(importable[0].sessions[0].name, '函数与变量');
    await expectError(classroom.importSessionsAsDrafts(T, pastClass.id, ['missing']), 404);
    const [importedId] = await classroom.importSessionsAsDrafts(T, classId, [pastSession.id]);
    // A complete series may extend past the old 400-question candidate cap.
    const pickerRows = Array.from({ length: 401 }, (_, index) => ({
      id: `${run}-picker-${index}`,
      courseId: course.id,
      title: `题库候选 ${index}`,
      type: 'short_answer' as const,
      status: 'published' as const,
      order: 10 + index,
      problemNumber: 10 + index,
      tags: index === 400 ? ['TT1模拟A卷', 'set-01'] : [],
      publicContentJson: { type: 'short_answer', stem: 'test' },
      gradingJson: { referenceAnswer: 'fixture answer' },
    }));
    const outside = await prisma.course.create({
      data: { ownerId: owner.id, name: '题目隔离用的其他课程' },
      select: { id: true },
    });
    try {
      await prisma.notebookProblem.createMany({
        data: [
          ...pickerRows,
          { ...pickerRows[0], id: `${run}-private`, ownerId: alice.id },
          { ...pickerRows[0], id: `${run}-outside`, courseId: outside.id },
        ],
      });
      const options = await classroom.listSessionProblemChoices(T, importedId);
      assert.deepEqual(
        options.map((option) => option.id),
        [p1.id, p2.id, choiceProblem.id, ...pickerRows.map((row) => row.id)],
        '选题返回全部依题号排序的公有已发布题，排除草稿、学员私有和其他课程的题',
      );
      assert.deepEqual(options.at(-1)?.tags, ['TT1模拟A卷', 'set-01']);
      await expectError(classroom.listSessionProblemChoices(T2, importedId), 404);
      await expectError(classroom.listSessionProblemChoices({ userId: alice.id }, importedId), 404);
      console.log('ok  课堂选题超过 400 题仍完整，保留系列标签及课程、题目、教师权限边界');
    } finally {
      await prisma.notebookProblem.deleteMany({
        where: { id: { in: [...pickerRows.map((row) => row.id), `${run}-private`] } },
      });
      await prisma.course.delete({ where: { id: outside.id } });
    }
    let draftBoard = await classroom.getClassSessionDashboard(T, importedId);
    assert.equal(draftBoard.session.status, 'draft');
    assert.equal(draftBoard.session.number, 1, '第一节');
    assert.equal(draftBoard.session.name, '函数与变量', '导入保留课堂名称');
    await expectError(
      classroom.applyClassSessionAction(T2, importedId, { action: 'rename', name: '越权改名' }),
      404,
    );
    await expectError(
      classroom.applyClassSessionAction({ userId: alice.id }, importedId, {
        action: 'rename',
        name: '学生不能改名',
      }),
      404,
    );
    for (const name of ['', '   ', '字'.repeat(81)]) {
      await expectError(
        classroom.applyClassSessionAction(T, importedId, { action: 'rename', name }),
        400,
      );
    }
    await classroom.applyClassSessionAction(T, importedId, {
      action: 'rename',
      name: '  循环与列表  ',
    });
    draftBoard = await classroom.getClassSessionDashboard(T, importedId);
    assert.equal(draftBoard.session.name, '循环与列表', '名称去除首尾空白并持久化');
    assert.equal(draftBoard.session.number, 1, '改名不修改节次');
    assert.equal(
      (await classroom.getClassOverview(T, classId)).sessions[0].name,
      '循环与列表',
      '课堂列表使用保存的名称',
    );
    assert.equal(draftBoard.session.code, null);
    assert.deepEqual(
      draftBoard.items.map((item) => item.problemId),
      [p2.id, p1.id],
      '导入保留顺序，没带下架的题',
    );

    // 备课：增删、调序；学生看不到
    await classroom.applyClassSessionAction(T, importedId, {
      action: 'add',
      problemIds: [choiceProblem.id, p1.id],
    });
    await classroom.applyClassSessionAction(T, importedId, {
      action: 'reorder',
      problemIds: [choiceProblem.id, p1.id, p2.id],
    });
    await classroom.applyClassSessionAction(T, importedId, { action: 'remove', problemId: p2.id });
    draftBoard = await classroom.getClassSessionDashboard(T, importedId);
    assert.deepEqual(
      draftBoard.items.map((item) => item.problemId),
      [choiceProblem.id, p1.id],
    );
    await expectError(
      classroom.applyClassSessionAction(T, importedId, { action: 'add', problemIds: [draft.id] }),
      400,
    );
    await expectError(classroom.applyClassSessionAction(T, importedId, { action: 'end' }), 409);
    assert.equal((await classroom.getStudentClassroomState(alice.id)).sessions.length, 0);
    const preview = await classroom.getClassSessionProblemPreview(T, importedId, p1.id);
    assert.equal(preview.publicContent.stem, '第 1 题的题干');
    assert.equal(preview.grading.referenceAnswer, '第 1 题的参考答案');
    assert.equal(preview.id, p1.id);
    assert.equal('secretJudge' in preview, false, '预览不包含私有判题配置');
    await expectError(classroom.getClassSessionProblemPreview(T2, importedId, p1.id), 404);
    await expectError(
      classroom.getClassSessionProblemPreview({ userId: alice.id }, importedId, p1.id),
      404,
    );
    await expectError(classroom.getClassSessionProblemPreview(T, importedId, draft.id), 404);
    await expectError(classroom.getClassSessionProblemPreview(T, importedId, 'missing'), 404);
    console.log('ok  老师可预览本节题干与参考答案，学生和无关老师无权读取');
    const scratchDraft = await classroom.createDraftSession(T, classId);
    assert.equal(
      (await classroom.getClassSessionDashboard(T, scratchDraft)).session.number,
      2,
      '第二节',
    );
    console.log('ok  备课：往届导入、增删题、调序，学生看不到');

    // 5. 上课：不用先选题；备好的课开始后有课堂码；每个班最多一节
    const [sessionId, concurrentSessionId] = await Promise.all([
      classroom.startClassSession(T, classId, importedId),
      classroom.startClassSession(T, classId, importedId),
    ]);
    assert.equal(sessionId, importedId);
    assert.equal(concurrentSessionId, sessionId);
    assert.equal(await classroom.startClassSession(T, classId), sessionId, '再点回到同一节');
    await expectError(classroom.startClassSession(T, classId, scratchDraft), 409);
    await expectError(classroom.deleteDraftSession(T, sessionId), 409);
    await expectError(classroom.deleteEndedSession(T, sessionId), 409);
    await expectError(classroom.deleteEndedSession(T, scratchDraft), 409);
    assert.equal(await classroom.deleteDraftSession(T, scratchDraft), classId);
    await expectError(
      prisma.classSession
        .create({
          data: { classId, teacherId: teacher.id, number: 99, status: 'live' },
        })
        .catch((error) => {
          assert.equal(error.code, 'P2002', '数据库也挡住第二节 live');
          throw new classroom.ClassroomError(409, 'second live');
        }),
      409,
    );
    const session = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } });
    assert.match(session.code ?? '', /^\d{6}$/);
    assert.ok(session.startedAt);
    assert.equal(session.name, '循环与列表', '开课保留备课名称');
    await classroom.applyClassSessionAction(T, sessionId, { action: 'rename', name: '循环练习' });
    assert.equal((await classroom.getLiveSessionForCourse(T, course.id))?.name, '循环练习');
    assert.equal(
      (await classroom.getStudentClassroomState(alice.id)).sessions[0].name,
      '循环练习',
      '学生端读取相同名称',
    );
    assert.deepEqual(
      await classroom.getLiveSessionForCourse({ userId: carol.id }, course.id),
      null,
    );

    // 本班的人还没点进来时看得到这节课，但看不到题
    let aliceState = await classroom.getStudentClassroomState(alice.id);
    assert.equal(aliceState.sessions.length, 1);
    assert.equal(aliceState.sessions[0].joined, false);
    assert.equal(aliceState.sessions[0].items.length, 0);
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

    // 锁门后 carol 输码进不来
    await classroom.applyClassSessionAction(T, sessionId, { action: 'lock', locked: true });
    await expectError(classroom.joinClassroomByCode(carol.id, session.code!), 403);
    await classroom.applyClassSessionAction(T, sessionId, { action: 'lock', locked: false });
    await expectError(
      classroom.joinClassroomByCode(carol.id, '000000' === session.code ? '111111' : '000000'),
      404,
    );
    console.log('ok  一个班最多一节在上；名单点一下进，其他人输码进，锁门挡住新人');

    // 6. 题库页：老师看到正在上的课；上课中加题学生马上看到
    let liveInfo = await classroom.getLiveSessionForCourse(T, course.id);
    assert.equal(liveInfo?.sessionId, sessionId);
    assert.equal(liveInfo?.presentCount, 2);
    assert.deepEqual(liveInfo?.problemIds.sort(), [choiceProblem.id, p1.id].sort());
    await classroom.applyClassSessionAction(T, sessionId, { action: 'add', problemIds: [p2.id] });
    liveInfo = await classroom.getLiveSessionForCourse(T, course.id);
    assert.ok(liveInfo?.problemIds.includes(p2.id));
    aliceState = await classroom.getStudentClassroomState(alice.id);
    assert.deepEqual(
      aliceState.sessions[0].items.map((item) => item.problemId),
      [choiceProblem.id, p1.id, p2.id],
      '加题不用再发布，学生按顺序看到',
    );

    // 7. 提交只认课堂标记
    // 平时在题库做的不算；不在这节课的 carol 和这节课没有的题都不带标记
    await attempt(alice.id, p1.id, 'failed', null);
    await attempt(carol.id, p1.id, 'passed', sessionId);
    await attempt(alice.id, draft.id, 'passed', sessionId);
    assert.equal(
      await prisma.notebookProblemAttempt.count({ where: { classSessionId: sessionId } }),
      0,
      '不在场的人、不在这节课的题都不带标记',
    );
    await attempt(alice.id, p1.id, 'passed', sessionId);
    await attempt(bob.id, p1.id, 'failed', sessionId);
    await attempt(bob.id, p1.id, 'passed', sessionId, { answerJson: { text: '第二次' } });
    await attempt(bob.id, p2.id, 'failed', sessionId, { kind: 'run' });
    await attempt(alice.id, choiceProblem.id, 'failed', sessionId, {
      answerJson: { selectedOptionIds: ['A'] },
      score: 0,
    });
    await attempt(bob.id, choiceProblem.id, 'failed', sessionId, {
      answerJson: { selectedOptionIds: ['C'] },
      score: 0,
    });
    await attempt(bob.id, choiceProblem.id, 'failed', sessionId, {
      answerJson: { selectedOptionIds: ['C'] },
      score: 0,
    });
    await attempt(alice.id, choiceProblem.id, 'failed', null, {
      answerJson: { selectedOptionIds: ['C'] },
      score: 0,
    });
    await prisma.notebookProblemAttempt.create({
      data: {
        userId: alice.id,
        problemId: choiceProblem.id,
        classSessionId: sessionId,
        kind: 'answer',
        status: 'pending',
        answerJson: { selectedOptionIds: ['C'] },
        resultJson: { event: 'answer_reset' },
        createdAt: new Date((attemptClock += 1000)),
      },
    });
    await attempt(bob.id, choiceProblem.id, 'passed', sessionId, {
      answerJson: { selectedOptionIds: ['B'] },
      score: 10,
    });
    await prisma.user.update({
      where: { id: alice.id },
      data: { speedupPhoneLast4: '0428' },
    });
    await prisma.user.update({
      where: { id: bob.id },
      data: { phone: '+14165550100' },
    });
    let board = await classroom.getClassSessionDashboard(T, sessionId);
    assert.equal(board.students.find((row) => row.userId === alice.id)?.phoneLast4, '0428');
    assert.equal(board.students.find((row) => row.userId === bob.id)?.phoneLast4, null);
    assert.ok(board.students.every((row) => !('phone' in row) && !('speedupPhoneLast4' in row)));
    await expectError(classroom.getClassSessionDashboard(T2, sessionId), 404);

    await prisma.organization.update({ where: { id: org.id }, data: { slug: `${run}-ordinary` } });
    try {
      const ordinaryBoard = await classroom.getClassSessionDashboard(T, sessionId);
      assert.ok(ordinaryBoard.students.every((row) => !('phoneLast4' in row)));
      const binding = await prisma.externalCourseBinding.create({
        data: {
          provider: 'speedup',
          externalCourseId: course.id,
          courseId: course.id,
          activatedById: owner.id,
          externalCourseName: course.name,
        },
      });
      try {
        const linkedBoard = await classroom.getClassSessionDashboard(T, sessionId);
        assert.equal(
          linkedBoard.students.find((row) => row.userId === alice.id)?.phoneLast4,
          '0428',
        );
      } finally {
        await prisma.externalCourseBinding.delete({ where: { id: binding.id } });
      }
    } finally {
      await prisma.organization.update({ where: { id: org.id }, data: { slug: org.slug } });
    }
    console.log('ok  仅 SpeedUp 课堂向有权限的老师显示已登记的四位尾号');
    assert.equal(board.session.presentCount, 2);
    assert.deepEqual(
      board.students.map((row) => [row.userId, row.present]),
      [
        [alice.id, true],
        [bob.id, true],
      ],
    );
    assert.ok(!board.students.some((row) => row.userId === carol.id), '不在场的人不出现');
    const onP1 = board.items.find((item) => item.problemId === p1.id)!;
    assert.equal(onP1.submittedCount, 2);
    assert.equal(onP1.passedCount, 2);
    assert.equal(onP1.options, null, '非选择题没有选项分布');
    assert.equal(onP1.results.find((row) => row.userId === bob.id)?.attempts, 2);
    assert.equal(
      board.items.find((item) => item.problemId === p2.id)!.submittedCount,
      0,
      '「运行」不算提交',
    );
    const onChoice = board.items.find((item) => item.problemId === choiceProblem.id)!;
    assert.deepEqual(
      onChoice.options?.map((option) => [option.id, option.count, option.correct]),
      [
        ['A', 1, false],
        ['B', 1, true],
        ['C', 0, false],
      ],
      '选项分布按每人最后一次提交',
    );
    assert.deepEqual(
      onChoice.options?.map((option) => [option.id, option.wrongSelectionUserIds]),
      [
        ['A', [alice.id]],
        ['B', []],
        ['C', [bob.id]],
      ],
      '改对后仍保留错选学生，重复错选只记一次，平时作答和草稿快照不计',
    );
    assert.equal(onChoice.results.find((row) => row.userId === bob.id)?.status, 'passed');
    assert.equal(onChoice.results.find((row) => row.userId === bob.id)?.attempts, 3);
    console.log('ok  只统计这节课的提交，选择题显示最新分布及历次错选');

    // 7b. 提交名额：课堂提交和平时提交各算各的
    const quotaProblem = await problem(9);
    await classroom.applyClassSessionAction(T, sessionId, {
      action: 'add',
      problemIds: [quotaProblem.id],
    });
    const homeCount = () =>
      countNotebookProblemSubmissions({ userId: alice.id, problemId: quotaProblem.id });
    for (let index = 0; index < 3; index += 1) {
      await attempt(alice.id, quotaProblem.id, 'failed', null, { kind: 'submit' });
    }
    assert.equal(await homeCount(), 3, '平时用满 3 次');
    await attempt(alice.id, quotaProblem.id, 'passed', sessionId, {
      kind: 'submit',
      answerJson: { code: 'class' },
    });
    assert.equal(await homeCount(), 3, '课堂提交不占名额');
    const inClass = await classroom.getSessionStudentAnswers(
      T,
      sessionId,
      quotaProblem.id,
      alice.id,
    );
    assert.equal(inClass.attempts.length, 1, '平时用满了，课堂还能交，且只显示课堂这次');
    assert.deepEqual(inClass.attempts[0].answer, { code: 'class' });
    // bob 只在课上交：平时名额一次没用；平时的「上一次提交」也不会读到课堂的作答
    await attempt(bob.id, quotaProblem.id, 'failed', sessionId, { kind: 'submit' });
    await attempt(bob.id, quotaProblem.id, 'failed', sessionId, { kind: 'submit' });
    assert.equal(
      await countNotebookProblemSubmissions({ userId: bob.id, problemId: quotaProblem.id }),
      0,
      '课堂提交不减少平时名额',
    );
    assert.equal(
      await getLatestNotebookProblemSubmission({ userId: bob.id, problemId: quotaProblem.id }),
      null,
    );
    await classroom.applyClassSessionAction(T, sessionId, {
      action: 'remove',
      problemId: quotaProblem.id,
    });
    console.log('ok  课堂提交和平时提交的名额互不影响');

    // 8. 点弹珠：全部提交，新的在前；只给本班老师看；分数换算成 0~1
    const answers = await classroom.getSessionStudentAnswers(T, sessionId, p1.id, bob.id);
    assert.equal(answers.attempts.length, 2);
    assert.deepEqual(answers.attempts[0].answer, { text: '第二次' });
    const choiceAnswers = await classroom.getSessionStudentAnswers(
      T,
      sessionId,
      choiceProblem.id,
      bob.id,
    );
    assert.equal(choiceAnswers.attempts[0].score, 1);
    await expectError(classroom.getSessionStudentAnswers(T2, sessionId, p1.id, bob.id), 404);
    await expectError(classroom.getSessionStudentAnswers(T, sessionId, p1.id, carol.id), 404);
    await expectError(classroom.getSessionStudentAnswers(T, sessionId, draft.id, bob.id), 404);
    assert.equal(
      (await classroom.getSessionStudentAnswers(T, sessionId, p2.id, alice.id)).attempts.length,
      0,
    );
    console.log('ok  老师能看本节提交记录，看不到别人');

    // 9. 学生自己的弹珠
    aliceState = await classroom.getStudentClassroomState(alice.id);
    assert.equal(aliceState.sessions[0].joined, true);
    const aliceP1 = aliceState.sessions[0].items.find((item) => item.problemId === p1.id);
    assert.equal(aliceP1?.myStatus, 'passed');
    assert.equal(aliceP1?.myAttempts, 1, '平时做的那次不算');

    // 10. 去掉一道题：标记留着，加回来统计也回来
    await classroom.applyClassSessionAction(T, sessionId, { action: 'remove', problemId: p1.id });
    assert.ok(
      !(await classroom.getClassSessionDashboard(T, sessionId)).items.some(
        (item) => item.problemId === p1.id,
      ),
    );
    await classroom.applyClassSessionAction(T, sessionId, { action: 'add', problemIds: [p1.id] });
    board = await classroom.getClassSessionDashboard(T, sessionId);
    assert.equal(board.items.find((item) => item.problemId === p1.id)?.submittedCount, 2);
    console.log('ok  去掉的题加回来统计还在');

    // 11. 班级页：名单 + 旁听，看不到 carol，节次按新到旧
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
    assert.equal(overview.problems.length, 4, '只列已发布的公有题');
    assert.deepEqual(
      overview.sessions.map((row) => [row.number, row.status]),
      [[1, 'live']],
    );
    console.log('ok  老师只看得到名单和进过课堂的人');

    // 12. 下课：码失效；从课堂入口补交还算这节课；学生能回到上过的课；老师能回看
    await classroom.applyClassSessionAction(T, sessionId, { action: 'end' });
    const ended = await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } });
    assert.equal(ended.status, 'ended');
    assert.equal(ended.code, null);
    await classroom.applyClassSessionAction(T, sessionId, { action: 'rename', name: '循环复习' });
    assert.equal(
      (await classroom.getClassSessionDashboard(T, sessionId)).session.name,
      '循环复习',
      '下课后仍可修改课堂名称',
    );
    assert.equal((await classroom.getStudentClassroomState(alice.id)).past[0].name, '循环复习');
    await expectError(classroom.joinClassroomByCode(carol.id, session.code!), 404);
    aliceState = await classroom.getStudentClassroomState(alice.id);
    assert.equal(aliceState.sessions.length, 0);
    assert.deepEqual(
      aliceState.past.map((row) => row.id),
      [sessionId],
    );
    await expectError(
      classroom.applyClassSessionAction(T, sessionId, { action: 'add', problemIds: [p1.id] }),
      409,
    );
    await attempt(alice.id, p2.id, 'partial', sessionId);
    board = await classroom.getClassSessionDashboard(T, sessionId);
    const lateItem = board.items.find((item) => item.problemId === p2.id)!;
    assert.equal(lateItem.submittedCount, 1, '下课后从课堂入口交的还算这节课');
    assert.equal(lateItem.partialCount, 1);
    assert.equal(board.session.status, 'ended');
    assert.equal(await classroom.getLiveSessionForCourse(T, course.id), null);
    console.log('ok  下课后课堂码失效，补交算这节课，可以回看');

    // 13. 下一节从 2 开始，开始上课不用选题
    const nextId = await classroom.startClassSession(T, classId);
    const next = await classroom.getClassSessionDashboard(T, nextId);
    assert.equal(next.session.number, 2);
    assert.equal(next.items.length, 0);
    assert.deepEqual(
      next.students.map((row) => [row.userId, row.present]),
      [[alice.id, false]],
      '名单学生没进来也占一行',
    );
    await classroom.applyClassSessionAction(T, nextId, { action: 'end' });
    console.log('ok  开始上课不用先选题');

    // 14. 删除已下课：撤下两端入口和往届导入，历史作答／题单／到课保留，节次不复用。
    await expectError(classroom.deleteEndedSession(T2, sessionId), 404);
    await expectError(classroom.deleteEndedSession({ userId: alice.id }, sessionId), 404);
    await expectError(classroom.deleteEndedSession(T, 'missing-session'), 404);
    const attemptsBefore = await prisma.notebookProblemAttempt.findMany({
      where: { classSessionId: sessionId },
      orderBy: { id: 'asc' },
    });
    assert.ok(attemptsBefore.length > 0);
    const itemCount = await prisma.classSessionItem.count({ where: { sessionId } });
    const participantCount = await prisma.classSessionParticipant.count({ where: { sessionId } });
    const problemsBefore = await prisma.notebookProblem.count({ where: { courseId: course.id } });
    await prisma.notebookProblemProgress.create({
      data: { userId: alice.id, problemId: p1.id, status: 'passed', score: 100, attemptedCount: 2 },
    });
    const progressBefore = await prisma.notebookProblemProgress.findMany({
      where: { problem: { courseId: course.id } },
      orderBy: [{ userId: 'asc' }, { problemId: 'asc' }],
    });
    assert.equal((await classroom.getClassOverview(T, classId)).nextSessionNumber, 3);
    assert.deepEqual(
      await Promise.all([
        classroom.deleteEndedSession(T, sessionId),
        classroom.deleteEndedSession(T, sessionId),
      ]),
      [classId, classId],
      '重复和并发删除幂等',
    );
    assert.equal(
      (await prisma.classSession.findUniqueOrThrow({ where: { id: sessionId } })).status,
      'deleted',
    );
    assert.deepEqual(
      await prisma.notebookProblemAttempt.findMany({
        where: { classSessionId: sessionId },
        orderBy: { id: 'asc' },
      }),
      attemptsBefore,
      '作答及其课堂归属完整保留',
    );
    assert.equal(await prisma.classSessionItem.count({ where: { sessionId } }), itemCount);
    assert.equal(
      await prisma.classSessionParticipant.count({ where: { sessionId } }),
      participantCount,
    );
    assert.equal(
      await prisma.notebookProblem.count({ where: { courseId: course.id } }),
      problemsBefore,
    );
    assert.deepEqual(
      await prisma.notebookProblemProgress.findMany({
        where: { problem: { courseId: course.id } },
        orderBy: [{ userId: 'asc' }, { problemId: 'asc' }],
      }),
      progressBefore,
    );
    assert.ok(
      !(await classroom.getClassOverview(T, classId)).sessions.some((row) => row.id === sessionId),
    );
    assert.ok(
      !(await classroom.getStudentClassroomState(alice.id)).past.some(
        (row) => row.id === sessionId,
      ),
    );
    await expectError(classroom.getClassSessionDashboard(T, sessionId), 404);
    await expectError(classroom.getClassSessionProblemPreview(T, sessionId, p1.id), 404);
    await expectError(classroom.getSessionStudentAnswers(T, sessionId, p1.id, alice.id), 404);
    await expectError(
      classroom.applyClassSessionAction(T, sessionId, { action: 'rename', name: '不能恢复' }),
      404,
    );
    assert.equal(
      await classSessionForAttempt(
        { userId: alice.id, problemId: p1.id, classSessionId: sessionId },
        prisma,
      ),
      null,
    );
    await classroom.deleteEndedSession(T, pastSession.id);
    assert.ok(
      !(await classroom.listImportableSessions(T, classId)).some((source) =>
        source.sessions.some((row) => row.id === pastSession.id),
      ),
    );
    await expectError(classroom.importSessionsAsDrafts(T, classId, [pastSession.id]), 404);
    await classroom.deleteEndedSession(T, nextId);
    const deletedOverview = await classroom.getClassOverview(T, classId);
    assert.equal(deletedOverview.sessions.length, 0);
    assert.equal(deletedOverview.nextSessionNumber, 3, '删除末节仍展示真实下一节编号');
    const afterDeleted = await classroom.createDraftSession(T, classId);
    assert.equal((await classroom.getClassSessionDashboard(T, afterDeleted)).session.number, 3);
    console.log('ok  删除已下课仅撤下课堂入口；权限、并发幂等、历史保留、导入隔离和节次不复用');
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
