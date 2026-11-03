import { z } from 'zod';
import { MARBLE_AVATAR_CATALOG } from '@/lib/constants/marble-avatars';
import type { DbClient } from '@/lib/server/repositories/types';
import { teacherCourseAccessWhere } from './external-course-access';
import { toPrismaJson } from './prisma-json';
import { currentAcademicPeriod } from './teacher-classroom-period';

export class CourseAdmissionError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const admissionFieldSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
  label: z.string().trim().min(1).max(80),
  kind: z.enum(['text', 'phone_last4']),
});
export const admissionConfigSchema = z
  .object({
    mode: z.enum(['open', 'approval']),
    fields: z.array(admissionFieldSchema).max(8),
  })
  .refine(
    (value) => new Set(value.fields.map((field) => field.id)).size === value.fields.length,
    '申请字段不能重复。',
  );
export const publicationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  campus: z.string().trim().min(1, '请填写校区。').max(120),
  organization: z.enum(['none', 'speedup']),
  admission: admissionConfigSchema,
});
export const courseProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  avatarId: z.string().trim().min(1).max(40).nullable(),
});
export type AdmissionConfig = z.infer<typeof admissionConfigSchema>;
export function courseAdmissionConfig(value: unknown): AdmissionConfig {
  const parsed = admissionConfigSchema.safeParse(value);
  return parsed.success ? parsed.data : { mode: 'open', fields: [] };
}

export async function requireCourseManagement(db: DbClient, userId: string, courseId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { role: true, isActive: true },
  });
  if (!user?.isActive) throw new CourseAdmissionError(403, '账号不可用。');
  const course = await db.course.findFirst({
    where: {
      id: courseId,
      ...(user.role === 'ADMIN'
        ? {}
        : {
            OR: [
              { ownerId: userId },
              teacherCourseAccessWhere(userId),
              { organization: { members: { some: { userId } } } },
            ],
          }),
    },
    include: {
      organization: { select: { id: true, slug: true, name: true } },
      externalBinding: { select: { id: true } },
    },
  });
  if (!course) throw new CourseAdmissionError(403, '你没有这门课的管理权限。');
  return course;
}

async function canEditPublication(
  db: DbClient,
  userId: string,
  course: { id: string; ownerId: string; listedInCourseStore: boolean; externalBinding: unknown },
) {
  if (course.externalBinding) return false;
  if (course.ownerId === userId) return true;
  if (!course.listedInCourseStore) return false;
  return Boolean(
    await db.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        OR: [
          { role: 'ADMIN' },
          { claimedCourses: { some: { id: course.id, externalBinding: null } } },
          { role: 'TEACHER', managedCourses: { some: { courseId: course.id } } },
        ],
      },
      select: { id: true },
    }),
  );
}

export async function canEditCourseProfile(
  db: DbClient,
  userId: string,
  course: { id: string; ownerId: string; externalBinding: unknown },
) {
  if (course.externalBinding) return false;
  if (course.ownerId === userId) return true;
  return Boolean(
    await db.user.findFirst({
      where: {
        id: userId,
        isActive: true,
        OR: [
          { role: 'ADMIN' },
          { claimedCourses: { some: { id: course.id, externalBinding: null } } },
          { role: 'TEACHER', managedCourses: { some: { courseId: course.id } } },
        ],
      },
      select: { id: true },
    }),
  );
}

export async function updateCourseProfile(
  db: DbClient,
  userId: string,
  courseId: string,
  input: z.infer<typeof courseProfileSchema>,
) {
  await lockAdmissionCourse(db, courseId);
  const course = await requireCourseManagement(db, userId, courseId);
  if (!(await canEditCourseProfile(db, userId, course)))
    throw new CourseAdmissionError(403, '没有修改课程资料的权限。');
  const parsed = courseProfileSchema.parse(input);
  const avatar = parsed.avatarId
    ? MARBLE_AVATAR_CATALOG.find((item) => item.id === parsed.avatarId)
    : null;
  if (parsed.avatarId && !avatar) throw new CourseAdmissionError(400, '请选择有效的课程头像。');
  await db.course.update({
    where: { id: courseId },
    data: { name: parsed.name, ...(avatar ? { avatarUrl: avatar.url } : {}) },
  });
  return getCoursePublication(db, userId, courseId);
}

export async function getCoursePublication(db: DbClient, userId: string, courseId: string) {
  const course = await requireCourseManagement(db, userId, courseId);
  const speedup = await db.organization.findFirst({
    where: { OR: [{ slug: 'speedup' }, { name: { equals: 'Speedup', mode: 'insensitive' } }] },
    select: { id: true },
  });
  const period = currentAcademicPeriod();
  const currentClass = await db.courseClass.findUnique({
    where: { courseId_academicYear_academicTerm: { courseId, ...period } },
    select: { id: true, teacherId: true, name: true },
  });
  return {
    courseId,
    name: course.name,
    avatarUrl: course.avatarUrl,
    campus: course.campus || '',
    organization: course.organizationId === speedup?.id ? ('speedup' as const) : ('none' as const),
    organizationName: course.organization?.name ?? null,
    speedupAvailable: Boolean(speedup),
    listed: course.listedInCourseStore,
    admission: courseAdmissionConfig(course.admissionConfig),
    canPublish: await canEditPublication(db, userId, course),
    canEditProfile: await canEditCourseProfile(db, userId, course),
    currentClass: currentClass
      ? { id: currentClass.id, mine: currentClass.teacherId === userId, name: currentClass.name }
      : null,
  };
}

