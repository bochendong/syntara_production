import { randomInt } from 'node:crypto';

import { Prisma } from '@/lib/server/generated-prisma';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import { prisma } from '@/lib/server/prisma';
import type { DbClient } from '@/lib/server/repositories/types';
import { currentAcademicPeriod } from './teacher-classroom-period';
import {
  assertCourseAdmissionForEnrollment,
  CourseAdmissionError,
  lockAdmissionCourse,
} from './course-admissions';
export { currentAcademicPeriod } from './teacher-classroom-period';

/**
 * 老师端班级与课堂练习。
 *
 * - 一门课每学期一个班（CourseClass），班有名单（CourseClassMember）。
 * - 一节课 = ClassSession，上课时有 6 位数字课堂码。本班名单里的人点一下进，其他人输码进。
 * - 老师发题 = ClassSessionItem。统计只算在场的人在 pushedAt ~ closedAt（或下课）之间的提交，
 *   所以各端的提交接口不用改，学生在家做过同一道题也不会混进来。
 * - 「老师」不是账号属性：谁是某个班的 teacherId，谁就是这个班的老师。
 *   老师只看得到本班名单和进过本班课堂的人的个人答题。
 */

export type AcademicTerm = 'winter' | 'summer' | 'fall';

export class ClassroomError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const TERM_LABEL: Record<AcademicTerm, string> = {
  winter: '冬季',
  summer: '夏季',
  fall: '秋季',
};

export function academicTermLabel(year: number, term: AcademicTerm): string {
  return `${year} ${TERM_LABEL[term]}`;
}

/** 班级码：6 位大写字母数字（至少一个字母），去掉容易看错的 0/O/1/I。 */
const CLASS_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CLASS_CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

export function generateClassJoinCode(): string {
  const chars = Array.from(
    { length: 6 },
    () => CLASS_CODE_ALPHABET[randomInt(CLASS_CODE_ALPHABET.length)],
  );
  if (!chars.some((char) => CLASS_CODE_LETTERS.includes(char))) {
    chars[randomInt(6)] = CLASS_CODE_LETTERS[randomInt(CLASS_CODE_LETTERS.length)];
  }
  return chars.join('');
}

export function generateSessionCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/** 输入框里的码：6 位数字 = 课堂码，否则当班级码。 */
export function normalizeJoinCode(raw: string): { kind: 'session' | 'class'; code: string } | null {
  const code = raw.replace(/[\s-]/g, '').toUpperCase();
  if (/^\d{6}$/.test(code)) return { kind: 'session', code };
  if (/^[A-Z0-9]{6}$/.test(code)) return { kind: 'class', code };
  return null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

async function withUniqueRetry<T>(create: () => Promise<T>, attempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await create();
    } catch (error) {
      if (!isUniqueConstraintError(error) || attempt >= attempts) throw error;
    }
  }
}

export type ClassroomViewer = { userId: string; role?: string | null };

function isAdmin(viewer: ClassroomViewer): boolean {
  return viewer.role === 'ADMIN';
}

/** 能在哪些课上开班：自己认领的课、自己的课、Speedup 老师身份的课、所属机构的课。 */
export function teachableCourseWhere(userId: string): Prisma.CourseWhereInput {
  return {
    OR: [
      teacherCourseAccessWhere(userId),
      { ownerId: userId },
      { organization: { members: { some: { userId } } } },
    ],
  };
}

async function assertCanTeachCourse(viewer: ClassroomViewer, courseId: string) {
  const course = await prisma.course.findFirst({
    where: isAdmin(viewer)
      ? { id: courseId }
      : { id: courseId, ...teachableCourseWhere(viewer.userId) },
    select: {
      id: true,
      name: true,
      courseCode: true,
      ownerId: true,
      organizationId: true,
      listedInCourseStore: true,
    },
  });
  if (!course) throw new ClassroomError(404, '没有找到这门课，或者你不是这门课的老师。');
  return course;
}

/** 班级的个人数据只给本班老师（和管理员）看。 */
async function loadClassForTeacher(viewer: ClassroomViewer, classId: string) {
  const cls = await prisma.courseClass.findUnique({
    where: { id: classId },
    include: {
      course: { select: { id: true, name: true, courseCode: true } },
      teacher: { select: { id: true, name: true } },
    },
  });
  if (!cls || (cls.teacherId !== viewer.userId && !isAdmin(viewer))) {
    throw new ClassroomError(404, '没有找到这个班级。');
  }
  return cls;
}

