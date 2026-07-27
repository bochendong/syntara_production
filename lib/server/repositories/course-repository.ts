import type { Prisma } from '@/lib/server/generated-prisma';
import type { DbClient, RootDbClient } from '@/lib/server/repositories/types';
import {
  listCourseEnrollmentsForUser,
  withCourseEnrollmentSchemaFallback,
} from '@/lib/server/repositories/course-enrollment-repository';

export type CreateOwnedCourseData = Omit<
  Prisma.CourseUncheckedCreateInput,
  'id' | 'ownerId' | 'createdAt' | 'updatedAt'
>;

export type UpdateOwnedCourseData = Omit<
  Prisma.CourseUncheckedUpdateManyInput,
  'id' | 'ownerId' | 'createdAt' | 'updatedAt'
>;

export function findOwnedCourse(db: DbClient, userId: string, courseId: string) {
  return db.course.findFirst({
    where: { id: courseId, ownerId: userId },
  });
}

export function listOwnedCourses(db: DbClient, userId: string) {
  return db.course.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: 'desc' },
  });
}

export function listOwnedCoursesWithCloneSourceOwner(db: DbClient, userId: string) {
  return db.course.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: 'desc' },
    include: {
      clonePurchase: {
        select: {
          sourceCourse: {
            select: {
              owner: { select: { name: true, email: true } },
            },
          },
        },
      },
    },
  });
}

export type AccessibleCourseRow = Omit<Prisma.CourseGetPayload<object>, 'ownerId'> & {
  accessRole: 'owner' | 'enrolled';
  joinedAt: Date | null;
  sourceOwnerName: string | null;
};

/** Fetch the homepage course list in one database round trip. */
export function listAccessibleCoursesForUser(
  db: DbClient,
  userId: string,
  userEmail?: string | null,
) {
  const normalizedEmail = userEmail?.trim().toLowerCase() || '';
  return withCourseEnrollmentSchemaFallback(
    db,
    () =>
      db.$queryRaw<AccessibleCourseRow[]>`
      WITH "ResolvedUser" AS (
        SELECT COALESCE(
          (
            SELECT "id"
            FROM "User"
            WHERE "email" = NULLIF(${normalizedEmail}, '')
            LIMIT 1
          ),
          ${userId}
        ) AS "id"
      ),
      "JoinedCourse" AS (
        SELECT "courseId", MAX("joinedAt") AS "joinedAt"
        FROM (
          SELECT "courseId", "joinedAt"
          FROM "CourseEnrollment"
          WHERE "userId" = (SELECT "id" FROM "ResolvedUser")

          UNION ALL

          SELECT "sourceCourseId" AS "courseId", "createdAt" AS "joinedAt"
          FROM "CoursePurchase"
          WHERE "buyerId" = (SELECT "id" FROM "ResolvedUser")
        ) AS "JoinedSource"
        GROUP BY "courseId"
      ),
      "AccessibleCourse" AS (
        SELECT
          "course"."id",
          "course"."name",
          "course"."description",
          "course"."language",
          "course"."tags",
          "course"."purpose"::text AS "purpose",
          "course"."university",
          "course"."courseCode",
          "course"."avatarUrl",
          "course"."listedInCourseStore",
          "course"."coursePriceCents",
          "course"."storePublishedAt",
          "course"."sourceCourseId",
          "course"."notebookCount",
          "course"."sceneCount",
          "course"."problemCount",
          "course"."publishedProblemCount",
          "course"."speechReadyCount",
          "course"."speechTotalCount",
          "course"."createdAt",
          "course"."updatedAt",
          'owner'::text AS "accessRole",
          NULL::timestamp AS "joinedAt",
          CASE
            WHEN "sourceOwner"."id" IS NULL THEN NULL
            ELSE COALESCE(
              NULLIF(BTRIM("sourceOwner"."name"), ''),
              NULLIF(SPLIT_PART("sourceOwner"."email", '@', 1), ''),
              '匿名创作者'
            )
          END AS "sourceOwnerName",
          0 AS "roleOrder",
          "course"."updatedAt" AS "sortAt"
        FROM "Course" AS "course"
        LEFT JOIN "CoursePurchase" AS "clonePurchase"
          ON "clonePurchase"."clonedCourseId" = "course"."id"
        LEFT JOIN "Course" AS "sourceCourse"
          ON "sourceCourse"."id" = "clonePurchase"."sourceCourseId"
        LEFT JOIN "User" AS "sourceOwner"
          ON "sourceOwner"."id" = "sourceCourse"."ownerId"
        WHERE "course"."ownerId" = (SELECT "id" FROM "ResolvedUser")

        UNION ALL

        SELECT
          "course"."id",
          "course"."name",
          "course"."description",
          "course"."language",
          "course"."tags",
          "course"."purpose"::text AS "purpose",
          "course"."university",
          "course"."courseCode",
          "course"."avatarUrl",
          "course"."listedInCourseStore",
          "course"."coursePriceCents",
          "course"."storePublishedAt",
          "course"."sourceCourseId",
          "course"."notebookCount",
          "course"."sceneCount",
          "course"."problemCount",
          "course"."publishedProblemCount",
          "course"."speechReadyCount",
          "course"."speechTotalCount",
          "course"."createdAt",
          "course"."updatedAt",
          'enrolled'::text AS "accessRole",
          "joined"."joinedAt",
          COALESCE(
            NULLIF(BTRIM("owner"."name"), ''),
            NULLIF(SPLIT_PART("owner"."email", '@', 1), ''),
            '匿名创作者'
          ) AS "sourceOwnerName",
          1 AS "roleOrder",
          "joined"."joinedAt" AS "sortAt"
        FROM "JoinedCourse" AS "joined"
        INNER JOIN "Course" AS "course" ON "course"."id" = "joined"."courseId"
        INNER JOIN "User" AS "owner" ON "owner"."id" = "course"."ownerId"
        WHERE "course"."ownerId" <> (SELECT "id" FROM "ResolvedUser")
      )
      SELECT
        "id",
        "name",
        "description",
        "language",
        "tags",
        "purpose",
        "university",
        "courseCode",
        "avatarUrl",
        "listedInCourseStore",
        "coursePriceCents",
        "storePublishedAt",
        "sourceCourseId",
        "notebookCount",
        "sceneCount",
        "problemCount",
        "publishedProblemCount",
        "speechReadyCount",
        "speechTotalCount",
        "createdAt",
        "updatedAt",
        "accessRole",
        "joinedAt",
        "sourceOwnerName"
      FROM "AccessibleCourse"
      ORDER BY "roleOrder" ASC, "sortAt" DESC
    `,
  );
}

