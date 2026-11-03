import type { Prisma } from '@/lib/server/generated-prisma';
import { PLATFORM_TUTORIAL_COURSE_ID } from '@/lib/onboarding/spotlight';
import type { DbClient } from '@/lib/server/repositories/types';
import { prisma } from '@/lib/server/prisma';
import { ClassroomError, type ClassroomViewer } from '@/lib/server/teacher-classroom';

/**
 * 老师认领课程。
 * - 只有机构课（商城里那些）可以认领，Syntara 官方教程除外。
 * - 一门课只能有一位老师，先到先得，不用审批；认领的老师自己可以退出认领。
 * - 认领后这门课出现在「教学」里，可以开班、上课。
 */

const PLATFORM_ORGANIZATION_ID = 'syntara-official';
const CLAIM_LIST_LIMIT = 60;

export function claimableCourseWhere(): Prisma.CourseWhereInput {
  return {
    organizationId: { not: null },
    listedInCourseStore: true,
    externalBinding: null,
    NOT: [{ id: PLATFORM_TUTORIAL_COURSE_ID }, { organizationId: PLATFORM_ORGANIZATION_ID }],
  };
}

export type ClaimableCourse = {
  id: string;
  name: string;
  courseCode: string | null;
  avatarUrl: string | null;
  organizationName: string | null;
  problemCount: number;
  /** mine = 我认领的；free = 还没人认领；taken = 已被其他老师认领 */
  claim: 'mine' | 'free' | 'taken';
};

function searchWhere(query: string): Prisma.CourseWhereInput {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  if (!terms.length) return {};
  return {
    AND: terms.map((term) => ({
      OR: [
        { name: { contains: term, mode: 'insensitive' as const } },
        { courseCode: { contains: term, mode: 'insensitive' as const } },
        { organization: { name: { contains: term, mode: 'insensitive' as const } } },
      ],
    })),
  };
}

export async function listClaimableCourses(
  viewer: ClassroomViewer,
  query = '',
): Promise<{ courses: ClaimableCourse[] }> {
  await assertActiveClaimant(prisma, viewer.userId);
  const rows = await prisma.course.findMany({
    where: { AND: [claimableCourseWhere(), searchWhere(query)] },
    // 我认领的在前，其次是还没人认领的。
    orderBy: [{ claimedAt: { sort: 'desc', nulls: 'last' } }, { name: 'asc' }],
    take: 300,
    select: {
      id: true,
      name: true,
      courseCode: true,
      avatarUrl: true,
      publishedProblemCount: true,
      claimedTeacherId: true,
      claimedTeacher: { select: { isActive: true } },
      managers: { where: { user: { role: 'TEACHER', isActive: true } }, select: { userId: true } },
      organization: { select: { name: true } },
    },
  });
  const rank = { mine: 0, free: 1, taken: 2 } as const;
  const courses = rows
    .map(
      (row): ClaimableCourse => ({
        id: row.id,
        name: row.name,
        courseCode: row.courseCode,
        avatarUrl: row.avatarUrl,
        organizationName: row.organization?.name ?? null,
        problemCount: row.publishedProblemCount,
        claim:
          row.claimedTeacherId === viewer.userId
            ? 'mine'
            : (row.claimedTeacherId && row.claimedTeacher?.isActive) ||
                row.managers.some((manager) => manager.userId !== viewer.userId)
              ? 'taken'
              : 'free',
      }),
    )
    .sort((a, b) => rank[a.claim] - rank[b.claim])
    .slice(0, CLAIM_LIST_LIMIT);
  return { courses };
}

async function assertActiveClaimant(db: DbClient, userId: string) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user?.isActive) throw new ClassroomError(403, '账号不可用。');
}

export async function claimCourse(viewer: ClassroomViewer, courseId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // Same lock order as administrative assignment: course first, then account.
    await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${viewer.userId} FOR UPDATE`;
    await assertActiveClaimant(tx, viewer.userId);
    const course = await tx.course.findFirst({
      where: { AND: [{ id: courseId }, claimableCourseWhere()] },
      select: {
        claimedTeacherId: true,
        claimedTeacher: { select: { isActive: true } },
        managers: {
          where: { user: { role: 'TEACHER', isActive: true }, userId: { not: viewer.userId } },
          select: { userId: true },
        },
      },
    });
    if (!course) throw new ClassroomError(404, '没有找到这门可认领的课程。');
    if (
      course.managers.length ||
      (course.claimedTeacherId &&
        course.claimedTeacherId !== viewer.userId &&
        course.claimedTeacher?.isActive)
    )
      throw new ClassroomError(409, '这门课已经有负责老师。');
    if (course.claimedTeacherId === viewer.userId) return;
    await tx.course.update({
      where: { id: courseId },
      data: { claimedTeacherId: viewer.userId, claimedAt: new Date() },
    });
  });
}

export async function releaseCourseClaim(viewer: ClassroomViewer, courseId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Course" WHERE id = ${courseId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${viewer.userId} FOR UPDATE`;
    await assertActiveClaimant(tx, viewer.userId);
    const released = await tx.course.updateMany({
      where: { id: courseId, claimedTeacherId: viewer.userId },
      data: { claimedTeacherId: null, claimedAt: null },
    });
    if (!released.count) throw new ClassroomError(404, '你没有认领这门课。');
  });
}
