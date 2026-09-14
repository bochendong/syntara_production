import { createHash } from 'node:crypto';
import { copyCourseContentsTx } from '@/lib/server/teacher-course-content-copy';
import { Prisma } from '@/lib/server/generated-prisma';
import type { DbClient, RootDbClient } from '@/lib/server/repositories/types';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import { refreshCourseSummaryFields } from '@/lib/server/repositories/notebook-repository';
import { courseProblemDedupeKey } from '@/features/problems/domain/problem-dedupe';
import { notebookProblemPublicContentSchema } from '@/lib/problem-bank/schema';
import type { BulkMoveInput, BulkMovePreview } from '@/lib/teacher/course-bulk-move';

export class CourseBulkMoveError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

const courseSelect = {
  id: true,
  name: true,
  courseCode: true,
  academicYear: true,
  academicTerm: true,
} as const;
const problemScope = (courseId: string): Prisma.NotebookProblemWhereInput => ({
  OR: [{ courseId }, { courseId: null, notebook: { courseId } }],
});

async function requireCourse(db: DbClient, userId: string, courseId: string) {
  const course = await db.course.findFirst({
    where: { id: courseId, ...teacherCourseAccessWhere(userId) },
    select: courseSelect,
  });
  if (!course) throw new CourseBulkMoveError('课程不存在，或你没有管理这门课程的权限。', 404);
  return course;
}

function version(rows: Array<{ id: string; updatedAt: Date }>) {
  return createHash('sha256')
    .update(JSON.stringify(rows.map((row) => [row.id, row.updatedAt.toISOString()]).sort()))
    .digest('hex');
}

