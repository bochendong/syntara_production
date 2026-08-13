import crypto from 'node:crypto';
import { Prisma } from '@/lib/server/generated-prisma';
import { orderCourseNotebooks } from '@/lib/learning/course-notebook-order';
import type { DbClient } from '@/lib/server/repositories/types';

export type CourseAccessRole = 'owner' | 'enrolled';

export type CourseEnrollmentRow = {
  id: string;
  userId: string;
  courseId: string;
  priceCents: number;
  notebookAccessLimit: number | null;
  joinedAt: Date;
  createdAt: Date;
};

export type CourseNotebookAccess = {
  role: CourseAccessRole;
  notebookAccessLimit: number | null;
  orderedNotebookIds: string[];
  allowedNotebookIds: string[];
};

function persistedLearningOrder(value: unknown): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const learningOrder = (value as Record<string, unknown>).learningOrder;
  return typeof learningOrder === 'number' && Number.isInteger(learningOrder) && learningOrder >= 0
    ? learningOrder
    : undefined;
}

let ensureCourseEnrollmentTablePromise: Promise<void> | null = null;

function isCourseEnrollmentSchemaUnavailableError(error: unknown): boolean {
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
    code === 'P2022' ||
    databaseCode === '42P01' ||
    databaseCode === '42703' ||
    (/(CourseEnrollment|notebookAccessLimit)/i.test(message) &&
      /does not exist|not exist|missing|unknown column/i.test(message))
  );
}

export async function withCourseEnrollmentSchemaFallback<T>(
  db: DbClient,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (!isCourseEnrollmentSchemaUnavailableError(error)) throw error;
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
        "notebookAccessLimit" INTEGER,
        "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT "CourseEnrollment_userId_courseId_key" UNIQUE ("userId", "courseId")
      )
    `);
    await db.$executeRawUnsafe(
      'ALTER TABLE "CourseEnrollment" ADD COLUMN IF NOT EXISTS "notebookAccessLimit" INTEGER',
    );
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
      SELECT e."id", e."userId", e."courseId", e."priceCents", e."notebookAccessLimit", e."joinedAt", e."createdAt"
      FROM "CourseEnrollment" e
      LEFT JOIN "ExternalCourseBinding" b ON b."courseId" = e."courseId"
      WHERE e."userId" = ${userId} AND e."courseId" = ${courseId}
        AND (
          b."id" IS NULL
          OR EXISTS (
            SELECT 1
            FROM "ExternalCourseMembership" m
            WHERE m."bindingId" = b."id"
              AND m."userId" = ${userId}
              AND m."role" = 'STUDENT'::"ExternalCourseMemberRole"
              AND m."active" = true
          )
        )
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
          SELECT e."courseId"
          FROM "CourseEnrollment" e
          LEFT JOIN "ExternalCourseBinding" b ON b."courseId" = e."courseId"
          WHERE e."userId" = ${userId}
            AND e."courseId" IN (${Prisma.join(uniqueCourseIds)})
            AND (
              b."id" IS NULL
              OR EXISTS (
                SELECT 1 FROM "ExternalCourseMembership" m
                WHERE m."bindingId" = b."id"
                  AND m."userId" = ${userId}
                  AND m."role" = 'STUDENT'::"ExternalCourseMemberRole"
                  AND m."active" = true
              )
            )
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
    select: {
      ownerId: true,
      externalBinding: {
        select: {
          memberships: {
            where: { userId, active: true },
            select: { role: true },
          },
        },
      },
    },
  });
  if (!course) return null;
  if (course.externalBinding) {
    if (course.externalBinding.memberships.some((membership) => membership.role === 'TEACHER')) {
      return 'owner';
    }
    if (!course.externalBinding.memberships.some((membership) => membership.role === 'STUDENT')) {
      return null;
    }
  } else if (course.ownerId === userId) {
    return 'owner';
  }
  return (await hasCourseEnrollment(db, userId, courseId)) ? 'enrolled' : null;
}

export async function resolveCourseNotebookAccess(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<CourseNotebookAccess | null> {
  const accessRole = await findCourseAccessRole(db, userId, courseId);
  if (!accessRole) return null;

  const notebooks = orderCourseNotebooks(
    (
      await db.notebook.findMany({
        where: { courseId, removedAt: null },
        select: { id: true, name: true, createdAt: true, coverSlideJson: true },
      })
    ).map((notebook) => ({
      id: notebook.id,
      name: notebook.name,
      createdAt: notebook.createdAt.getTime(),
      learningOrder: persistedLearningOrder(notebook.coverSlideJson),
    })),
  );
  const orderedNotebookIds = notebooks.map((notebook) => notebook.id);
  if (accessRole === 'owner') {
    return {
      role: 'owner',
      notebookAccessLimit: null,
      orderedNotebookIds,
      allowedNotebookIds: orderedNotebookIds,
    };
  }

  const enrollment = await findCourseEnrollment(db, userId, courseId);
  if (!enrollment) {
    const legacyPurchase = await db.coursePurchase.findFirst({
      where: { buyerId: userId, sourceCourseId: courseId },
      select: { id: true },
    });
    if (!legacyPurchase) return null;
    return {
      role: 'enrolled',
      notebookAccessLimit: null,
      orderedNotebookIds,
      allowedNotebookIds: orderedNotebookIds,
    };
  }

  const notebookAccessLimit =
    enrollment.notebookAccessLimit === null
      ? null
      : Math.max(0, Math.floor(enrollment.notebookAccessLimit));
  return {
    role: 'enrolled',
    notebookAccessLimit,
    orderedNotebookIds,
    allowedNotebookIds:
      notebookAccessLimit === null
        ? orderedNotebookIds
        : orderedNotebookIds.slice(0, notebookAccessLimit),
  };
}

export async function canReadCourseNotebook(
  db: DbClient,
  userId: string,
  courseId: string,
  notebookId: string,
): Promise<boolean> {
  const access = await resolveCourseNotebookAccess(db, userId, courseId);
  return Boolean(access?.allowedNotebookIds.includes(notebookId));
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
    notebookAccessLimit?: number | null;
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
      "notebookAccessLimit",
      "joinedAt",
      "createdAt"
    )
    VALUES (
      ${id},
      ${args.userId},
      ${args.courseId},
      ${args.priceCents},
      ${args.notebookAccessLimit ?? null},
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT ("userId", "courseId") DO UPDATE SET
      "priceCents" = "CourseEnrollment"."priceCents"
    RETURNING "id", "userId", "courseId", "priceCents", "notebookAccessLimit", "joinedAt", "createdAt"
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
      SELECT e."id", e."userId", e."courseId", e."priceCents", e."notebookAccessLimit", e."joinedAt", e."createdAt"
      FROM "CourseEnrollment" e
      LEFT JOIN "ExternalCourseBinding" b ON b."courseId" = e."courseId"
      WHERE e."userId" = ${userId}
        AND (
          b."id" IS NULL
          OR EXISTS (
            SELECT 1 FROM "ExternalCourseMembership" m
            WHERE m."bindingId" = b."id"
              AND m."userId" = ${userId}
              AND m."role" = 'STUDENT'::"ExternalCourseMemberRole"
              AND m."active" = true
          )
        )
      ORDER BY e."joinedAt" DESC
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