async function ensureEnrollment(
  db: Prisma.TransactionClient | typeof prisma,
  userId: string,
  courseId: string,
) {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { ownerId: true } });
  if (!course || course.ownerId === userId) return;
  await lockAdmissionCourse(db, courseId);
  try {
    await assertCourseAdmissionForEnrollment(db, userId, courseId);
  } catch (error) {
    if (error instanceof CourseAdmissionError)
      throw new ClassroomError(error.status, error.message);
    throw error;
  }
  await db.courseEnrollment.upsert({
    where: { userId_courseId: { userId, courseId } },
    update: {},
    create: { userId, courseId, source: 'classroom' },
  });
}

/* ------------------------------------------------------------------ */
/* 老师：课程与班级                                                     */
/* ------------------------------------------------------------------ */

export async function listTeachableCourses(viewer: ClassroomViewer, db: DbClient = prisma) {
  const period = currentAcademicPeriod();
  const courses = await db.course.findMany({
    where: teachableCourseWhere(viewer.userId),
    orderBy: { updatedAt: 'desc' },
    select: {
      id: true,
      name: true,
      courseCode: true,
      avatarUrl: true,
      publishedProblemCount: true,
      listedInCourseStore: true,
      ownerId: true,
      externalBinding: { select: { id: true } },
      managers: {
        where: {
          userId: viewer.userId,
          user: { isActive: true, role: { in: ['TEACHER', 'ADMIN'] } },
        },
        select: { userId: true },
      },
      _count: { select: { joinApplications: { where: { status: 'pending' } } } },
      claimedTeacherId: true,
      classes: {
        orderBy: [{ academicYear: 'desc' }, { createdAt: 'desc' }],
        select: {
          id: true,
          name: true,
          academicYear: true,
          academicTerm: true,
          teacherId: true,
          _count: { select: { members: true } },
          sessions: {
            where: { status: 'live' },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  const statistics = courses.length
    ? await db.$queryRaw<Array<{ id: string; notebookCount: number; learnerCount: number }>>`
        SELECT c.id,
          (SELECT count(*)::int FROM "Notebook" n
           WHERE n."courseId" = c.id AND n."ownerId" = c."ownerId" AND n."removedAt" IS NULL) AS "notebookCount",
          (SELECT count(*)::int FROM (
             SELECT e."userId" FROM "CourseEnrollment" e WHERE e."courseId" = c.id
             UNION
             SELECT p."buyerId" FROM "CoursePurchase" p WHERE p."sourceCourseId" = c.id
           ) learners WHERE learners."userId" <> c."ownerId") AS "learnerCount"
        FROM "Course" c WHERE c.id IN (${Prisma.join(courses.map((course) => course.id))})
      `
    : [];
  const statisticsByCourse = new Map(statistics.map((item) => [item.id, item]));
  return {
    currentPeriod: {
      ...period,
      label: academicTermLabel(period.academicYear, period.academicTerm),
    },
    courses: courses.map((course) => {
      const current = course.classes.find(
        (cls) =>
          cls.academicYear === period.academicYear && cls.academicTerm === period.academicTerm,
      );
      return {
        id: course.id,
        name: course.name,
        courseCode: course.courseCode,
        avatarUrl: course.avatarUrl,
        problemCount: course.publishedProblemCount,
        notebookCount: statisticsByCourse.get(course.id)?.notebookCount ?? 0,
        learnerCount: statisticsByCourse.get(course.id)?.learnerCount ?? 0,
        listed: course.listedInCourseStore,
        canPublish:
          !course.externalBinding &&
          (course.ownerId === viewer.userId ||
            (course.listedInCourseStore &&
              (isAdmin(viewer) ||
                course.managers.length > 0 ||
                course.claimedTeacherId === viewer.userId))),
        pendingApplications: course._count.joinApplications,
        claimedByMe: course.claimedTeacherId === viewer.userId,
        currentClass: current
          ? {
              id: current.id,
              name: current.name,
              mine: current.teacherId === viewer.userId,
              memberCount: current._count.members,
              liveSessionId: current.sessions[0]?.id ?? null,
            }
          : null,
        pastClasses: course.classes
          .filter((cls) => cls !== current && cls.teacherId === viewer.userId)
          .map((cls) => ({
            id: cls.id,
            name: cls.name,
            label: academicTermLabel(cls.academicYear, cls.academicTerm as AcademicTerm),
            memberCount: cls._count.members,
          })),
      };
    }),
  };
}

/** 这学期的班：没有就建一个，老师就是建班的人。 */
export async function ensureCurrentTermClass(viewer: ClassroomViewer, courseId: string) {
  const course = await assertCanTeachCourse(viewer, courseId);
  const period = currentAcademicPeriod();
  const existing = await prisma.courseClass.findUnique({
    where: { courseId_academicYear_academicTerm: { courseId, ...period } },
    select: { id: true, teacherId: true },
  });
  if (existing) {
    if (existing.teacherId !== viewer.userId && !isAdmin(viewer)) {
      throw new ClassroomError(409, '这门课本学期的班已经由另一位老师负责。');
    }
    return existing.id;
  }
  if (!course.listedInCourseStore) {
    throw new ClassroomError(400, '请先将课程发布到商城，再开班。');
  }
  const label = academicTermLabel(period.academicYear, period.academicTerm);
  try {
    const created = await withUniqueRetry(() =>
      prisma.courseClass.create({
        data: {
          courseId,
          ...period,
          name: `${course.courseCode?.trim() || course.name} · ${label}`,
          teacherId: viewer.userId,
          joinCode: generateClassJoinCode(),
        },
        select: { id: true },
      }),
    );
    return created.id;
  } catch (error) {
    // 两位老师同时点「开班」：输的那位读到对方的班
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await prisma.courseClass.findUnique({
      where: { courseId_academicYear_academicTerm: { courseId, ...period } },
      select: { id: true, teacherId: true },
    });
    if (!raced) throw error;
    if (raced.teacherId !== viewer.userId && !isAdmin(viewer)) {
      throw new ClassroomError(409, '这门课本学期的班已经由另一位老师负责。');
    }
    return raced.id;
  }
}

type AttemptStatus = 'pending' | 'passed' | 'failed' | 'partial' | 'error';

export async function getClassOverview(viewer: ClassroomViewer, classId: string) {
  const cls = await loadClassForTeacher(viewer, classId);
  const [members, sessions, problems] = await Promise.all([
    prisma.courseClassMember.findMany({
      where: { classId },
      orderBy: { joinedAt: 'asc' },
      select: {
        joinedAt: true,
        source: true,
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    }),
    prisma.classSession.findMany({
      where: { classId },
      orderBy: { startedAt: 'desc' },
      take: 50,
      select: {
        id: true,
        status: true,
        code: true,
        startedAt: true,
        endedAt: true,
        _count: { select: { participants: true, items: true } },
        participants: { select: { userId: true } },
      },
    }),
    prisma.notebookProblem.findMany({
      where: { courseId: cls.courseId, ownerId: null, status: 'published' },
      orderBy: [{ problemNumber: 'asc' }, { order: 'asc' }],
      take: 400,
      select: {
        id: true,
        title: true,
        type: true,
        problemNumber: true,
        chapter: { select: { id: true, name: true } },
      },
    }),
  ]);

  // 能看个人数据的人 = 本班名单 + 进过本班课堂的人
  const rosterIds = new Set(members.map((member) => member.user.id));
  const visitorIds = [
    ...new Set(
      sessions.flatMap((session) => session.participants.map((participant) => participant.userId)),
    ),
  ].filter((id) => !rosterIds.has(id));
  const visitors = visitorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: visitorIds } },
        select: { id: true, name: true, email: true, image: true },
      })
    : [];

  const studentIds = [...rosterIds, ...visitors.map((visitor) => visitor.id)];
  const progress = studentIds.length
    ? await prisma.notebookProblemProgress.findMany({
        where: { userId: { in: studentIds }, problem: { courseId: cls.courseId, ownerId: null } },
        select: {
          userId: true,
          problemId: true,
          status: true,
          score: true,
          attemptedCount: true,
          lastAttemptAt: true,
        },
      })
    : [];

  const person = (user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
  }) => ({
    userId: user.id,
    name: user.name?.trim() || user.email?.split('@')[0] || '未命名学生',
    email: user.email,
    avatarUrl: user.image,
  });

  return {
    class: {
      id: cls.id,
      name: cls.name,
      joinCode: cls.joinCode,
      label: academicTermLabel(cls.academicYear, cls.academicTerm as AcademicTerm),
      course: cls.course,
      teacher: cls.teacher,
    },
    roster: members.map((member) => ({
      ...person(member.user),
      joinedAt: member.joinedAt.getTime(),
      source: member.source,
    })),
    visitors: visitors.map(person),
    sessions: sessions.map((session) => ({
      id: session.id,
      status: session.status,
      code: session.code,
      startedAt: session.startedAt.getTime(),
      endedAt: session.endedAt?.getTime() ?? null,
      participantCount: session._count.participants,
      itemCount: session._count.items,
    })),
    problems: problems.map((problem) => ({
      id: problem.id,
      title: problem.title,
      type: problem.type,
      number: problem.problemNumber,
      chapter: problem.chapter ? { id: problem.chapter.id, name: problem.chapter.name } : null,
    })),
    progress: progress.map((row) => ({
      userId: row.userId,
      problemId: row.problemId,
      status: row.status as AttemptStatus,
      score: row.score,
      attemptedCount: row.attemptedCount,
      lastAttemptAt: row.lastAttemptAt?.getTime() ?? null,
    })),
  };
}

export async function addClassMemberByEmail(
  viewer: ClassroomViewer,
  classId: string,
  email: string,
) {
  const cls = await loadClassForTeacher(viewer, classId);
  const user = await prisma.user.findFirst({
    where: { email: { equals: email.trim(), mode: 'insensitive' }, isActive: true },
    select: { id: true },
  });
  if (!user) throw new ClassroomError(404, '这个邮箱还没有注册 Syntara。');
  await prisma.$transaction(async (tx) => {
    await tx.courseClassMember.upsert({
      where: { classId_userId: { classId, userId: user.id } },
      update: {},
      create: { classId, userId: user.id, source: 'teacher' },
    });
    await ensureEnrollment(tx, user.id, cls.courseId);
  });
}

export async function removeClassMember(viewer: ClassroomViewer, classId: string, userId: string) {
  await loadClassForTeacher(viewer, classId);
  await prisma.courseClassMember.deleteMany({ where: { classId, userId } });
}

export async function resetClassJoinCode(viewer: ClassroomViewer, classId: string) {
  await loadClassForTeacher(viewer, classId);
  return withUniqueRetry(() =>
    prisma.courseClass.update({
      where: { id: classId },
      data: { joinCode: generateClassJoinCode() },
      select: { joinCode: true },
    }),
  );
}

/* ------------------------------------------------------------------ */
/* 老师：上课                                                           */
/* ------------------------------------------------------------------ */

/** 开始上课。本班已经有一节在上的课就直接回到那节。 */
export async function startClassSession(viewer: ClassroomViewer, classId: string) {
  await loadClassForTeacher(viewer, classId);
  const live = await prisma.classSession.findFirst({
    where: { classId, status: 'live' },
    select: { id: true },
  });
  if (live) return live.id;
  const created = await withUniqueRetry(() =>
    prisma.classSession.create({
      data: { classId, teacherId: viewer.userId, code: generateSessionCode() },
      select: { id: true },
    }),
  );
  return created.id;
}

async function loadSessionForTeacher(viewer: ClassroomViewer, sessionId: string) {
  const session = await prisma.classSession.findUnique({
    where: { id: sessionId },
    include: {
      class: {
        select: {
          id: true,
          name: true,
          courseId: true,
          teacherId: true,
          course: { select: { id: true, name: true, courseCode: true } },
        },
      },
    },
  });
  if (!session || (session.class.teacherId !== viewer.userId && !isAdmin(viewer))) {
    throw new ClassroomError(404, '没有找到这节课。');
  }
  return session;
}

export type ClassSessionAction =
  | { action: 'push'; problemIds: string[] }
  | { action: 'close'; itemId: string }
  | { action: 'reopen'; itemId: string }
  | { action: 'reveal'; itemId: string }
  | { action: 'remove'; itemId: string }
  | { action: 'lock'; locked: boolean }
  | { action: 'end' };

export async function applyClassSessionAction(
  viewer: ClassroomViewer,
  sessionId: string,
  input: ClassSessionAction,
) {
  const session = await loadSessionForTeacher(viewer, sessionId);
  if (session.status !== 'live' && input.action !== 'reveal') {
    throw new ClassroomError(409, '这节课已经下课了。');
  }
  const now = new Date();
  switch (input.action) {
    case 'push': {
      const problems = await prisma.notebookProblem.findMany({
        where: {
          id: { in: input.problemIds },
          courseId: session.class.courseId,
          ownerId: null,
          status: 'published',
        },
        select: { id: true },
      });
      if (!problems.length) throw new ClassroomError(400, '只能发这门课里已发布的题。');
      const last = await prisma.classSessionItem.findFirst({
        where: { sessionId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      let position = (last?.position ?? 0) + 1;
      const order = new Map(input.problemIds.map((id, index) => [id, index]));
      for (const problem of problems.sort(
        (a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0),
      )) {
        // 同一道题再发一次 = 重新开始计时
        await prisma.classSessionItem.upsert({
          where: { sessionId_problemId: { sessionId, problemId: problem.id } },
          update: { pushedAt: now, closedAt: null, answerRevealedAt: null },
          create: { sessionId, problemId: problem.id, position: position++, pushedAt: now },
        });
      }
      return;
    }
    case 'close':
    case 'reopen':
    case 'reveal':
    case 'remove': {
      const item = await prisma.classSessionItem.findFirst({
        where: { id: input.itemId, sessionId },
        select: { id: true, closedAt: true },
      });
      if (!item) throw new ClassroomError(404, '没有找到这道题。');
      if (input.action === 'remove') {
        await prisma.classSessionItem.delete({ where: { id: item.id } });
      } else {
        await prisma.classSessionItem.update({
          where: { id: item.id },
          data:
            input.action === 'close'
              ? { closedAt: item.closedAt ?? now }
              : input.action === 'reopen'
                ? { closedAt: null }
                : { answerRevealedAt: now, closedAt: item.closedAt ?? now },
        });
      }
      return;
    }
    case 'lock':
      await prisma.classSession.update({
        where: { id: sessionId },
        data: { locked: input.locked },
      });
      return;
    case 'end':
      await prisma.$transaction([
        prisma.classSessionItem.updateMany({
          where: { sessionId, closedAt: null },
          data: { closedAt: now },
        }),
        prisma.classSession.update({
          where: { id: sessionId },
          data: { status: 'ended', endedAt: now, code: null },
        }),
      ]);
      return;
  }
}

type WindowItem = { id: string; problemId: string; pushedAt: Date; closedAt: Date | null };

/** 每个人每道课上题在时间窗里的最后一次提交（不算「运行」）。 */
async function latestAttemptsInWindows(
  items: WindowItem[],
  userIds: string[],
  sessionEnd: Date | null,
) {
  if (!items.length || !userIds.length) return new Map<string, AttemptSummary>();
  const earliest = new Date(Math.min(...items.map((item) => item.pushedAt.getTime())));
  const attempts = await prisma.notebookProblemAttempt.findMany({
    where: {
      problemId: { in: items.map((item) => item.problemId) },
      userId: { in: userIds },
      kind: { in: ['submit', 'answer'] },
      createdAt: { gte: earliest },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      problemId: true,
      userId: true,
      status: true,
      score: true,
      createdAt: true,
      activeDurationMs: true,
    },
  });
  const itemByProblem = new Map(items.map((item) => [item.problemId, item]));
  const latest = new Map<string, AttemptSummary>();
  for (const attempt of attempts) {
    const item = itemByProblem.get(attempt.problemId);
    if (!item) continue;
    const end = item.closedAt ?? sessionEnd;
    if (attempt.createdAt < item.pushedAt || (end && attempt.createdAt > end)) continue;
    const key = `${item.id}:${attempt.userId}`;
    const previous = latest.get(key);
    latest.set(key, {
      status: attempt.status as AttemptStatus,
      score: attempt.score,
      submittedAt: attempt.createdAt.getTime(),
      attempts: (previous?.attempts ?? 0) + 1,
      durationMs: attempt.activeDurationMs,
    });
  }
  return latest;
}

type AttemptSummary = {
  status: AttemptStatus;
  score: number | null;
  submittedAt: number;
  attempts: number;
  durationMs: number | null;
};

export async function getClassSessionDashboard(viewer: ClassroomViewer, sessionId: string) {
  const session = await loadSessionForTeacher(viewer, sessionId);
  const [participants, rosterCount, items] = await Promise.all([
    prisma.classSessionParticipant.findMany({
      where: { sessionId },
      orderBy: { joinedAt: 'asc' },
      select: {
        via: true,
        joinedAt: true,
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    }),
    prisma.courseClassMember.count({ where: { classId: session.classId } }),
    prisma.classSessionItem.findMany({
      where: { sessionId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        problemId: true,
        position: true,
        pushedAt: true,
        closedAt: true,
        answerRevealedAt: true,
        problem: { select: { title: true, type: true, problemNumber: true, points: true } },
      },
    }),
  ]);
  const userIds = participants.map((participant) => participant.user.id);
  const latest = await latestAttemptsInWindows(items, userIds, session.endedAt);

  return {
    session: {
      id: session.id,
      status: session.status,
      code: session.code,
      locked: session.locked,
      startedAt: session.startedAt.getTime(),
      endedAt: session.endedAt?.getTime() ?? null,
      class: { id: session.class.id, name: session.class.name, rosterCount },
      course: session.class.course,
    },
    participants: participants.map((participant) => ({
      userId: participant.user.id,
      name: participant.user.name?.trim() || participant.user.email?.split('@')[0] || '未命名学生',
      avatarUrl: participant.user.image,
      via: participant.via,
      joinedAt: participant.joinedAt.getTime(),
    })),
    items: items.map((item) => {
      const results = userIds
        .map((userId) => ({ userId, ...latest.get(`${item.id}:${userId}`) }))
        .filter((row): row is { userId: string } & AttemptSummary => Boolean(row.status));
      return {
        id: item.id,
        problemId: item.problemId,
        title: item.problem.title,
        type: item.problem.type,
        number: item.problem.problemNumber,
        points: item.problem.points,
        pushedAt: item.pushedAt.getTime(),
        closedAt: item.closedAt?.getTime() ?? null,
        answerRevealedAt: item.answerRevealedAt?.getTime() ?? null,
        submittedCount: results.length,
        passedCount: results.filter((row) => row.status === 'passed').length,
        results,
      };
    }),
  };
}

/** 发题时挑题用：这门课已发布的公有题。 */
export async function listSessionProblemChoices(viewer: ClassroomViewer, sessionId: string) {
  const session = await loadSessionForTeacher(viewer, sessionId);
  const problems = await prisma.notebookProblem.findMany({
    where: { courseId: session.class.courseId, ownerId: null, status: 'published' },
    orderBy: [{ problemNumber: 'asc' }, { order: 'asc' }],
    take: 400,
    select: {
      id: true,
      title: true,
      type: true,
      difficulty: true,
      problemNumber: true,
      chapter: { select: { id: true, name: true } },
    },
  });
  return problems.map((problem) => ({
    id: problem.id,
    title: problem.title,
    type: problem.type,
    difficulty: problem.difficulty,
    number: problem.problemNumber,
    chapter: problem.chapter,
  }));
}

/* ------------------------------------------------------------------ */
/* 学生（网页 / iPad / 本地版 App）                                      */
/* ------------------------------------------------------------------ */

export async function joinClassroomByCode(userId: string, rawCode: string) {
  const parsed = normalizeJoinCode(rawCode);
  if (!parsed) throw new ClassroomError(400, '请输入 6 位课堂码或班级码。');

  if (parsed.kind === 'session') {
    const session = await prisma.classSession.findFirst({
      where: { code: parsed.code, status: 'live' },
      select: { id: true, locked: true, classId: true, class: { select: { courseId: true } } },
    });
    if (!session) throw new ClassroomError(404, '没有找到这节课，请核对课堂码。');
    const inRoster = await prisma.courseClassMember.findUnique({
      where: { classId_userId: { classId: session.classId, userId } },
      select: { userId: true },
    });
    const already = await prisma.classSessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId: session.id, userId } },
      select: { userId: true },
    });
    if (session.locked && !inRoster && !already) {
      throw new ClassroomError(403, '老师已经锁门，暂时不能进入这节课。');
    }
    await prisma.$transaction(async (tx) => {
      await tx.classSessionParticipant.upsert({
        where: { sessionId_userId: { sessionId: session.id, userId } },
        update: {},
        create: { sessionId: session.id, userId, via: inRoster ? 'roster' : 'code' },
      });
      await ensureEnrollment(tx, userId, session.class.courseId);
    });
    return { kind: 'session' as const, sessionId: session.id, courseId: session.class.courseId };
  }

  const cls = await prisma.courseClass.findUnique({
    where: { joinCode: parsed.code },
    select: { id: true, courseId: true, archivedAt: true },
  });
  if (!cls || cls.archivedAt) throw new ClassroomError(404, '没有找到这个班级，请核对班级码。');
  await prisma.$transaction(async (tx) => {
    await tx.courseClassMember.upsert({
      where: { classId_userId: { classId: cls.id, userId } },
      update: {},
      create: { classId: cls.id, userId, source: 'code' },
    });
    await ensureEnrollment(tx, userId, cls.courseId);
  });
  return { kind: 'class' as const, classId: cls.id, courseId: cls.courseId };
}

/** 本班名单里的人点「进入课堂」。 */
export async function joinClassroomSession(userId: string, sessionId: string) {
  const session = await prisma.classSession.findFirst({
    where: { id: sessionId, status: 'live', class: { members: { some: { userId } } } },
    select: { id: true, class: { select: { courseId: true } } },
  });
  if (!session) throw new ClassroomError(404, '这节课已经结束，或者你不在这个班。');
  await prisma.$transaction(async (tx) => {
    await tx.classSessionParticipant.upsert({
      where: { sessionId_userId: { sessionId, userId } },
      update: {},
      create: { sessionId, userId, via: 'roster' },
    });
    await ensureEnrollment(tx, userId, session.class.courseId);
  });
  return { sessionId, courseId: session.class.courseId };
}

/**
 * 学生端看到的课堂：自己进了的、正在上的课，以及本班正在上但还没点进去的课。
 * 只返回自己的答题状态。
 */
export async function getStudentClassroomState(userId: string) {
  const sessions = await prisma.classSession.findMany({
    where: {
      status: 'live',
      OR: [{ participants: { some: { userId } } }, { class: { members: { some: { userId } } } }],
    },
    orderBy: { startedAt: 'desc' },
    take: 5,
    select: {
      id: true,
      startedAt: true,
      endedAt: true,
      class: {
        select: {
          name: true,
          courseId: true,
          course: { select: { name: true, courseCode: true } },
          teacher: { select: { name: true } },
        },
      },
      participants: { where: { userId }, select: { joinedAt: true } },
      items: {
        orderBy: { position: 'asc' },
        select: {
          id: true,
          problemId: true,
          position: true,
          pushedAt: true,
          closedAt: true,
          answerRevealedAt: true,
          problem: { select: { title: true, type: true, problemNumber: true } },
        },
      },
    },
  });

  return {
    sessions: await Promise.all(
      sessions.map(async (session) => {
        const joined = session.participants.length > 0;
        const latest = joined
          ? await latestAttemptsInWindows(session.items, [userId], session.endedAt)
          : new Map<string, AttemptSummary>();
        return {
          id: session.id,
          joined,
          startedAt: session.startedAt.getTime(),
          className: session.class.name,
          courseId: session.class.courseId,
          courseName: session.class.course.courseCode?.trim() || session.class.course.name,
          teacherName: session.class.teacher.name?.trim() || '老师',
          // 没进课堂之前看不到题目
          items: joined
            ? session.items.map((item) => {
                const mine = latest.get(`${item.id}:${userId}`);
                return {
                  id: item.id,
                  problemId: item.problemId,
                  title: item.problem.title,
                  type: item.problem.type,
                  number: item.problem.problemNumber,
                  open: !item.closedAt,
                  answerRevealed: Boolean(item.answerRevealedAt),
                  pushedAt: item.pushedAt.getTime(),
                  myStatus: mine?.status ?? null,
                };
              })
            : [],
        };
      }),
    ),
  };
}