export async function listJoinedCoursesWithOwner(db: DbClient, userId: string) {
  const [enrollments, legacyPurchases] = await Promise.all([
    listCourseEnrollmentsForUser(db, userId),
    db.coursePurchase.findMany({
      where: { buyerId: userId },
      select: { sourceCourseId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const enrollmentCourseIds = enrollments.map((enrollment) => enrollment.courseId);
  const courseIds = Array.from(
    new Set([
      ...enrollmentCourseIds,
      ...legacyPurchases.map((purchase) => purchase.sourceCourseId),
    ]),
  );
  if (courseIds.length === 0) return [];

  const joinedAtByCourseId = new Map<string, Date>();
  for (const enrollment of enrollments) {
    joinedAtByCourseId.set(enrollment.courseId, enrollment.joinedAt);
  }
  for (const purchase of legacyPurchases) {
    if (!joinedAtByCourseId.has(purchase.sourceCourseId)) {
      joinedAtByCourseId.set(purchase.sourceCourseId, purchase.createdAt);
    }
  }

  const courses = await db.course.findMany({
    where: {
      id: { in: courseIds },
      ownerId: { not: userId },
    },
    include: {
      owner: { select: { name: true, email: true } },
    },
  });

  return courses
    .map((course) => ({
      ...course,
      joinedAt: joinedAtByCourseId.get(course.id) ?? course.updatedAt,
    }))
    .sort((a, b) => b.joinedAt.getTime() - a.joinedAt.getTime());
}

export async function backfillOwnedCourseAvatars(
  db: RootDbClient,
  courses: Array<{ id: string; avatarUrl: string | null }>,
  pickAvatarUrl: (courseId: string) => string,
) {
  const missingAvatar = courses.filter((course) => !course.avatarUrl?.trim());
  if (missingAvatar.length === 0) return;

  await db.$transaction(
    missingAvatar.map((course) =>
      db.course.update({
        where: { id: course.id },
        data: { avatarUrl: pickAvatarUrl(course.id) },
      }),
    ),
  );
}

export function createOwnedCourse(db: DbClient, userId: string, data: CreateOwnedCourseData) {
  return db.course.create({
    data: {
      ownerId: userId,
      ...data,
    },
  });
}

export async function updateOwnedCourse(
  db: DbClient,
  userId: string,
  courseId: string,
  data: UpdateOwnedCourseData,
) {
  const result = await db.course.updateMany({
    where: { id: courseId, ownerId: userId },
    data,
  });
  if (result.count === 0) return null;
  return findOwnedCourse(db, userId, courseId);
}

export function countPurchasedNotebooksInOwnedCourse(
  db: DbClient,
  userId: string,
  courseId: string,
) {
  return db.notebook.count({
    where: {
      ownerId: userId,
      courseId,
      sourceNotebookId: { not: null },
    },
  });
}

export function syncOwnedCourseNotebookStoreState(
  db: DbClient,
  userId: string,
  courseId: string,
  listedInStore: boolean,
) {
  return db.notebook.updateMany({
    where: { courseId, ownerId: userId },
    data: {
      listedInNotebookStore: listedInStore,
      storePublishedAt: listedInStore ? new Date() : null,
    },
  });
}

export function deleteOwnedCourseWithNotebooks(db: RootDbClient, userId: string, courseId: string) {
  return db.$transaction([
    db.notebook.deleteMany({
      where: {
        ownerId: userId,
        courseId,
      },
    }),
    db.course.delete({ where: { id: courseId } }),
  ]);
}
