import type { Prisma } from '@/lib/server/generated-prisma';
import type { DbClient } from '@/lib/server/repositories/types';
import {
  AdminConsoleError,
  resolveAdminConsoleViewer,
  type AdminConsoleViewer,
} from './admin-console';
import { pickStableCourseAvatarUrl } from '@/lib/constants/course-avatars';

const PERSON_SELECT = {
  id: true,
  name: true,
  email: true,
  image: true,
  role: true,
  isActive: true,
} as const;
const COURSE_SELECT = {
  id: true,
  name: true,
  courseCode: true,
  avatarUrl: true,
  organization: { select: { name: true } },
  owner: { select: PERSON_SELECT },
  managers: {
    orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
    select: { user: { select: PERSON_SELECT } },
  },
} satisfies Prisma.CourseSelect;

function courseView(course: Prisma.CourseGetPayload<{ select: typeof COURSE_SELECT }>) {
  // 系统归属账号用于保存课程，不代表已有实际负责人。
  const people = [
    ...(course.owner.id.startsWith('system:') ? [] : [course.owner]),
    ...course.managers.map((manager) => manager.user),
  ];
  return {
    id: course.id,
    name: course.name,
    courseCode: course.courseCode,
    avatarUrl: course.avatarUrl || pickStableCourseAvatarUrl(course.id),
    organizationName: course.organization?.name ?? null,
    owner: course.owner,
    managers: course.managers.map((manager) => manager.user),
    responsiblePeople: [...new Map(people.map((person) => [person.id, person])).values()],
  };
}

export async function listAdminManagedCourses(db: DbClient, query: string, requestedPage: number) {
  const search = query.trim();
  const where: Prisma.CourseWhereInput = {
    NOT: { id: { startsWith: 'native-staging-' } },
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { courseCode: { contains: search, mode: 'insensitive' } },
            { id: search },
          ],
        }
      : {}),
  };
  const total = await db.course.count({ where });
  const pageSize = 20;
  const page = Math.min(
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    Math.max(1, Math.ceil(total / pageSize)),
  );
  const courses = await db.course.findMany({
    where,
    select: COURSE_SELECT,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { courses: courses.map(courseView), total, page, pageSize };
}

export function searchAdminCourseAssignees(db: DbClient, query: string) {
  const search = query.trim();
  return db.user.findMany({
    where: {
      isActive: true,
      role: { in: ['TEACHER', 'ADMIN'] },
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
              { id: search },
            ],
          }
        : {}),
    },
    select: PERSON_SELECT,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    take: 20,
  });
}

async function requireCourse(db: DbClient, courseId: string) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { ownerId: true },
  });
  if (!course) throw new AdminConsoleError(404, '找不到这门课程。');
  return course;
}

