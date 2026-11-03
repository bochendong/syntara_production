import type { Prisma } from '@/lib/server/generated-prisma';
import type { DbClient } from '@/lib/server/repositories/types';

export function teacherCourseAccessWhere(userId: string): Prisma.CourseWhereInput {
  return {
    OR: [
      { ownerId: userId, externalBinding: null },
      { claimedTeacherId: userId, claimedTeacher: { isActive: true }, externalBinding: null },
      {
        managers: {
          some: { userId, user: { isActive: true, role: { in: ['TEACHER', 'ADMIN'] } } },
        },
      },
      {
        externalBinding: {
          memberships: {
            some: { userId, role: 'TEACHER', active: true },
          },
        },
      },
    ],
  };
}

export async function hasTeacherCourseAccess(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<boolean> {
  const course = await db.course.findFirst({
    where: { id: courseId, ...teacherCourseAccessWhere(userId) },
    select: { id: true },
  });
  return Boolean(course);
}
