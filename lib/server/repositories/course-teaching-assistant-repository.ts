import { Prisma } from '@/lib/server/generated-prisma';
import type { DbClient } from '@/lib/server/repositories/types';

export const activeTeachingAssistantAccount = {
  role: 'TEACHING_ASSISTANT',
  isActive: true,
} as const;

export function activeCourseTeachingAssistant(userId: string) {
  return { userId, removedAt: null, user: activeTeachingAssistantAccount } as const;
}

export async function hasCourseTeachingAssistantAccess(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<boolean> {
  return Boolean(
    await db.courseTeachingAssistant.findFirst({
      where: { courseId, ...activeCourseTeachingAssistant(userId) },
      select: { courseId: true },
    }),
  );
}

export async function listCourseTeachingAssistants(db: DbClient, courseId: string) {
  const assignments = await db.courseTeachingAssistant.findMany({
    where: { courseId, removedAt: null },
    orderBy: { addedAt: 'desc' },
    select: {
      user: { select: { id: true, name: true, email: true, role: true, isActive: true } },
    },
  });
  return assignments.map(({ user }) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    active: user.isActive && user.role === activeTeachingAssistantAccount.role,
  }));
}

export function activeTeachingAssistantCoursesSql(userId: Prisma.Sql) {
  return Prisma.sql`
    SELECT assignment."courseId", assignment."addedAt" AS "joinedAt"
    FROM "CourseTeachingAssistant" AS assignment
    JOIN "User" AS assistant ON assistant."id" = assignment."userId"
    WHERE assignment."userId" = ${userId}
      AND assignment."removedAt" IS NULL
      AND assistant."role" = ${activeTeachingAssistantAccount.role}::"UserRole"
      AND assistant."isActive" = true
  `;
}

export function addCourseTeachingAssistant(
  db: DbClient,
  courseId: string,
  account: { email: string } | { userId: string },
) {
  const matchAccount =
    'email' in account
      ? Prisma.sql`"email" = ${account.email.toLowerCase()}`
      : Prisma.sql`"id" = ${account.userId}`;
  // Lock the account while granting access so a concurrent role removal clears this assignment too.
  return db.$executeRaw`
    INSERT INTO "CourseTeachingAssistant" AS assignment ("courseId", "userId")
    SELECT ${courseId}, "id"
    FROM "User"
    WHERE ${matchAccount}
      AND "role" = ${activeTeachingAssistantAccount.role}::"UserRole"
      AND "isActive" = true
    FOR SHARE
    ON CONFLICT ("courseId", "userId") DO UPDATE SET
      "removedAt" = NULL,
      "addedAt" = CASE WHEN assignment."removedAt" IS NULL
        THEN assignment."addedAt" ELSE EXCLUDED."addedAt" END
  `;
}

export function removeCourseTeachingAssistant(db: DbClient, userId: string, courseId: string) {
  return db.courseTeachingAssistant.updateMany({
    where: { userId, courseId, removedAt: null },
    data: { removedAt: new Date() },
  });
}
