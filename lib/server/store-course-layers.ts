import { Prisma } from '@/lib/server/generated-prisma';
import {
  formatCourseUpdateSummary,
  type CourseUpdateSummary,
} from '@/lib/course-space/course-update-summary';
import {
  findCourseAccessRole,
  resolveCourseNotebookAccess,
} from '@/lib/server/repositories/course-enrollment-repository';
import { refreshCourseSummaryFields } from '@/lib/server/repositories/notebook-repository';
import type { DbClient, RootDbClient } from '@/lib/server/repositories/types';
import { copyCourseContentsTx } from '@/lib/server/teacher-course-content-copy';

/**
 * 加入的课程分两层：
 * - 公有层：发布者（课程主人）的笔记和题目，所有人共用一份。题目 ownerId = null，笔记 ownerId = 课程主人。
 * - 私有层：学员自己加的笔记和题目，只有自己看得到。题目 / 笔记的 ownerId = 学员。
 * 学员可隐藏公有笔记（CourseContentHide）；公有题目只读。自己的内容才可删除。
 */

export type CourseContentTarget = 'notebook' | 'problem';

/** 题目可见：公有的或自己的；公有题不支持隐藏。alias 是 SQL 里 NotebookProblem 的别名。 */
export function problemLayerSql(userId: string, alias = 'p'): Prisma.Sql {
  const p = Prisma.raw(`"${alias}"`);
  return Prisma.sql`(${p}."ownerId" IS NULL OR ${p}."ownerId" = ${userId})`;
}

export async function hiddenCourseContentIds(
  db: DbClient,
  userId: string,
  courseId: string,
  targetType: CourseContentTarget,
): Promise<string[]> {
  const rows = await db.courseContentHide.findMany({
    where: { userId, courseId, targetType },
    select: { targetId: true },
  });
  return rows.map((row) => row.targetId);
}

