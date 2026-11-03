import type { Prisma } from '@/lib/server/generated-prisma';
import type { DbClient } from '@/lib/server/repositories/types';

/**
 * Speedup 机构要求学生留手机号。我们只问一次手机尾号（4 位），只记录，不比对。
 * 学生加入的课里只要有一门是 Speedup 的（课程挂在 Speedup 机构下），就弹一次窗；
 * 几门 Speedup 课也只弹一次，填过就不再弹。
 */

export function speedupOrganizationWhere(): Prisma.OrganizationWhereInput {
  return {
    OR: [
      { slug: { contains: 'speedup', mode: 'insensitive' } },
      { name: { equals: 'Speedup', mode: 'insensitive' } },
    ],
  };
}

export type SpeedupPhoneState = { needed: boolean; courses: string[] };

export async function getSpeedupPhoneState(
  db: DbClient,
  userId: string,
): Promise<SpeedupPhoneState> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { speedupPhoneLast4: true },
  });
  if (!user || user.speedupPhoneLast4) return { needed: false, courses: [] };
  const enrollments = await db.courseEnrollment.findMany({
    where: { userId, course: { organization: speedupOrganizationWhere() } },
    orderBy: { joinedAt: 'asc' },
    take: 8,
    select: { course: { select: { name: true, courseCode: true } } },
  });
  return {
    needed: enrollments.length > 0,
    courses: enrollments.map(({ course }) => course.courseCode || course.name),
  };
}

export function parsePhoneLast4(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}$/.test(value.trim()) ? value.trim() : null;
}

export async function saveSpeedupPhoneLast4(
  db: DbClient,
  userId: string,
  last4: string,
): Promise<SpeedupPhoneState> {
  await db.user.update({
    where: { id: userId },
    data: { speedupPhoneLast4: last4, speedupPhoneSavedAt: new Date() },
  });
  return { needed: false, courses: [] };
}