export async function listAdminCourseStudents(
  db: DbClient,
  courseId: string,
  query: string,
  requestedPage: number,
) {
  const course = await requireCourse(db, courseId);
  const search = query.trim();
  const where: Prisma.UserWhereInput = {
    id: { not: course.ownerId },
    managedCourses: { none: { courseId } },
    externalCourseMemberships: {
      none: { binding: { courseId }, role: 'TEACHER', active: true },
    },
    AND: [
      {
        OR: [
          { courseEnrollments: { some: { courseId } } },
          { coursePurchases: { some: { sourceCourseId: courseId } } },
          { classMemberships: { some: { class: { courseId } } } },
          {
            externalCourseMemberships: {
              some: { binding: { courseId }, role: 'STUDENT', active: true },
            },
          },
        ],
      },
      ...(search
        ? [
            {
              OR: [
                { name: { contains: search, mode: 'insensitive' as const } },
                { email: { contains: search, mode: 'insensitive' as const } },
              ],
            },
          ]
        : []),
    ],
  };
  const total = await db.user.count({ where });
  const pageSize = 20;
  const page = Math.min(
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1,
    Math.max(1, Math.ceil(total / pageSize)),
  );
  const students = await db.user.findMany({
    where,
    select: PERSON_SELECT,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return { students, total, page, pageSize };
}

/** 撤销课程成员关系，保留账号、作答、私人资料和其他课程。调用方必须使用事务。 */
export async function removeAdminCourseStudent(
  db: DbClient,
  viewer: AdminConsoleViewer,
  input: { courseId: string; userId: string },
) {
  if (!(await resolveAdminConsoleViewer(db, viewer.userId))) {
    throw new AdminConsoleError(403, '只有管理员可以移除学生。');
  }
  const course = await requireCourse(db, input.courseId);
  await db.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
  const membership = { courseId: input.courseId, userId: input.userId };
  const manager = await db.courseManager.findUnique({
    where: { courseId_userId: membership },
  });
  const teacher = await db.externalCourseMembership.findFirst({
    where: {
      userId: input.userId,
      binding: { courseId: input.courseId },
      role: 'TEACHER',
      active: true,
    },
    select: { id: true },
  });
  if (course.ownerId === input.userId || manager || teacher) {
    throw new AdminConsoleError(400, '课程负责人不能作为学生移除，请使用分配管理者。');
  }
  const enrollments = await db.courseEnrollment.deleteMany({ where: membership });
  const purchases = await db.coursePurchase.deleteMany({
    where: { buyerId: input.userId, sourceCourseId: input.courseId },
  });
  const classes = await db.courseClassMember.deleteMany({
    where: { userId: input.userId, class: { courseId: input.courseId } },
  });
  const external = await db.externalCourseMembership.updateMany({
    where: {
      userId: input.userId,
      binding: { courseId: input.courseId },
      role: 'STUDENT',
      active: true,
    },
    data: { active: false, revokedAt: new Date() },
  });
  await db.courseJoinApplication.updateMany({
    where: { courseId: input.courseId, userId: input.userId, status: 'approved' },
    data: { status: 'rejected', reviewedById: viewer.userId, reviewedAt: new Date() },
  });
  return { removed: enrollments.count + purchases.count + classes.count + external.count > 0 };
}

/** 调用方用事务包住；服务端重查身份，分配只影响这一门课。 */
export async function setAdminCourseManager(
  db: DbClient,
  viewer: AdminConsoleViewer,
  input: { courseId: string; userId: string; assigned: boolean },
) {
  if (!(await resolveAdminConsoleViewer(db, viewer.userId))) {
    throw new AdminConsoleError(403, '只有管理员可以分配课程。');
  }
  const course = await db.course.findUnique({
    where: { id: input.courseId },
    select: { ownerId: true },
  });
  if (!course) throw new AdminConsoleError(404, '找不到这门课程。');
  if (course.ownerId === input.userId) {
    throw new AdminConsoleError(400, '该账号已是课程原负责人，无需分配。');
  }
  // 和账号身份修改串行，避免在分配时把权限授予已停用或已改为学生的账号。
  await db.$queryRaw`SELECT id FROM "User" WHERE id = ${input.userId} FOR UPDATE`;
  const user = await db.user.findUnique({ where: { id: input.userId }, select: PERSON_SELECT });
  if (!user) throw new AdminConsoleError(404, '找不到这个账号。');
  if (input.assigned) {
    if (!user.isActive || (user.role !== 'TEACHER' && user.role !== 'ADMIN')) {
      throw new AdminConsoleError(400, '只能分配给启用中的老师或管理员。');
    }
    await db.courseManager.upsert({
      where: { courseId_userId: { courseId: input.courseId, userId: input.userId } },
      create: { courseId: input.courseId, userId: input.userId, assignedById: viewer.userId },
      update: {},
    });
  } else {
    await db.courseManager.deleteMany({
      where: { courseId: input.courseId, userId: input.userId },
    });
  }
  const updated = await db.course.findUniqueOrThrow({
    where: { id: input.courseId },
    select: COURSE_SELECT,
  });
  return courseView(updated);
}