/** Prisma 版的 problemLayerSql。 */
export async function problemLayerWhere(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<Prisma.NotebookProblemWhereInput> {
  // Public questions are read-only; historical hide records must not keep them invisible.
  void db;
  void courseId;
  return { OR: [{ ownerId: null }, { ownerId: userId }] };
}

export class PublicProblemReadOnlyError extends Error {
  constructor() {
    super('发布者的题目不能删除、隐藏或复制。');
  }
}

export class CourseContentNotFoundError extends Error {
  constructor() {
    super('内容不存在或没有权限。');
  }
}

/**
 * 「删除」一项课程内容。
 * - 自己的（私有层，或发布者删自己的公有内容）：真删。笔记是软删（removedAt），挂在上面的学习记忆保留。
 * - 学员删公有笔记：只对自己隐藏；公有题目拒绝删除。
 */
export async function removeCourseContentForUser(
  db: RootDbClient,
  args: { userId: string; courseId: string; targetType: CourseContentTarget; targetId: string },
): Promise<'hidden' | 'deleted'> {
  const role = await findCourseAccessRole(db, args.userId, args.courseId);
  if (!role) throw new CourseContentNotFoundError();

  if (args.targetType === 'notebook') {
    const course = await db.course.findUnique({
      where: { id: args.courseId },
      select: { ownerId: true },
    });
    if (!course) throw new CourseContentNotFoundError();
    const notebook = await db.notebook.findFirst({
      where: { id: args.targetId, courseId: args.courseId, removedAt: null },
      select: { id: true, ownerId: true },
    });
    if (!notebook) throw new CourseContentNotFoundError();
    if (
      notebook.ownerId === args.userId ||
      (role === 'owner' && notebook.ownerId === course.ownerId)
    ) {
      await db.notebook.update({ where: { id: notebook.id }, data: { removedAt: new Date() } });
      await refreshCourseSummaryFields(db, args.courseId);
      return 'deleted';
    }
    if (role !== 'enrolled' || notebook.ownerId !== course.ownerId)
      throw new CourseContentNotFoundError();
    await requireVisibleNotebook(db, args.userId, args.courseId, notebook.id);
    await hide(db, args);
    return 'hidden';
  }

  const problem = await db.notebookProblem.findFirst({
    where: { id: args.targetId, courseId: args.courseId },
    select: { id: true, ownerId: true, notebookId: true },
  });
  if (!problem) throw new CourseContentNotFoundError();
  if (problem.ownerId === args.userId || (problem.ownerId === null && role === 'owner')) {
    await db.notebookProblem.delete({ where: { id: problem.id } });
    await refreshCourseSummaryFields(db, args.courseId);
    return 'deleted';
  }
  if (problem.ownerId === null && role === 'enrolled') throw new PublicProblemReadOnlyError();
  throw new CourseContentNotFoundError();
}

async function hide(
  db: DbClient,
  args: { userId: string; courseId: string; targetType: CourseContentTarget; targetId: string },
) {
  await db.courseContentHide.upsert({
    where: {
      userId_targetType_targetId: {
        userId: args.userId,
        targetType: args.targetType,
        targetId: args.targetId,
      },
    },
    create: {
      userId: args.userId,
      courseId: args.courseId,
      targetType: args.targetType,
      targetId: args.targetId,
    },
    update: {},
  });
}

async function requireVisibleNotebook(
  db: DbClient,
  userId: string,
  courseId: string,
  notebookId: string,
) {
  const access = await resolveCourseNotebookAccess(db, userId, courseId);
  if (!access?.allowedNotebookIds.includes(notebookId)) throw new CourseContentNotFoundError();
}

export async function restoreCourseContentForUser(
  db: DbClient,
  args: { userId: string; courseId: string; targetType: CourseContentTarget; targetId: string },
): Promise<void> {
  if (!(await findCourseAccessRole(db, args.userId, args.courseId)))
    throw new CourseContentNotFoundError();
  await db.courseContentHide.deleteMany({
    where: {
      userId: args.userId,
      courseId: args.courseId,
      targetType: args.targetType,
      targetId: args.targetId,
    },
  });
}

export type HiddenCourseContentItem = {
  targetType: CourseContentTarget;
  targetId: string;
  title: string;
  hiddenAt: number;
};

/** 「已隐藏」列表；发布者已经删掉的内容不再列出。 */
export async function listHiddenCourseContent(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<HiddenCourseContentItem[]> {
  const course = await db.course.findUnique({ where: { id: courseId }, select: { ownerId: true } });
  if (!course) return [];
  const hides = await db.courseContentHide.findMany({
    where: { userId, courseId, targetType: 'notebook' },
    orderBy: { createdAt: 'desc' },
    select: { targetType: true, targetId: true, createdAt: true },
  });
  const ids = (type: CourseContentTarget) =>
    hides.filter((hide) => hide.targetType === type).map((hide) => hide.targetId);
  const [notebooks, problems] = await Promise.all([
    db.notebook.findMany({
      where: { id: { in: ids('notebook') }, courseId, ownerId: course.ownerId, removedAt: null },
      select: { id: true, name: true },
    }),
    db.notebookProblem.findMany({
      where: { id: { in: ids('problem') }, courseId, ownerId: null },
      select: { id: true, title: true },
    }),
  ]);
  const titles = new Map<string, string>([
    ...notebooks.map((notebook) => [`notebook:${notebook.id}`, notebook.name] as const),
    ...problems.map((problem) => [`problem:${problem.id}`, problem.title] as const),
  ]);
  return hides.flatMap((hide) => {
    const title = titles.get(`${hide.targetType}:${hide.targetId}`);
    return title
      ? [
          {
            targetType: hide.targetType as CourseContentTarget,
            targetId: hide.targetId,
            title,
            hiddenAt: hide.createdAt.getTime(),
          },
        ]
      : [];
  });
}

const problemFingerprintSql = Prisma.sql`md5(COALESCE("title", '') || "publicContentJson"::text || "gradingJson"::text)`;

export type CourseRelease = CourseUpdateSummary & { version: number };

/**
 * 发布者「发布新版」：contentVersion +1，并给上次发布以来新增 / 改过的公有内容盖上这个版本号。
 * 加入的人据此看到「有更新」摘要、「新」弹珠和「题目已更新」。
 */
export async function releaseCourseVersion(
  db: RootDbClient,
  courseId: string,
): Promise<CourseRelease> {
  return db.$transaction(async (tx) => {
    const [course] = await tx.$queryRaw<Array<{ ownerId: string; contentVersion: number }>>`
      SELECT "ownerId", "contentVersion" FROM "Course" WHERE "id" = ${courseId} FOR UPDATE
    `;
    if (!course) throw new CourseContentNotFoundError();
    const version = course.contentVersion + 1;

    const addedProblems = await tx.$executeRaw`
      UPDATE "NotebookProblem"
      SET "updatedAt" = CURRENT_TIMESTAMP, "releaseAddedIn" = ${version}, "releasedHash" = ${problemFingerprintSql}
      WHERE "courseId" = ${courseId}
        AND "ownerId" IS NULL
        AND "releaseAddedIn" IS NULL
        AND "status"::text = 'published'
    `;
    const updatedProblems = await tx.$executeRaw`
      UPDATE "NotebookProblem"
      SET "updatedAt" = CURRENT_TIMESTAMP, "releaseUpdatedIn" = ${version},
          "contentUpdatedAt" = CURRENT_TIMESTAMP,
          "releasedHash" = ${problemFingerprintSql}
      WHERE "courseId" = ${courseId}
        AND "ownerId" IS NULL
        AND "status"::text = 'published'
        AND "releaseAddedIn" IS NOT NULL
        AND "releaseAddedIn" < ${version}
        AND "releasedHash" IS DISTINCT FROM ${problemFingerprintSql}
    `;
    const addedNotebooks = await tx.$executeRaw`
      UPDATE "Notebook"
      SET "releaseAddedIn" = ${version}, "releasedContentVersion" = "contentVersion"
      WHERE "courseId" = ${courseId}
        AND "ownerId" = ${course.ownerId}
        AND "removedAt" IS NULL
        AND "releaseAddedIn" IS NULL
    `;
    const updatedNotebooks = await tx.$executeRaw`
      UPDATE "Notebook"
      SET "releaseUpdatedIn" = ${version}, "releasedContentVersion" = "contentVersion"
      WHERE "courseId" = ${courseId}
        AND "ownerId" = ${course.ownerId}
        AND "removedAt" IS NULL
        AND "releaseAddedIn" IS NOT NULL
        AND "releaseAddedIn" < ${version}
        AND "releasedContentVersion" IS DISTINCT FROM "contentVersion"
    `;
    await tx.course.update({
      where: { id: courseId },
      data: { contentVersion: version, lastReleasedAt: new Date() },
    });
    return { version, addedProblems, updatedProblems, addedNotebooks, updatedNotebooks };
  });
}

type SummaryRow = {
  courseId: string;
  addedProblems: number;
  updatedProblems: number;
  addedNotebooks: number;
  updatedNotebooks: number;
};

/** 加入的人还没看过的版本里，公有层新增和改动了多少。只返回有未读版本的课。 */
export async function courseUpdateSummariesForUser(
  db: DbClient,
  userId: string,
  courseIds: string[],
): Promise<Map<string, CourseUpdateSummary>> {
  if (!courseIds.length) return new Map();
  const rows = await db.$queryRaw<SummaryRow[]>`
    SELECT
      e."courseId",
      (SELECT COUNT(*)::int FROM "NotebookProblem" p
        WHERE p."courseId" = e."courseId" AND p."ownerId" IS NULL AND p."status"::text = 'published'
          AND p."releaseAddedIn" > e."seenContentVersion") AS "addedProblems",
      (SELECT COUNT(*)::int FROM "NotebookProblem" p
        WHERE p."courseId" = e."courseId" AND p."ownerId" IS NULL AND p."status"::text = 'published'
          AND p."releaseUpdatedIn" > e."seenContentVersion"
          AND p."releaseAddedIn" <= e."seenContentVersion") AS "updatedProblems",
      (SELECT COUNT(*)::int FROM "Notebook" n
        WHERE n."courseId" = e."courseId" AND n."ownerId" = c."ownerId" AND n."removedAt" IS NULL
          AND n."releaseAddedIn" > e."seenContentVersion") AS "addedNotebooks",
      (SELECT COUNT(*)::int FROM "Notebook" n
        WHERE n."courseId" = e."courseId" AND n."ownerId" = c."ownerId" AND n."removedAt" IS NULL
          AND n."releaseUpdatedIn" > e."seenContentVersion"
          AND n."releaseAddedIn" <= e."seenContentVersion") AS "updatedNotebooks"
    FROM "CourseEnrollment" e
    JOIN "Course" c ON c."id" = e."courseId"
    WHERE e."userId" = ${userId}
      AND e."courseId" IN (${Prisma.join(courseIds)})
      AND e."seenContentVersion" < c."contentVersion"
  `;
  return new Map(
    rows.map((row) => [
      row.courseId,
      {
        addedProblems: row.addedProblems,
        updatedProblems: row.updatedProblems,
        addedNotebooks: row.addedNotebooks,
        updatedNotebooks: row.updatedNotebooks,
      },
    ]),
  );
}

/** 上次打开以来新加进公有层的笔记 id，用来画「新」弹珠。 */
export async function newCourseNotebookIds(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    SELECT n."id"
    FROM "Notebook" n
    JOIN "Course" c ON c."id" = n."courseId"
    JOIN "CourseEnrollment" e ON e."courseId" = n."courseId" AND e."userId" = ${userId}
    WHERE n."courseId" = ${courseId}
      AND n."ownerId" = c."ownerId"
      AND n."removedAt" IS NULL
      AND n."releaseAddedIn" > e."newSinceVersion"
  `;
  return rows.map((row) => row.id);
}

/** 加入的课里自己加的笔记（私有层）。 */
export async function privateCourseNotebookIds(
  db: DbClient,
  userId: string,
  courseId: string,
): Promise<string[]> {
  const rows = await db.notebook.findMany({
    where: { courseId, ownerId: userId, removedAt: null, course: { ownerId: { not: userId } } },
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

/** 课程页要的两层信息：已隐藏、「新」笔记、自己的笔记、还没看过的更新摘要。 */
export async function courseLayersForUser(db: DbClient, userId: string, courseId: string) {
  if (!(await findCourseAccessRole(db, userId, courseId))) throw new CourseContentNotFoundError();
  const [hidden, newNotebookIds, privateNotebookIds, summaries] = await Promise.all([
    listHiddenCourseContent(db, userId, courseId),
    newCourseNotebookIds(db, userId, courseId),
    privateCourseNotebookIds(db, userId, courseId),
    courseUpdateSummariesForUser(db, userId, [courseId]),
  ]);
  const summary = summaries.get(courseId);
  return {
    hidden,
    newNotebookIds,
    privateNotebookIds,
    update: summary ? { text: formatCourseUpdateSummary(summary), ...summary } : null,
  };
}

/**
 * 「复制到我的」仅用于公有笔记：生成私有副本，原件对自己收起（可恢复）。
 * 公有题目只读，不能隐藏、删除或复制。
 */
export async function copyCourseContentToMine(
  db: RootDbClient,
  args: { userId: string; courseId: string; targetType: CourseContentTarget; targetId: string },
): Promise<{ id: string }> {
  const role = await findCourseAccessRole(db, args.userId, args.courseId);
  if (role !== 'enrolled') throw new CourseContentNotFoundError();

  if (args.targetType === 'problem') throw new PublicProblemReadOnlyError();

  return db.$transaction(async (tx) => {
    const course = await tx.course.findUnique({
      where: { id: args.courseId },
      select: { ownerId: true },
    });
    if (!course) throw new CourseContentNotFoundError();
    await requireVisibleNotebook(tx, args.userId, args.courseId, args.targetId);
    const before = await tx.notebook.findMany({
      where: { courseId: args.courseId, ownerId: args.userId },
      select: { id: true },
    });
    const result = await copyCourseContentsTx(tx, {
      userId: args.userId,
      sourceOwnerId: course.ownerId,
      sourceId: args.courseId,
      targetId: args.courseId,
      bookIds: [args.targetId],
      problemIds: [],
      keys: new Map(),
      chapterMap: new Map(),
      tagMap: new Map(),
      problemOwnerId: args.userId,
    });
    if (!result.notebooks) throw new CourseContentNotFoundError();
    const known = new Set(before.map((notebook) => notebook.id));
    const created = await tx.notebook.findFirst({
      where: { courseId: args.courseId, ownerId: args.userId, id: { notIn: [...known] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    await hide(tx, args);
    return { id: created?.id ?? args.targetId };
  });
}