/** All publication, request and review writers serialize on this course row. */
export async function lockAdmissionCourse(db: DbClient, courseId: string) {
  await db.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
}

export async function publishCourse(
  db: DbClient,
  userId: string,
  courseId: string,
  input: z.infer<typeof publicationSchema>,
) {
  await lockAdmissionCourse(db, courseId);
  const course = await requireCourseManagement(db, userId, courseId);
  if (!(await canEditPublication(db, userId, course)))
    throw new CourseAdmissionError(403, '没有修改课程发布设置的权限。');
  const parsed = publicationSchema.parse(input);
  const org =
    parsed.organization === 'speedup'
      ? await db.organization.findFirst({
          where: {
            OR: [{ slug: 'speedup' }, { name: { equals: 'Speedup', mode: 'insensitive' } }],
          },
          select: { id: true },
        })
      : null;
  if (parsed.organization === 'speedup' && !org)
    throw new CourseAdmissionError(400, 'Speedup 组织暂不可选。');
  await db.course.update({
    where: { id: courseId },
    data: {
      name: parsed.name,
      campus: parsed.campus,
      organizationId: org?.id ?? null,
      admissionConfig: toPrismaJson(parsed.admission),
      listedInCourseStore: true,
      storePublishedAt: course.storePublishedAt ?? new Date(),
      coursePriceCents: 0,
    },
  });
  // Publish the creator's published questions; other learners' private questions stay private.
  if (course.ownerId === userId) {
    await db.notebookProblem.updateMany({
      where: { courseId, ownerId: course.ownerId, status: 'published' },
      data: { ownerId: null },
    });
  }
  return getCoursePublication(db, userId, courseId);
}

export async function assertCourseAdmissionForEnrollment(
  db: DbClient,
  userId: string,
  courseId: string,
) {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { admissionConfig: true, ownerId: true },
  });
  if (
    !course ||
    course.ownerId === userId ||
    courseAdmissionConfig(course.admissionConfig).mode !== 'approval'
  )
    return;
  const [enrolled, purchase, approved, managed] = await Promise.all([
    db.courseEnrollment.findUnique({
      where: { userId_courseId: { userId, courseId } },
      select: { id: true },
    }),
    db.coursePurchase.findFirst({
      where: { buyerId: userId, sourceCourseId: courseId },
      select: { id: true },
    }),
    db.courseJoinApplication.findUnique({
      where: { courseId_userId: { courseId, userId } },
      select: { status: true },
    }),
    db.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(userId) },
      select: { id: true },
    }),
  ]);
  if (!enrolled && !purchase && approved?.status !== 'approved' && !managed)
    throw new CourseAdmissionError(403, '这门课需要老师审核，请先在商城提交加入申请。');
}

export async function requestCourseEntry(
  db: DbClient,
  userId: string,
  courseId: string,
  answers: Record<string, string> = {},
) {
  await lockAdmissionCourse(db, courseId);
  const course = await db.course.findUnique({ where: { id: courseId } });
  if (!course?.listedInCourseStore) throw new CourseAdmissionError(404, '课程不存在或已下架。');
  const user = await db.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user?.isActive) throw new CourseAdmissionError(403, '账号不可用。');
  const existing = await db.courseEnrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { id: true },
  });
  const application = await db.courseJoinApplication.findUnique({
    where: { courseId_userId: { courseId, userId } },
  });
  const managed = await db.course.findFirst({
    where: { id: courseId, ...teacherCourseAccessWhere(userId) },
    select: { id: true },
  });
  if (course.ownerId === userId || existing || managed)
    return { courseId, status: 'joined' as const, created: false };
  const config = courseAdmissionConfig(course.admissionConfig);
  if (config.mode === 'approval' && application?.status !== 'approved') {
    // 待审核时再提交（带上填写内容）就是「重新发送」：改这条申请，不另建一条。
    if (application?.status === 'pending' && !Object.keys(answers).length)
      return { courseId, status: 'pending' as const, created: false };
    const values = config.fields.map((field) => {
      const value = answers[field.id]?.trim() ?? '';
      if (!value || value.length > 500 || (field.kind === 'phone_last4' && !/^\d{4}$/.test(value)))
        throw new CourseAdmissionError(
          400,
          field.kind === 'phone_last4'
            ? `请填写「${field.label}」的 4 位数字。`
            : `请填写「${field.label}」（最多 500 字）。`,
        );
      return { ...field, value };
    });
    await db.courseJoinApplication.upsert({
      where: { courseId_userId: { courseId, userId } },
      create: { courseId, userId, answersJson: toPrismaJson(values) },
      update: {
        status: 'pending',
        answersJson: toPrismaJson(values),
        reviewedById: null,
        reviewedAt: null,
        createdAt: new Date(),
      },
    });
    return { courseId, status: 'pending' as const, created: true };
  }
  await db.courseEnrollment.upsert({
    where: { userId_courseId: { userId, courseId } },
    create: {
      userId,
      courseId,
      source: 'store',
      seenContentVersion: course.contentVersion,
      newSinceVersion: course.contentVersion,
    },
    update: {},
  });
  return { courseId, status: 'joined' as const, created: true };
}

