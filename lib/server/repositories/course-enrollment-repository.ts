import crypto from 'node:crypto';
import { Prisma } from '@/lib/server/generated-prisma';
import type { DbClient } from '@/lib/server/repositories/types';

export type CourseAccessRole = 'owner' | 'enrolled';

export type CourseEnrollmentRow = {
  id: string;
  userId: string;
  courseId: string;
  priceCents: number;
  joinedAt: Date;
  createdAt: Date;
};

let ensureCourseEnrollmentTablePromise: Promise<void> | null = null;

function isMissingCourseEnrollmentTableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  const code = typeof record.code === 'string' ? record.code : '';
  const databaseCode = typeof record.meta?.code === 'string' ? record.meta.code : '';
  const message = [record.message, record.meta?.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  return (
    code === 'P2021' ||
    databaseCode === '42P01' ||
    (/CourseEnrollment/i.test(message) && /does not exist|not exist|missing/i.test(message))
  );
}

export async function withCourseEnrollmentSchemaFallback<T>(
  db: DbClient,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isMissingCourseEnrollmentTableError(error)) throw error;
    await ensureCourseEnrollmentTable(db);
    return read();
  }
}

export async function ensureCourseEnrollmentTable(db: DbClient): Promise<void> {
  ensureCourseEnrollmentTablePromise ??= (async () => {
    await db.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CourseEnrollment" (
        "id" TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
        "courseId" TEXT NOT NULL REFERENCES "Course"("id") ON DELETE CASCADE,
        "priceCents" INTEGER NOT NULL DEFAULT 0,
        "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CourseEnrollment_userId_courseId_key" UNIQUE ("userId", "courseId")
      )
    `);
    await db.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "CourseEnrollment_userId_joinedAt_idx" ON "CourseEnrollment"("userId", "joinedAt" DESC)',
    );
    await db.$executeRawUnsafe(
      'CREATE INDEX IF NOT EXISTS "CourseEnrollment_courseId_joinedAt_idx" ON "CourseEnrollment"("courseId", "joinedAt" DESC)',
    );
  })();
  try {
    await ensureCourseEnrollmentTablePromise;
  } catch (error) {
    ensureCourseEnrollmentTablePromise = null;
    throw error;
  }
}

export async function findCourseEnrollment(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<CourseEnrollmentRow | null> {
  const rows = await withCourseEnrollmentSchemaFallback(
    db,
    () =>
      db.$queryRaw<CourseEnrollmentRow[]>`
      SELECT "id", "userId", "courseId", "priceCents", "joinedAt", "createdAt"
      FROM "CourseEnrollment"
      WHERE "userId" = ${userId} AND "courseId" = ${courseId}
      LIMIT 1
    `,
  );
  return rows[0] ?? null;
}

export async function hasCourseEnrollment(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<boolean> {
  const enrollment = await findCourseEnrollment(db, userId, courseId);
  if (enrollment) return true;

  const legacyPurchase = await db.coursePurchase.findFirst({
    where: { buyerId: userId, sourceCourseId: courseId },
    select: { id: true },
  });
  return Boolean(legacyPurchase);
}

export async function listEnrolledCourseIds(
  db: DbClient,
  userId: string,
  courseIds: string[],
): Promise<Set<string>> {
  const uniqueCourseIds = Array.from(new Set(courseIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueCourseIds.length === 0) return new Set();

  const [enrollmentRows, legacyPurchases] = await Promise.all([
    withCourseEnrollmentSchemaFallback(db, () =>
      db.$queryRaw<Array<{ courseId: string }>>(
        Prisma.sql`
          SELECT "courseId"
          FROM "CourseEnrollment"
          WHERE "userId" = ${userId}
            AND "courseId" IN (${Prisma.join(uniqueCourseIds)})
        `,
      ),
    ),
    db.coursePurchase.findMany({
      where: {
        buyerId: userId,
        sourceCourseId: { in: uniqueCourseIds },
      },
      select: { sourceCourseId: true },
    }),
  ]);

  return new Set([
    ...enrollmentRows.map((row) => row.courseId),
    ...legacyPurchases
      .map((row) => row.sourceCourseId)
      .filter((courseId): courseId is string => Boolean(courseId)),
  ]);
}

export async function findCourseAccessRole(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<CourseAccessRole | null> {
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { ownerId: true },
  });
  if (!course) return null;
  if (course.ownerId === userId) return 'owner';
  return (await hasCourseEnrollment(db, userId, courseId)) ? 'enrolled' : null;
}

export async function requireCourseReadAccess(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<CourseAccessRole> {
  const role = await findCourseAccessRole(db, userId, courseId);
  if (!role) throw new Error('Course not found');
  return role;
}

export async function createCourseEnrollment(
  db: DbClient,
  args: {
    userId: string;
    courseId: string;
    priceCents: number;
  },
): Promise<CourseEnrollmentRow> {
  await ensureCourseEnrollmentTable(db);
  const id = crypto.randomUUID();
  const rows = await db.$queryRaw<CourseEnrollmentRow[]>`
    INSERT INTO "CourseEnrollment" (
      "id",
      "userId",
      "courseId",
      "priceCents",
      "joinedAt",
      "createdAt"
    )
    VALUES (
      ${id},
      ${args.userId},
      ${args.courseId},
      ${args.priceCents},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("userId", "courseId") DO UPDATE SET
      "priceCents" = "CourseEnrollment"."priceCents"
    RETURNING "id", "userId", "courseId", "priceCents", "joinedAt", "createdAt"
  `;
  return rows[0];
}

export async function listCourseEnrollmentsForUser(
  db: DbClient,
  userId: string,
): Promise<CourseEnrollmentRow[]> {
  return withCourseEnrollmentSchemaFallback(
    db,
    () =>
      db.$queryRaw<CourseEnrollmentRow[]>`
      SELECT "id", "userId", "courseId", "priceCents", "joinedAt", "createdAt"
      FROM "CourseEnrollment"
      WHERE "userId" = ${userId}
      ORDER BY "joinedAt" DESC
    `,
  );
}

export async function removeCourseEnrollmentForUser(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<number> {
  await ensureCourseEnrollmentTable(db);
  const result = await db.$executeRaw`
    DELETE FROM "CourseEnrollment"
    WHERE "userId" = ${userId} AND "courseId" = ${courseId}
  `;
  return result;
}