async function contents(db: DbClient, userId: string, courseId: string) {
  const notebooks = await db.notebook.findMany({
    where: { courseId, ownerId: userId, removedAt: null },
    select: { id: true, updatedAt: true, coverSlideJson: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const problems = await db.notebookProblem.findMany({
    where: problemScope(courseId),
    select: {
      id: true,
      updatedAt: true,
      notebookId: true,
      chapterId: true,
      title: true,
      type: true,
      publicContentJson: true,
      order: true,
      problemNumber: true,
    },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  });
  return { notebooks, problems };
}

export async function getCourseBulkMovePreview(
  db: DbClient,
  userId: string,
  sourceCourseId: string,
): Promise<BulkMovePreview> {
  await requireCourse(db, userId, sourceCourseId);
  const targets = await db.course.findMany({
    where: { id: { not: sourceCourseId }, ...teacherCourseAccessWhere(userId) },
    select: courseSelect,
  });
  // Return selectable names and counts without question bodies or image payloads.
  const notebooks = await db.notebook.findMany({
    where: { courseId: sourceCourseId, ownerId: userId, removedAt: null },
    select: { id: true, name: true, updatedAt: true },
  });
  const problems = await db.notebookProblem.findMany({
    where: problemScope(sourceCourseId),
    select: { id: true, chapterId: true, updatedAt: true },
  });
  const chapters = await db.courseProblemChapter.findMany({
    where: { courseId: sourceCourseId },
    orderBy: [{ position: 'asc' }, { id: 'asc' }],
  });
  return {
    targets,
    notebooks: {
      count: notebooks.length,
      version: version(notebooks),
      items: notebooks.map((item) => ({ id: item.id, name: item.name || 'AI 笔记本' })),
    },
    problems: {
      count: problems.length,
      version: version(problems),
      chapters: [
        ...chapters.map((chapter) => ({
          id: chapter.id,
          name: chapter.name,
          count: problems.filter((problem) => problem.chapterId === chapter.id).length,
        })),
        {
          id: '__unfiled__',
          name: '未归档',
          count: problems.filter((problem) => !problem.chapterId).length,
        },
      ],
    },
  };
}

function problemKey(row: Awaited<ReturnType<typeof contents>>['problems'][number]) {
  const parsed = notebookProblemPublicContentSchema.safeParse(row.publicContentJson);
  if (!parsed.success || parsed.data.type !== row.type) {
    throw new CourseBulkMoveError(`题目「${row.title}」内容不完整，请修复后再迁移。`);
  }
  return courseProblemDedupeKey({ title: row.title, type: row.type, publicContent: parsed.data });
}

function coverObject(value: Prisma.JsonValue): Prisma.InputJsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Prisma.InputJsonObject)
    : {};
}

/** Keep question IDs (and their attempts/assets) intact; only their course taxonomy changes. */
async function moveTaxonomy(
  tx: Prisma.TransactionClient,
  sourceId: string,
  targetId: string,
  selectedChapterIds: Set<string>,
  selectedTagIds: Set<string>,
) {
  const chapterMap = new Map<string, string>();
  const chapters = await tx.courseProblemChapter.findMany({ where: { courseId: sourceId } });
  for (const chapter of chapters.filter((item) => selectedChapterIds.has(item.id))) {
    const target = await tx.courseProblemChapter.upsert({
      where: { courseId_name: { courseId: targetId, name: chapter.name } },
      create: {
        courseId: targetId,
        name: chapter.name,
        description: chapter.description,
        position: chapter.position,
      },
      update: {},
      select: { id: true },
    });
    chapterMap.set(chapter.id, target.id);
  }
  const tagMap = new Map<string, string>();
  const tags = await tx.courseProblemTagNode.findMany({
    where: { courseId: sourceId },
    orderBy: [{ level: 'asc' }, { id: 'asc' }],
  });
  for (const tag of tags) {
    if (selectedTagIds.has(tag.id) && tag.parentId) selectedTagIds.add(tag.parentId);
  }
  for (const tag of tags.filter((item) => selectedTagIds.has(item.id))) {
    const parentId = tag.parentId ? tagMap.get(tag.parentId) : null;
    if (tag.parentId && !parentId)
      throw new CourseBulkMoveError('题库知识点层级不完整，请整理后再迁移。');
    const target = await tx.courseProblemTagNode.upsert({
      where: {
        courseId_level_normalizedName: {
          courseId: targetId,
          level: tag.level,
          normalizedName: tag.normalizedName,
        },
      },
      create: {
        courseId: targetId,
        parentId,
        level: tag.level,
        name: tag.name,
        normalizedName: tag.normalizedName,
        aliases: tag.aliases,
        source: tag.source,
        status: tag.status,
        confidence: tag.confidence,
        position: tag.position,
        lockedByTeacher: tag.lockedByTeacher,
      },
      update: {},
      select: { id: true, parentId: true },
    });
    if (target.parentId !== parentId) {
      throw new CourseBulkMoveError(`两门课程中「${tag.name}」所属知识点分类不同，请先统一分类。`);
    }
    tagMap.set(tag.id, target.id);
  }
  return { chapterMap, tagMap };
}

export async function moveCourseContents(
  db: RootDbClient,
  userId: string,
  sourceId: string,
  input: BulkMoveInput,
) {
  const targetId = input.targetCourseId;
  if (targetId === sourceId || (!input.notebooks && !input.problems)) {
    throw new CourseBulkMoveError('请选择其他课程，并至少勾选一种迁移内容。', 400);
  }
  return db.$transaction(
    async (tx) => {
      await requireCourse(tx, userId, sourceId);
      await requireCourse(tx, userId, targetId);
      // Match the single-notebook mover's lock order: notebook rows, then course dedupe locks.
      await tx.$queryRaw(Prisma.sql`
      SELECT "id" FROM "Notebook" WHERE "courseId" IN (${sourceId}, ${targetId})
      ORDER BY "id" FOR UPDATE
    `);
      for (const id of [sourceId, targetId].sort()) {
        await tx.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "locked"',
          `course-problem-dedupe:${id}`,
        );
      }
      const activeTask = await tx.agentTask.findFirst({
        where: {
          courseId: { in: [sourceId, targetId] },
          status: { in: ['queued', 'running', 'waiting'] },
          taskType: {
            in: [
              'teacher_notebook_generation',
              'teacher_problem_bank_import',
              'teacher_mind_map_generation',
            ],
          },
        },
        select: { id: true },
      });
      const activeJob = await tx.backgroundJob.findFirst({
        where: { courseId: { in: [sourceId, targetId] }, status: { in: ['queued', 'running'] } },
        select: { id: true },
      });
      const committingImport = await tx.problemImportBatch.findFirst({
        where: {
          OR: [
            { courseId: { in: [sourceId, targetId] } },
            { courseId: null, notebook: { courseId: { in: [sourceId, targetId] } } },
          ],
          status: 'committing',
        },
        select: { id: true },
      });
      if (activeTask || activeJob || committingImport) {
        throw new CourseBulkMoveError('课程中还有生成或导入任务，请等任务完成后再迁移。');
      }
      const source = await contents(tx, userId, sourceId);
      if (
        (input.notebooks && version(source.notebooks) !== input.notebookVersion) ||
        (input.problems && version(source.problems) !== input.problemVersion)
      ) {
        throw new CourseBulkMoveError('课程内容已发生变化，请刷新迁移列表后重新确认。');
      }
      const chapters = await tx.courseProblemChapter.findMany({ where: { courseId: sourceId } });
      for (const [ids, available] of [
        [input.notebookIds, source.notebooks.map((row) => row.id)],
        [input.problemIds, source.problems.map((row) => row.id)],
        [input.chapterIds, [...chapters.map((row) => row.id), '__unfiled__']],
      ] as Array<[string[] | undefined, string[]]>) {
        if (ids?.some((id) => !available.includes(id)))
          throw new CourseBulkMoveError('所选内容已不存在或不属于这门课程，请刷新后重试。', 400);
      }
      const books = input.notebooks
        ? source.notebooks.filter((row) => !input.notebookIds || input.notebookIds.includes(row.id))
        : [];
      const problems = input.problems
        ? source.problems.filter(
            (row) =>
              (!input.chapterIds || input.chapterIds.includes(row.chapterId ?? '__unfiled__')) &&
              (!input.problemIds || input.problemIds.includes(row.id)),
          )
        : [];
      const selectedChapterIds = new Set([
        ...(input.problems
          ? (input.chapterIds ?? (input.problemIds ? [] : chapters.map((chapter) => chapter.id)))
          : []
        ).filter((id) => id !== '__unfiled__'),
        ...problems.flatMap((row) => (row.chapterId ? [row.chapterId] : [])),
      ]);
      if (!books.length && !problems.length && !selectedChapterIds.size)
        throw new CourseBulkMoveError('没有可迁移的内容。', 400);
      const bookIds = books.map((row) => row.id);
      const problemIds = problems.map((row) => row.id);
      const bookSet = new Set(bookIds);
      const imports = await tx.problemImportBatch.findMany({
        where: {
          OR: [{ courseId: sourceId }, { courseId: null, notebook: { courseId: sourceId } }],
        },
        select: { id: true, notebookId: true },
      });
      const target = await contents(tx, userId, targetId);
      const keys = new Map<string, string>();
      if (input.problems) {
        const seen = new Set(target.problems.map(problemKey));
        for (const problem of problems) {
          const key = problemKey(problem);
          if (seen.has(key))
            throw new CourseBulkMoveError(
              `题目「${problem.title}」与目标题库或本次迁移中的其他题目重复，请先处理重复题。`,
            );
          seen.add(key);
          keys.set(problem.id, key);
        }
      }

      if (input.operation === 'copy') {
        if (
          target.notebooks.some((book) =>
            bookSet.has(String(coverObject(book.coverSlideJson).copiedFromNotebookId ?? '')),
          )
        ) {
          throw new CourseBulkMoveError('目标课程中已有所选笔记本的副本，请先取消勾选已有内容。');
        }
        const assignments = await tx.notebookProblemTagAssignment.findMany({
          where: { problemId: { in: problemIds } },
        });
        const taxonomy = await moveTaxonomy(
          tx,
          sourceId,
          targetId,
          selectedChapterIds,
          new Set(assignments.map((item) => item.tagId)),
        );
        return copyCourseContentsTx(tx, {
          userId,
          sourceId,
          targetId,
          bookIds,
          problemIds,
          keys,
          ...taxonomy,
        });
      }

      // A subset move must never leave notebook/course foreign keys pointing at different courses.
      if (books.length) {
        await tx.notebookProblem.updateMany({
          where: { notebookId: { in: bookIds }, courseId: null, id: { notIn: problemIds } },
          data: { courseId: sourceId },
        });
        await tx.notebookProblem.updateMany({
          where: { notebookId: { in: bookIds }, id: { notIn: problemIds } },
          data: { notebookId: null },
        });
      }
      if (problems.length || selectedChapterIds.size) {
        const assignments = await tx.notebookProblemTagAssignment.findMany({
          where: { problemId: { in: problemIds } },
        });
        const { chapterMap, tagMap } = await moveTaxonomy(
          tx,
          sourceId,
          targetId,
          selectedChapterIds,
          new Set(assignments.map((item) => item.tagId)),
        );
        for (const assignment of assignments) {
          const tagId = tagMap.get(assignment.tagId);
          if (!tagId) throw new CourseBulkMoveError('题目含有跨课程知识点，请整理后再迁移。');
          await tx.notebookProblemTagAssignment.upsert({
            where: { problemId_tagId: { problemId: assignment.problemId, tagId } },
            create: {
              problemId: assignment.problemId,
              tagId,
              source: assignment.source,
              status: assignment.status,
              confidence: assignment.confidence,
            },
            update: {},
          });
        }
        await tx.notebookProblemTagAssignment.deleteMany({
          where: { problemId: { in: problemIds }, tagId: { in: [...tagMap.keys()] } },
        });
        let order = Math.max(-1, ...target.problems.map((p) => p.order));
        let number = Math.max(0, ...target.problems.map((p) => p.problemNumber ?? 0));
        for (const problem of problems) {
          if (problem.chapterId && !chapterMap.has(problem.chapterId)) {
            throw new CourseBulkMoveError('题目含有跨课程章节，请整理后再迁移。');
          }
          await tx.notebookProblem.update({
            where: { id: problem.id },
            data: {
              courseId: targetId,
              notebookId:
                problem.notebookId && bookSet.has(problem.notebookId) ? problem.notebookId : null,
              chapterId: problem.chapterId ? (chapterMap.get(problem.chapterId) ?? null) : null,
              dedupeKey: keys.get(problem.id),
              order: ++order,
              problemNumber: ++number,
            },
          });
        }
        // The emptied source taxonomy is retained for future questions; no unrelated records are deleted.
      }
      const moveAllProblems =
        input.problems && problems.length === source.problems.length && problems.length > 0;
      for (const batch of imports) {
        const keepNotebook = moveAllProblems
          ? Boolean(batch.notebookId && bookSet.has(batch.notebookId))
          : !bookSet.has(batch.notebookId ?? '');
        await tx.problemImportBatch.update({
          where: { id: batch.id },
          data: {
            courseId: moveAllProblems ? targetId : sourceId,
            notebookId: keepNotebook ? batch.notebookId : null,
          },
        });
      }
      let learningOrder = Math.max(
        0,
        ...target.notebooks.map((n) => Number(coverObject(n.coverSlideJson).learningOrder) || 0),
      );
      books.sort(
        (a, b) =>
          (Number(coverObject(a.coverSlideJson).learningOrder) || 0) -
          (Number(coverObject(b.coverSlideJson).learningOrder) || 0),
      );
      for (const book of books) {
        await tx.notebook.update({
          where: { id: book.id },
          data: {
            courseId: targetId,
            contentVersion: { increment: 1 },
            coverSlideJson: { ...coverObject(book.coverSlideJson), learningOrder: ++learningOrder },
          },
        });
      }
      if (books.length) {
        await tx.markdownNotebookSection.updateMany({
          where: { notebookId: { in: bookIds } },
          data: { courseId: targetId },
        });
        await tx.notebookPage.updateMany({
          where: { notebookId: { in: bookIds } },
          data: { courseId: targetId },
        });
      }
      const affectedBooks = [
        ...new Set([...bookIds, ...problems.flatMap((p) => (p.notebookId ? [p.notebookId] : []))]),
      ];
      for (const id of affectedBooks) {
        const problemCount = await tx.notebookProblem.count({ where: { notebookId: id } });
        const publishedProblemCount = await tx.notebookProblem.count({
          where: { notebookId: id, status: 'published' },
        });
        await tx.notebook.update({ where: { id }, data: { problemCount, publishedProblemCount } });
      }
      // Search projections are derived, course-scoped data. Drop old copies atomically; normal
      // projection reconciliation rebuilds them in the new course from the unchanged content IDs.
      await tx.knowledgeDocument.deleteMany({
        where: {
          courseId: sourceId,
          OR: [
            ...(bookIds.length
              ? [{ notebookId: { in: bookIds }, sourceEntityType: { not: 'NotebookProblem' } }]
              : []),
            ...(problemIds.length
              ? [{ sourceEntityType: 'NotebookProblem', sourceEntityId: { in: problemIds } }]
              : []),
          ],
        },
      });
      await refreshCourseSummaryFields(tx, sourceId);
      await refreshCourseSummaryFields(tx, targetId);
      return { notebooks: books.length, problems: problems.length, targetCourseId: targetId };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 15_000,
      timeout: 120_000,
    },
  );
}