export async function listCourseApplications(
  db: DbClient,
  userId: string,
  courseId: string,
  page = 1,
  query = '',
) {
  await requireCourseManagement(db, userId, courseId);
  const where = {
    courseId,
    status: 'pending',
    ...(query.trim()
      ? {
          applicant: {
            OR: [
              { name: { contains: query.trim(), mode: 'insensitive' as const } },
              { email: { contains: query.trim(), mode: 'insensitive' as const } },
            ],
          },
        }
      : {}),
  };
  const total = await db.courseJoinApplication.count({ where });
  const safePage = Math.min(
    Number.isSafeInteger(page) && page > 0 ? page : 1,
    Math.max(1, Math.ceil(total / 20)),
  );
  const applications = await db.courseJoinApplication.findMany({
    where,
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    skip: (safePage - 1) * 20,
    take: 20,
    select: {
      id: true,
      answersJson: true,
      createdAt: true,
      applicant: { select: { id: true, name: true, email: true, image: true } },
    },
  });
  return {
    applications: applications.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    })),
    total,
    page: safePage,
    pageSize: 20,
  };
}

export async function reviewCourseApplication(
  db: DbClient,
  userId: string,
  courseId: string,
  applicationId: string,
  decision: 'approved' | 'rejected',
) {
  await lockAdmissionCourse(db, courseId);
  const course = await requireCourseManagement(db, userId, courseId);
  const application = await db.courseJoinApplication.findFirst({
    where: { id: applicationId, courseId },
  });
  if (!application) throw new CourseAdmissionError(404, '申请不存在。');
  if (application.status !== 'pending') {
    if (application.status === decision) return { status: decision };
    throw new CourseAdmissionError(409, '这条申请已经处理，请刷新。');
  }
  if (!course.listedInCourseStore) throw new CourseAdmissionError(400, '课程已下架，暂不能审核。');
  const applicant = await db.user.findUnique({
    where: { id: application.userId },
    select: { isActive: true },
  });
  if (decision === 'approved' && !applicant?.isActive)
    throw new CourseAdmissionError(400, '申请账号已停用。');
  await db.courseJoinApplication.update({
    where: { id: application.id },
    data: { status: decision, reviewedById: userId, reviewedAt: new Date() },
  });
  if (decision === 'approved')
    await db.courseEnrollment.upsert({
      where: { userId_courseId: { userId: application.userId, courseId } },
      create: {
        userId: application.userId,
        courseId,
        source: 'approval',
        seenContentVersion: course.contentVersion,
        newSinceVersion: course.contentVersion,
      },
      update: {},
    });
  return { status: decision };
}

/**
 * 自己还没进的课的申请（待批准、未通过），App 侧边栏显示「待批准」，学生可以改了重发。
 * 已加入或已通过的不列。
 */
export async function listMyCourseApplications(db: DbClient, userId: string) {
  const rows = await db.courseJoinApplication.findMany({
    where: {
      userId,
      status: { in: ['pending', 'rejected'] },
      course: { listedInCourseStore: true, enrollments: { none: { userId } } },
    },
    select: {
      id: true,
      status: true,
      answersJson: true,
      updatedAt: true,
      course: {
        select: {
          id: true,
          name: true,
          courseCode: true,
          avatarUrl: true,
          admissionConfig: true,
          organization: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ updatedAt: 'desc' }],
    take: 50,
  });
  return {
    applications: rows.map((row) => ({
      id: row.id,
      status: row.status as 'pending' | 'rejected',
      updatedAt: row.updatedAt,
      answers: Array.isArray(row.answersJson)
        ? Object.fromEntries(
            (row.answersJson as Array<{ id?: string; value?: string }>)
              .filter((answer) => answer?.id && typeof answer.value === 'string')
              .map((answer) => [answer.id!, answer.value!]),
          )
        : {},
      course: {
        id: row.course.id,
        name: row.course.name,
        courseCode: row.course.courseCode,
        avatarUrl: row.course.avatarUrl,
        admission: courseAdmissionConfig(row.course.admissionConfig),
        organization: row.course.organization,
      },
    })),
  };
}
