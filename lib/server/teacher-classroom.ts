import { randomInt } from 'node:crypto';

import { Prisma } from '@/lib/server/generated-prisma';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import { prisma } from '@/lib/server/prisma';
import { parsePhoneLast4, speedupOrganizationWhere } from '@/lib/server/speedup-phone';
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
 * - 一个班有很多节课（ClassSession，第 N 节），可以提前备课（draft），同时最多一节在上（live）。
 *   上课时有 6 位数字课堂码。本班名单里的人点一下进，其他人输码进。
 * - 这节课的题 = ClassSessionItem，加进来学生立刻看得到。
 * - 从课堂入口提交的作答带 classSessionId，统计只看这个标记：下课后从课堂入口再交也算这节课，
 *   学生平时在题库做同一道题不会混进来。
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
  const [members, sessions, problems, nextNumber] = await Promise.all([
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
      where: { classId, status: { not: 'deleted' } },
      orderBy: { number: 'desc' },
      take: 100,
      select: {
        id: true,
        number: true,
        name: true,
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
    nextSessionNumber(classId),
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
    nextSessionNumber: nextNumber,
    sessions: sessions.map((session) => ({
      id: session.id,
      number: session.number,
      name: session.name,
      status: session.status,
      code: session.code,
      startedAt: session.startedAt?.getTime() ?? null,
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
/* 老师：备课和上课                                                     */
/* ------------------------------------------------------------------ */

async function nextSessionNumber(classId: string) {
  const last = await prisma.classSession.aggregate({
    where: { classId },
    _max: { number: true },
  });
  return (last._max.number ?? 0) + 1;
}

/**
 * 开始上课：不用先选题。传 sessionId 就让那节备好的课开始，否则新开一节。
 * 每个班最多一节在上的课：同一节再点回到那节，换一节要先下课。
 */
export async function startClassSession(
  viewer: ClassroomViewer,
  classId: string,
  draftSessionId?: string,
) {
  await loadClassForTeacher(viewer, classId);
  const findLive = () =>
    prisma.classSession.findFirst({
      where: { classId, status: 'live' },
      select: { id: true },
    });
  const live = await findLive();
  if (live) {
    if (draftSessionId && draftSessionId !== live.id) {
      throw new ClassroomError(409, '还有一节课没下课。');
    }
    return live.id;
  }
  try {
    return await withUniqueRetry(async () => {
      if (draftSessionId) {
        const updated = await prisma.classSession.updateMany({
          where: { id: draftSessionId, classId, status: 'draft' },
          data: {
            status: 'live',
            code: generateSessionCode(),
            startedAt: new Date(),
            teacherId: viewer.userId,
          },
        });
        if (!updated.count) {
          const current = await findLive();
          if (current?.id === draftSessionId) return draftSessionId;
          if (current) throw new ClassroomError(409, '还有一节课没下课。');
          throw new ClassroomError(404, '没有找到这节课。');
        }
        return draftSessionId;
      }
      const created = await prisma.classSession.create({
        data: {
          classId,
          teacherId: viewer.userId,
          number: await nextSessionNumber(classId),
          status: 'live',
          code: generateSessionCode(),
          startedAt: new Date(),
        },
        select: { id: true },
      });
      return created.id;
    });
  } catch (error) {
    // 同时点了两次「开始」：回到已经开始的那节。
    if (!isUniqueConstraintError(error)) throw error;
    const raced = await findLive();
    if (!raced) throw error;
    if (draftSessionId && draftSessionId !== raced.id) {
      throw new ClassroomError(409, '还有一节课没下课。');
    }
    return raced.id;
  }
}

/** 提前备一节课：有序的题单，上课时再开始。 */
export async function createDraftSession(viewer: ClassroomViewer, classId: string) {
  await loadClassForTeacher(viewer, classId);
  const created = await withUniqueRetry(async () =>
    prisma.classSession.create({
      data: {
        classId,
        teacherId: viewer.userId,
        number: await nextSessionNumber(classId),
        status: 'draft',
      },
      select: { id: true },
    }),
  );
  return created.id;
}

/** 同一门课之前学期、我带的班（管理员看全部）里有题的课，可以导入成这学期的备课。 */
export async function listImportableSessions(viewer: ClassroomViewer, classId: string) {
  const cls = await loadClassForTeacher(viewer, classId);
  const classes = await prisma.courseClass.findMany({
    where: {
      courseId: cls.courseId,
      id: { not: classId },
      ...(isAdmin(viewer) ? {} : { teacherId: viewer.userId }),
    },
    orderBy: [{ academicYear: 'desc' }, { academicTerm: 'desc' }],
    select: {
      id: true,
      academicYear: true,
      academicTerm: true,
      sessions: {
        where: { status: { not: 'deleted' }, items: { some: {} } },
        orderBy: { number: 'asc' },
        select: {
          id: true,
          number: true,
          name: true,
          items: {
            orderBy: { position: 'asc' },
            select: { problem: { select: { title: true } } },
          },
        },
      },
    },
  });
  return classes
    .filter((source) => source.sessions.length)
    .map((source) => ({
      classId: source.id,
      label: academicTermLabel(source.academicYear, source.academicTerm as AcademicTerm),
      sessions: source.sessions.map((session) => ({
        id: session.id,
        number: session.number,
        name: session.name,
        itemCount: session.items.length,
        titles: session.items.slice(0, 3).map((item) => item.problem.title),
      })),
    }));
}

/** 把往届的几节课照着题单复制成这学期的备课，之后可以再增删题。已下架的题不带过来。 */
export async function importSessionsAsDrafts(
  viewer: ClassroomViewer,
  classId: string,
  sessionIds: string[],
) {
  const cls = await loadClassForTeacher(viewer, classId);
  const sources = await prisma.classSession.findMany({
    where: {
      id: { in: sessionIds },
      status: { not: 'deleted' },
      class: {
        courseId: cls.courseId,
        id: { not: classId },
        ...(isAdmin(viewer) ? {} : { teacherId: viewer.userId }),
      },
    },
    orderBy: [{ class: { academicYear: 'asc' } }, { number: 'asc' }],
    select: {
      name: true,
      items: {
        where: { problem: { status: 'published', ownerId: null } },
        orderBy: { position: 'asc' },
        select: { problemId: true },
      },
    },
  });
  if (!sources.length) throw new ClassroomError(404, '没有找到可以导入的课。');
  return withUniqueRetry(() =>
    prisma.$transaction(async (tx) => {
      const last = await tx.classSession.aggregate({
        where: { classId },
        _max: { number: true },
      });
      let number = (last._max.number ?? 0) + 1;
      const created: string[] = [];
      for (const source of sources) {
        const session = await tx.classSession.create({
          data: {
            classId,
            teacherId: viewer.userId,
            number: number++,
            name: source.name,
            status: 'draft',
            items: {
              create: source.items.map((item, index) => ({
                problemId: item.problemId,
                position: index + 1,
              })),
            },
          },
          select: { id: true },
        });
        created.push(session.id);
      }
      return created;
    }),
  );
}

async function loadSessionForTeacher(
  viewer: ClassroomViewer,
  sessionId: string,
  includeDeleted = false,
) {
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
  if (
    !session ||
    (!includeDeleted && session.status === 'deleted') ||
    (session.class.teacherId !== viewer.userId && !isAdmin(viewer))
  ) {
    throw new ClassroomError(404, '没有找到这节课。');
  }
  return session;
}

export type ClassSessionAction =
  | { action: 'rename'; name: string }
  | { action: 'add'; problemIds: string[] }
  | { action: 'remove'; problemId: string }
  | { action: 'reorder'; problemIds: string[] }
  | { action: 'lock'; locked: boolean }
  | { action: 'end' };

export async function applyClassSessionAction(
  viewer: ClassroomViewer,
  sessionId: string,
  input: ClassSessionAction,
) {
  const session = await loadSessionForTeacher(viewer, sessionId);
  if (input.action === 'rename') {
    const name = input.name.trim();
    if (!name || name.length > 80) throw new ClassroomError(400, '课堂名称需为 1–80 个字。');
    await prisma.classSession.update({ where: { id: sessionId }, data: { name } });
    return;
  }
  if (session.status === 'ended') throw new ClassroomError(409, '这节课已经下课了。');
  if ((input.action === 'lock' || input.action === 'end') && session.status !== 'live') {
    throw new ClassroomError(409, '这节课还没开始。');
  }
  switch (input.action) {
    case 'add': {
      const problems = await prisma.notebookProblem.findMany({
        where: {
          id: { in: input.problemIds },
          courseId: session.class.courseId,
          ownerId: null,
          status: 'published',
        },
        select: { id: true },
      });
      if (!problems.length) throw new ClassroomError(400, '只能加这门课里已发布的题。');
      const last = await prisma.classSessionItem.findFirst({
        where: { sessionId },
        orderBy: { position: 'desc' },
        select: { position: true },
      });
      const allowed = new Set(problems.map((problem) => problem.id));
      const start = (last?.position ?? 0) + 1;
      // 按老师点的顺序排在最后；已经在这节课里的题不动。
      await prisma.classSessionItem.createMany({
        data: input.problemIds
          .filter((id, index, ids) => allowed.has(id) && ids.indexOf(id) === index)
          .map((problemId, index) => ({ sessionId, problemId, position: start + index })),
        skipDuplicates: true,
      });
      return;
    }
    case 'remove':
      // 提交还留着这节课的标记，题加回来统计也回来。
      await prisma.classSessionItem.deleteMany({
        where: { sessionId, problemId: input.problemId },
      });
      return;
    case 'reorder':
      await prisma.$transaction(
        input.problemIds.map((problemId, index) =>
          prisma.classSessionItem.updateMany({
            where: { sessionId, problemId },
            data: { position: index + 1 },
          }),
        ),
      );
      return;
    case 'lock':
      await prisma.classSession.update({
        where: { id: sessionId },
        data: { locked: input.locked },
      });
      return;
    case 'end': {
      const ended = await prisma.classSession.updateMany({
        where: { id: sessionId, status: 'live' },
        data: { status: 'ended', endedAt: new Date(), code: null },
      });
      if (!ended.count) throw new ClassroomError(409, '这节课已经下课了。');
      return;
    }
  }
}

/** 删除还没开始的备课。 */
export async function deleteDraftSession(viewer: ClassroomViewer, sessionId: string) {
  const session = await loadSessionForTeacher(viewer, sessionId);
  const deleted = await prisma.classSession.deleteMany({
    where: { id: sessionId, status: 'draft' },
  });
  if (!deleted.count) throw new ClassroomError(409, '只能删除还没开始的课。');
  return session.classId;
}

/** 已下课的课堂从列表移除；保留题单、到课和作答归属，节次不复用。 */
export async function deleteEndedSession(viewer: ClassroomViewer, sessionId: string) {
  const session = await loadSessionForTeacher(viewer, sessionId, true);
  if (session.status === 'deleted') return session.classId;
  if (session.status !== 'ended') throw new ClassroomError(409, '只能删除已经下课的课。');
  const deleted = await prisma.classSession.updateMany({
    where: {
      id: sessionId,
      status: 'ended',
      ...(isAdmin(viewer) ? {} : { class: { teacherId: viewer.userId } }),
    },
    data: { status: 'deleted', code: null },
  });
  if (!deleted.count) {
    // 同时删除或重试已完成的请求时，返回相同班级；权限仍按当前关系检查。
    const current = await loadSessionForTeacher(viewer, sessionId, true);
    if (current.status !== 'deleted')
      throw new ClassroomError(409, '课堂状态已变化，请刷新后重试。');
  }
  return session.classId;
}

type AttemptSummary = {
  status: AttemptStatus;
  score: number | null;
  submittedAt: number;
  attempts: number;
  attemptId: string;
};

/** 这节课里每个人每道题最后一次提交（只看带这节课标记的，不算「运行」和学习快照）。 */
async function latestSessionAttempts(sessionId: string, userIds: string[], problemIds: string[]) {
  const latest = new Map<string, AttemptSummary>();
  if (!userIds.length || !problemIds.length) return latest;
  const attempts = await prisma.notebookProblemAttempt.findMany({
    where: {
      classSessionId: sessionId,
      problemId: { in: problemIds },
      userId: { in: userIds },
      kind: { in: ['submit', 'answer'] },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      problemId: true,
      userId: true,
      status: true,
      score: true,
      createdAt: true,
      resultJson: true,
    },
  });
  for (const attempt of attempts) {
    if (isLearningSnapshot(attempt.resultJson)) continue;
    const key = `${attempt.problemId}:${attempt.userId}`;
    latest.set(key, {
      status: attempt.status as AttemptStatus,
      score: attempt.score,
      submittedAt: attempt.createdAt.getTime(),
      attempts: (latest.get(key)?.attempts ?? 0) + 1,
      attemptId: attempt.id,
    });
  }
  return latest;
}

function isLearningSnapshot(value: unknown) {
  return ['solution_viewed', 'hidden_tests_viewed', 'answer_reset'].includes(
    String(jsonRecord(value).event),
  );
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

type ChoiceAttempt = {
  id: string;
  userId: string;
  answerJson: unknown;
};

function choiceDistribution(
  problem: { publicContentJson: unknown; gradingJson: unknown },
  attempts: ChoiceAttempt[],
  latestAttemptIds: Set<string>,
) {
  const options = jsonRecord(problem.publicContentJson).options;
  const correct = new Set(stringList(jsonRecord(problem.gradingJson).correctOptionIds));
  const latestCounts = new Map<string, number>();
  const wrongSelections = new Map<string, Set<string>>();
  for (const attempt of attempts) {
    for (const optionId of new Set(stringList(jsonRecord(attempt.answerJson).selectedOptionIds))) {
      if (latestAttemptIds.has(attempt.id)) {
        latestCounts.set(optionId, (latestCounts.get(optionId) ?? 0) + 1);
      }
      if (!correct.has(optionId)) {
        const students = wrongSelections.get(optionId) ?? new Set<string>();
        students.add(attempt.userId);
        wrongSelections.set(optionId, students);
      }
    }
  }
  return (Array.isArray(options) ? options : []).map((raw) => {
    const option = jsonRecord(raw);
    const id = String(option.id ?? '');
    return {
      id,
      label: String(option.label ?? id),
      count: latestCounts.get(id) ?? 0,
      correct: correct.has(id),
      wrongSelectionUserIds: [...(wrongSelections.get(id) ?? [])],
    };
  });
}

function personName(user: { name: string | null; email: string | null }) {
  return user.name?.trim() || user.email?.split('@')[0] || '未命名学生';
}

export async function getClassSessionDashboard(viewer: ClassroomViewer, sessionId: string) {
  const session = await loadSessionForTeacher(viewer, sessionId);
  const speedupCourse = await prisma.course.findFirst({
    where: {
      id: session.class.courseId,
      OR: [
        { organization: speedupOrganizationWhere() },
        { externalBinding: { provider: 'speedup' } },
      ],
    },
    select: { id: true },
  });
  const includePhoneLast4 = Boolean(speedupCourse);
  const userSelect = {
    id: true,
    name: true,
    email: true,
    image: true,
    speedupPhoneLast4: includePhoneLast4,
  } as const;
  const [participants, roster, items] = await Promise.all([
    prisma.classSessionParticipant.findMany({
      where: { sessionId },
      orderBy: { joinedAt: 'asc' },
      select: { via: true, joinedAt: true, user: { select: userSelect } },
    }),
    prisma.courseClassMember.findMany({
      where: { classId: session.classId },
      orderBy: { joinedAt: 'asc' },
      select: { user: { select: userSelect } },
    }),
    prisma.classSessionItem.findMany({
      where: { sessionId },
      orderBy: { position: 'asc' },
      select: {
        id: true,
        problemId: true,
        position: true,
        pushedAt: true,
        problem: {
          select: {
            title: true,
            type: true,
            problemNumber: true,
            publicContentJson: true,
            gradingJson: true,
          },
        },
      },
    }),
  ]);

  const studentIdentity = (user: {
    id: string;
    name: string | null;
    email: string | null;
    image: string | null;
    speedupPhoneLast4?: string | null;
  }) => ({
    userId: user.id,
    name: personName(user),
    avatarUrl: user.image,
    ...(includePhoneLast4 ? { phoneLast4: parsePhoneLast4(user.speedupPhoneLast4) } : {}),
  });

  // 一行一个学生：在场的人在前，没进来的名单学生在后。
  const present = new Set(participants.map((row) => row.user.id));
  const students = [
    ...participants.map((row) => ({
      ...studentIdentity(row.user),
      present: true,
      via: row.via,
      joinedAt: row.joinedAt.getTime(),
    })),
    ...roster
      .filter((row) => !present.has(row.user.id))
      .map((row) => ({
        ...studentIdentity(row.user),
        present: false,
        via: 'roster',
        joinedAt: null,
      })),
  ];
  const userIds = students.map((student) => student.userId);
  const problemIds = items.map((item) => item.problemId);
  const choiceProblemIds = new Set(
    items.filter((item) => item.problem.type === 'choice').map((item) => item.problemId),
  );
  // 只有选择题需要读历次答案；其他题的代码或图片可能很大。
  const [latest, solutionViews, choiceAnswers] = await Promise.all([
    latestSessionAttempts(sessionId, userIds, problemIds),
    userIds.length && problemIds.length
      ? prisma.notebookProblemAttempt.findMany({
          where: {
            classSessionId: sessionId,
            userId: { in: userIds },
            problemId: { in: problemIds },
            resultJson: { path: ['event'], equals: 'solution_viewed' },
          },
          distinct: ['problemId', 'userId'],
          select: { problemId: true, userId: true },
        })
      : [],
    userIds.length && choiceProblemIds.size
      ? prisma.notebookProblemAttempt.findMany({
          where: {
            classSessionId: sessionId,
            userId: { in: userIds },
            problemId: { in: [...choiceProblemIds] },
            kind: { in: ['submit', 'answer'] },
          },
          select: { id: true, problemId: true, userId: true, answerJson: true, resultJson: true },
        })
      : [],
  ]);
  const latestAttemptIds = new Set([...latest.values()].map((attempt) => attempt.attemptId));
  const choicesByProblem = new Map<string, ChoiceAttempt[]>();
  for (const attempt of choiceAnswers) {
    if (isLearningSnapshot(attempt.resultJson)) continue;
    const choices = choicesByProblem.get(attempt.problemId) ?? [];
    choices.push(attempt);
    choicesByProblem.set(attempt.problemId, choices);
  }

  return {
    session: {
      id: session.id,
      number: session.number,
      name: session.name,
      status: session.status,
      code: session.code,
      locked: session.locked,
      startedAt: session.startedAt?.getTime() ?? null,
      endedAt: session.endedAt?.getTime() ?? null,
      presentCount: participants.length,
      class: { id: session.class.id, name: session.class.name, rosterCount: roster.length },
      course: session.class.course,
    },
    students,
    items: items.map((item) => {
      const results = userIds.flatMap((userId) => {
        const row = latest.get(`${item.problemId}:${userId}`);
        return row
          ? [
              {
                userId,
                status: row.status,
                score: row.score,
                submittedAt: row.submittedAt,
                attempts: row.attempts,
              },
            ]
          : [];
      });
      const count = (...statuses: AttemptStatus[]) =>
        results.filter((row) => statuses.includes(row.status)).length;
      return {
        id: item.id,
        problemId: item.problemId,
        position: item.position,
        title: item.problem.title,
        type: item.problem.type,
        number: item.problem.problemNumber,
        addedAt: item.pushedAt.getTime(),
        solutionViewedUserIds: solutionViews
          .filter((view) => view.problemId === item.problemId)
          .map((view) => view.userId),
        submittedCount: results.length,
        passedCount: count('passed'),
        partialCount: count('partial', 'pending'),
        failedCount: count('failed', 'error'),
        options: choiceProblemIds.has(item.problemId)
          ? choiceDistribution(
              item.problem,
              choicesByProblem.get(item.problemId) ?? [],
              latestAttemptIds,
            )
          : null,
        results,
      };
    }),
  };
}

/** 按需预览本节课的公有题；沿用本班老师权限，不读取私有判题测试。 */
export async function getClassSessionProblemPreview(
  viewer: ClassroomViewer,
  sessionId: string,
  problemId: string,
) {
  const [problem] = await getClassSessionProblemPreviews(viewer, sessionId, problemId);
  if (!problem) throw new ClassroomError(404, '没有找到这节课里的题目。');
  return problem;
}

export async function getClassSessionProblemPreviews(
  viewer: ClassroomViewer,
  sessionId: string,
  problemId?: string,
) {
  const session = await loadSessionForTeacher(viewer, sessionId);
  const problems = await prisma.notebookProblem.findMany({
    where: {
      ...(problemId === undefined ? {} : { id: problemId }),
      courseId: session.class.courseId,
      ownerId: null,
      classSessionItems: { some: { sessionId } },
    },
    select: {
      id: true,
      courseId: true,
      notebookId: true,
      title: true,
      type: true,
      status: true,
      difficulty: true,
      tags: true,
      publicContentJson: true,
      gradingJson: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return problems.map((problem) => ({
    id: problem.id,
    courseId: problem.courseId,
    notebookId: problem.notebookId,
    title: problem.title,
    type: problem.type,
    status: problem.status,
    difficulty: problem.difficulty,
    tags: problem.tags,
    publicContent: jsonRecord(problem.publicContentJson),
    grading: jsonRecord(problem.gradingJson),
    createdAt: problem.createdAt.getTime(),
    updatedAt: problem.updatedAt.getTime(),
  }));
}

/** 点弹珠看到的内容：这个学生这道题在这节课里提交过的全部答案，最新的在前。 */
export async function getSessionStudentAnswers(
  viewer: ClassroomViewer,
  sessionId: string,
  problemId: string,
  userId: string,
) {
  const session = await loadSessionForTeacher(viewer, sessionId);
  const [item, participant, member] = await Promise.all([
    prisma.classSessionItem.findUnique({
      where: { sessionId_problemId: { sessionId, problemId } },
      select: { problem: { select: { points: true, publicContentJson: true } } },
    }),
    prisma.classSessionParticipant.findUnique({
      where: { sessionId_userId: { sessionId, userId } },
      select: { userId: true },
    }),
    prisma.courseClassMember.findUnique({
      where: { classId_userId: { classId: session.classId, userId } },
      select: { userId: true },
    }),
  ]);
  // 老师只看得到本班名单和进过这节课的人。
  if (!item || (!participant && !member)) throw new ClassroomError(404, '没有找到这份作答。');
  const attempts = await prisma.notebookProblemAttempt.findMany({
    where: { classSessionId: sessionId, problemId, userId, kind: { in: ['submit', 'answer'] } },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      kind: true,
      status: true,
      score: true,
      answerJson: true,
      resultJson: true,
      createdAt: true,
    },
  });
  const language = jsonRecord(item.problem.publicContentJson).language;
  return {
    language: typeof language === 'string' ? language : null,
    attempts: attempts.map((attempt) => {
      // 代码题按百分制存分，App 作答按题目分值存。
      const scale = attempt.kind === 'submit' ? 100 : item.problem.points || 100;
      return {
        id: attempt.id,
        kind: attempt.kind,
        status: attempt.status as AttemptStatus,
        score: attempt.score === null ? null : Math.min(1, Math.max(0, attempt.score / scale)),
        answer: jsonRecord(attempt.answerJson),
        result: jsonRecord(attempt.resultJson),
        createdAt: attempt.createdAt.getTime(),
      };
    }),
  };
}

/** 题库页用：这门课我正在上的那节。没有就是 null（学生也是 null）。 */
export async function getLiveSessionForCourse(viewer: ClassroomViewer, courseId: string) {
  const session = await prisma.classSession.findFirst({
    where: {
      status: 'live',
      class: { courseId, ...(isAdmin(viewer) ? {} : { teacherId: viewer.userId }) },
    },
    orderBy: { startedAt: 'desc' },
    select: {
      id: true,
      number: true,
      name: true,
      _count: { select: { participants: true } },
      items: { select: { problemId: true } },
    },
  });
  return session
    ? {
        sessionId: session.id,
        number: session.number,
        name: session.name,
        presentCount: session._count.participants,
        problemIds: session.items.map((item) => item.problemId),
      }
    : null;
}

/** 加题时挑题用：这门课已发布的公有题。 */
export async function listSessionProblemChoices(viewer: ClassroomViewer, sessionId: string) {
  const session = await loadSessionForTeacher(viewer, sessionId);
  const problems = await prisma.notebookProblem.findMany({
    where: { courseId: session.class.courseId, ownerId: null, status: 'published' },
    orderBy: [{ problemNumber: 'asc' }, { order: 'asc' }],
    select: {
      id: true,
      title: true,
      type: true,
      tags: true,
      difficulty: true,
      problemNumber: true,
      chapter: { select: { id: true, name: true } },
    },
  });
  return problems.map((problem) => ({
    id: problem.id,
    title: problem.title,
    type: problem.type,
    tags: problem.tags,
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

/** 学生端最多带这么多节上过的课：下课后还能从课堂入口回去接着交。 */
const STUDENT_PAST_SESSION_LIMIT = 12;

/**
 * 学生端看到的课堂：
 * - sessions：自己进了的、正在上的课，以及本班正在上但还没点进去的课；
 * - past：自己进过、已经下课的课。
 * 只返回自己的答题状态。
 */
export async function getStudentClassroomState(userId: string) {
  const select = {
    id: true,
    number: true,
    name: true,
    status: true,
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
      orderBy: { position: 'asc' as const },
      select: {
        id: true,
        problemId: true,
        position: true,
        pushedAt: true,
        problem: { select: { title: true, type: true, problemNumber: true } },
      },
    },
  };
  const [live, past] = await Promise.all([
    prisma.classSession.findMany({
      where: {
        status: 'live',
        OR: [{ participants: { some: { userId } } }, { class: { members: { some: { userId } } } }],
      },
      orderBy: { startedAt: 'desc' },
      take: 5,
      select,
    }),
    prisma.classSession.findMany({
      where: { status: 'ended', participants: { some: { userId } } },
      orderBy: { startedAt: 'desc' },
      take: STUDENT_PAST_SESSION_LIMIT,
      select,
    }),
  ]);
  const joinedIds = [...live, ...past]
    .filter((session) => session.participants.length)
    .map((session) => session.id);
  const attempts = joinedIds.length
    ? await prisma.notebookProblemAttempt.findMany({
        where: {
          classSessionId: { in: joinedIds },
          userId,
          kind: { in: ['submit', 'answer'] },
        },
        orderBy: { createdAt: 'asc' },
        select: { classSessionId: true, problemId: true, status: true, resultJson: true },
      })
    : [];
  const mine = new Map<string, { status: AttemptStatus; attempts: number }>();
  for (const attempt of attempts) {
    if (isLearningSnapshot(attempt.resultJson)) continue;
    const key = `${attempt.classSessionId}:${attempt.problemId}`;
    mine.set(key, {
      status: attempt.status as AttemptStatus,
      attempts: (mine.get(key)?.attempts ?? 0) + 1,
    });
  }
  const present = (session: (typeof live)[number]) => {
    const joined = session.participants.length > 0;
    return {
      id: session.id,
      number: session.number,
      name: session.name,
      status: session.status,
      joined,
      startedAt: session.startedAt?.getTime() ?? 0,
      endedAt: session.endedAt?.getTime() ?? null,
      className: session.class.name,
      courseId: session.class.courseId,
      courseName: session.class.course.courseCode?.trim() || session.class.course.name,
      teacherName: session.class.teacher.name?.trim() || '老师',
      // 没进课堂之前看不到题目
      items: joined
        ? session.items.map((item) => {
            const row = mine.get(`${session.id}:${item.problemId}`);
            return {
              id: item.id,
              problemId: item.problemId,
              title: item.problem.title,
              type: item.problem.type,
              number: item.problem.problemNumber,
              addedAt: item.pushedAt.getTime(),
              myStatus: row?.status ?? null,
              myAttempts: row?.attempts ?? 0,
            };
          })
        : [],
    };
  };
  return { sessions: live.map(present), past: past.map(present) };
}
