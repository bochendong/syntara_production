import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/lib/server/generated-prisma';
import { toPrismaJson, toPrismaNullableJson } from '@/lib/server/prisma-json';
import { refreshCourseSummaryFields } from '@/lib/server/repositories/notebook-repository';

/** Copy teaching content only. Attempts, conversations and learner state stay in their course. */
export async function copyCourseContentsTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    sourceId: string;
    targetId: string;
    bookIds: string[];
    problemIds: string[];
    keys: Map<string, string>;
    chapterMap: Map<string, string>;
    tagMap: Map<string, string>;
  },
) {
  const books = await tx.notebook.findMany({
    where: { id: { in: input.bookIds }, courseId: input.sourceId, ownerId: input.userId },
    include: {
      scenes: true,
      markdownSections: true,
      pages: { include: { content: true, actions: true, assets: true } },
    },
  });
  const bookMap = new Map<string, string>();
  const targetBooks = await tx.notebook.findMany({
    where: { courseId: input.targetId },
    select: { coverSlideJson: true },
  });
  let learningOrder = Math.max(
    0,
    ...targetBooks.map(
      (book) => Number((book.coverSlideJson as Record<string, unknown> | null)?.learningOrder) || 0,
    ),
  );
  for (const book of books) {
    const ids = new Map(
      [book, ...book.scenes, ...book.markdownSections, ...book.pages].map((item) => [
        item.id,
        randomUUID(),
      ]),
    );
    const remap = (value: Prisma.JsonValue): Prisma.JsonValue => {
      if (typeof value === 'string') return ids.get(value) ?? value;
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value === 'object')
        return Object.fromEntries(
          Object.entries(value).map(([key, item]) => [key, remap(item ?? null)]),
        );
      return value;
    };
    const cover =
      book.coverSlideJson &&
      typeof book.coverSlideJson === 'object' &&
      !Array.isArray(book.coverSlideJson)
        ? book.coverSlideJson
        : {};
    const created = await tx.notebook.create({
      data: {
        id: ids.get(book.id),
        ownerId: input.userId,
        courseId: input.targetId,
        name: book.name,
        description: book.description,
        tags: book.tags,
        avatarUrl: book.avatarUrl,
        language: book.language,
        style: book.style,
        notebookKind: book.notebookKind,
        sourceNotebookId: book.sourceNotebookId,
        sceneCount: book.sceneCount,
        sectionCount: book.sectionCount,
        speechReadyCount: book.speechReadyCount,
        speechTotalCount: book.speechTotalCount,
        speechStatus: book.speechStatus,
        coverSlideJson: toPrismaJson({
          ...(remap(cover) as Prisma.InputJsonObject),
          copiedFromNotebookId: book.id,
          copiedFromCourseId: input.sourceId,
          learningOrder: ++learningOrder,
        }),
        coverImagePath: book.coverImagePath,
        mindMapData: book.mindMapData,
        mindMapMime: book.mindMapMime,
      },
    });
    bookMap.set(book.id, created.id);
    const scenes = new Map<string, string>();
    for (const scene of book.scenes) {
      const clone = await tx.scene.create({
        data: {
          id: ids.get(scene.id),
          notebookId: created.id,
          title: scene.title,
          type: scene.type,
          order: scene.order,
          content: toPrismaJson(remap(scene.content)),
          actions: toPrismaNullableJson(remap(scene.actions)),
          whiteboard: toPrismaNullableJson(remap(scene.whiteboard)),
        },
      });
      scenes.set(scene.id, clone.id);
    }
    for (const section of book.markdownSections) {
      await tx.markdownNotebookSection.create({
        data: {
          id: ids.get(section.id),
          notebookId: created.id,
          courseId: input.targetId,
          title: section.title,
          order: section.order,
          markdown: section.markdown,
          summary: section.summary,
          sourceMeta: toPrismaNullableJson(remap(section.sourceMeta)),
        },
      });
    }
    for (const page of book.pages) {
      const clone = await tx.notebookPage.create({
        data: {
          id: ids.get(page.id),
          notebookId: created.id,
          courseId: input.targetId,
          sourceSceneId: page.sourceSceneId ? (scenes.get(page.sourceSceneId) ?? null) : null,
          title: page.title,
          type: page.type,
          order: page.order,
          contentHash: null,
          actionsHash: null,
          thumbnailJson: toPrismaNullableJson(remap(page.thumbnailJson)),
          coverImagePath: page.coverImagePath,
        },
      });
      if (page.content)
        await tx.notebookPageContent.create({
          data: {
            pageId: clone.id,
            content: toPrismaJson(remap(page.content.content)),
            whiteboard: toPrismaNullableJson(remap(page.content.whiteboard)),
          },
        });
      if (page.actions)
        await tx.notebookPageActions.create({
          data: {
            pageId: clone.id,
            actions: toPrismaNullableJson(remap(page.actions.actions)),
            speechReadyCount: page.actions.speechReadyCount,
            speechTotalCount: page.actions.speechTotalCount,
            speechStatus: page.actions.speechStatus,
          },
        });
      for (const asset of page.assets)
        await tx.notebookPageAsset.create({
          data: {
            pageId: clone.id,
            assetId: asset.assetId,
            role: asset.role,
            order: asset.order,
            metaJson: toPrismaNullableJson(remap(asset.metaJson)),
          },
        });
    }
  }
  const problems = await tx.notebookProblem.findMany({
    where: { id: { in: input.problemIds } },
    include: { secret: true, tagAssignments: true },
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  });
  const targetProblems = await tx.notebookProblem.findMany({
    where: {
      OR: [
        { courseId: input.targetId },
        { courseId: null, notebook: { courseId: input.targetId } },
      ],
    },
    select: { order: true, problemNumber: true },
  });
  let order = Math.max(-1, ...targetProblems.map((problem) => problem.order));
  let number = Math.max(0, ...targetProblems.map((problem) => problem.problemNumber ?? 0));
  for (const problem of problems) {
    const clone = await tx.notebookProblem.create({
      data: {
        courseId: input.targetId,
        notebookId: problem.notebookId ? (bookMap.get(problem.notebookId) ?? null) : null,
        chapterId: problem.chapterId ? (input.chapterMap.get(problem.chapterId) ?? null) : null,
        title: problem.title,
        type: problem.type,
        status: problem.status,
        source: problem.source,
        order: ++order,
        problemNumber: ++number,
        points: problem.points,
        tags: problem.tags,
        difficulty: problem.difficulty,
        publicContentJson: toPrismaJson(problem.publicContentJson),
        gradingJson: toPrismaJson(problem.gradingJson),
        sourceMeta: toPrismaJson({
          ...(problem.sourceMeta &&
          typeof problem.sourceMeta === 'object' &&
          !Array.isArray(problem.sourceMeta)
            ? Object.fromEntries(
                Object.entries(problem.sourceMeta).filter(([key]) => key !== 'importBatchId'),
              )
            : {}),
          copiedFromCourseId: input.sourceId,
          copiedFromProblemId: problem.id,
        }),
        dedupeKey: input.keys.get(problem.id),
      },
    });
    if (problem.secret)
      await tx.notebookProblemSecret.create({
        data: {
          problemId: clone.id,
          secretJudgeJson: toPrismaJson(problem.secret.secretJudgeJson),
        },
      });
    for (const assignment of problem.tagAssignments) {
      const tagId = input.tagMap.get(assignment.tagId);
      if (!tagId) throw new Error('题目知识点归属无效，复制已取消。');
      await tx.notebookProblemTagAssignment.create({
        data: {
          problemId: clone.id,
          tagId,
          source: assignment.source,
          status: assignment.status,
          confidence: assignment.confidence,
        },
      });
    }
  }
  for (const id of bookMap.values()) {
    await tx.notebook.update({
      where: { id },
      data: {
        problemCount: await tx.notebookProblem.count({ where: { notebookId: id } }),
        publishedProblemCount: await tx.notebookProblem.count({
          where: { notebookId: id, status: 'published' },
        }),
      },
    });
  }
  await refreshCourseSummaryFields(tx, input.targetId);
  return { notebooks: books.length, problems: problems.length, targetCourseId: input.targetId };
}
