import { Prisma } from '@/lib/server/generated-prisma';
import { normalizeProblemConceptTags } from '@/lib/problem-bank/concept-tags.mjs';
import { courseProblemDedupeKey } from '@/features/problems/domain/problem-dedupe';
import { prisma } from '@/lib/server/prisma';
import { toPrismaJson, toPrismaNullableJson } from '@/lib/server/prisma-json';
import {
  buildLegacyProblemDraftsFromScene,
  notebookProblemAttemptRecordSchema,
  notebookProblemDifficultySchema,
  notebookProblemGradingSchema,
  notebookProblemImportDraftSchema,
  notebookProblemPublicContentSchema,
  notebookProblemRecordSchema,
  notebookProblemStatusSchema,
  notebookProblemSummarySchema,
  type NotebookProblemAttemptAnswer,
  type NotebookProblemAttemptRecord,
  type NotebookProblemAttemptResult,
  type NotebookProblemImportDraft,
  type NotebookProblemRecord,
  type NotebookProblemSecretJudge,
  type NotebookProblemSummary,
} from '@/lib/problem-bank';
import type { Scene } from '@/lib/types/stage';
import {
  findCourseAccessRole,
  type CourseAccessRole,
  withCourseEnrollmentSchemaFallback,
} from '@/lib/server/repositories/course-enrollment-repository';
import { refreshCourseSummaryFields } from '@/lib/server/repositories/notebook-repository';
import { maybeWriteProblemAttemptMemorySignal } from '@/lib/server/problem-attempt-memory-signals';

const prismaDb = prisma;

type OwnedNotebook = {
  id: string;
  name: string;
  courseId: string | null;
};

type OwnedCourse = {
  id: string;
  name: string;
};

type ReadableNotebook = OwnedNotebook & {
  accessRole: CourseAccessRole;
};

type ProblemRow = {
  id: string;
  courseId: string | null;
  notebookId: string | null;
  title: string;
  type: string;
  status: string;
  source: string;
  order: number;
  problemNumber: number | null;
  points: number;
  tags: string[];
  difficulty: string;
  publicContentJson: unknown;
  gradingJson: unknown;
  sourceMeta: unknown;
  createdAt: Date;
  updatedAt: Date;
  notebook?: {
    id: string;
    name: string;
    courseId: string | null;
  } | null;
  secret?: {
    secretJudgeJson: unknown;
  } | null;
  progress?: ProblemInlineProgressRow[];
};

type ProblemInlineProgressRow = {
  status: string;
  score: number | null;
  lastAttemptAt: Date | null;
  latestAttempt: {
    id: string;
    createdAt: Date;
  } | null;
};

type ProblemAttemptRow = {
  id: string;
  problemId: string;
  userId: string;
  kind: string;
  status: string;
  score: number | null;
  answerJson: unknown;
  resultJson: unknown;
  createdAt: Date;
  updatedAt: Date;
};

type ProblemWithSecretRow = ProblemRow & {
  secret: {
    secretJudgeJson: unknown;
  } | null;
};

type NotebookProblemSummaryForUser = NotebookProblemSummary & {
  secretJudge?: NotebookProblemSecretJudge;
};

type NotebookProblemRecordForOwner = NotebookProblemRecord & {
  secretJudge?: NotebookProblemSecretJudge;
};

export type ProblemDraftWriteSummary = {
  requestedCount: number;
  insertedProblemIds: string[];
  reusedProblemIds: string[];
  skippedDraftIds: string[];
  reusedDrafts: Array<{
    draftId: string;
    existingProblemId: string;
    dedupeKey: string;
  }>;
};

export type CourseProblemDraftWriteResult = {
  problems: NotebookProblemSummaryForUser[];
  writeSummary: ProblemDraftWriteSummary;
};

export type NotebookProblemDraftWriteResult = {
  problems: NotebookProblemSummaryForUser[];
  writeSummary: ProblemDraftWriteSummary;
};

export class DuplicateCourseProblemError extends Error {
  readonly code = 'COURSE_PROBLEM_DUPLICATE';

  constructor(readonly existingProblemId: string) {
    super('This course already contains the same problem.');
    this.name = 'DuplicateCourseProblemError';
  }
}

type ProblemCourseSummaryRow = {
  id: string;
  courseId: string | null;
  notebookId: string | null;
  title: string;
  type: string;
  status: string;
  tags: string[];
  difficulty: string;
  updatedAt: Date;
  notebook?: {
    id: string;
    name: string;
    courseId: string | null;
  } | null;
  progress?: ProblemInlineProgressRow[];
};

type FlatCourseProblemRow = {
  id: string;
  courseId: string | null;
  notebookId: string | null;
  title: string;
  type: string;
  status: string;
  source: string;
  order: number;
  problemNumber: number | null;
  points: number;
  tags: string[];
  difficulty: string;
  publicContentJson: unknown;
  gradingJson: unknown;
  sourceMeta: unknown;
  createdAt: Date;
  updatedAt: Date;
  notebookName: string | null;
  notebookCourseId: string | null;
  secretJudgeJson: unknown | null;
  latestAttemptId: string | null;
  latestAttemptStatus: string | null;
  latestAttemptScore: number | null;
  latestAttemptCreatedAt: Date | null;
};

type PreparedPublishProblemWrite = {
  id: string;
  status: NotebookProblemImportDraft['status'];
  tags: string[];
  publicContentJson: ReturnType<typeof toPrismaJson>;
  gradingJson: ReturnType<typeof toPrismaJson>;
  sourceMeta: ReturnType<typeof toPrismaNullableJson>;
  secretJudgeJson?: ReturnType<typeof toPrismaJson>;
};

export type PublishProblemBankResult = {
  totalCount: number;
  publishedCount: number;
  skippedCount: number;
};

export type CourseProblemListSummary = {
  id: string;
  courseId: string | null;
  notebookId: string | null;
  notebookName?: string;
  title: string;
  type: string;
  status: string;
  tags: string[];
  difficulty: string;
  updatedAt: number;
  latestAttempt: {
    id: string;
    status: string;
    score: number | null;
    createdAt: number;
  } | null;
};

export const REVIEW_PROBLEM_CANDIDATE_LIMIT = 24;
export const REVIEW_PROBLEM_DETAIL_LIMIT = 20;

export type ReviewProblemCandidate = {
  id: string;
  courseId: string | null;
  notebookId: string | null;
  notebookName?: string;
  title: string;
  type: NotebookProblemSummary['type'];
  status: NotebookProblemSummary['status'];
  tags: string[];
  difficulty: NotebookProblemSummary['difficulty'];
  searchText: string;
  latestAttempt: NonNullable<NotebookProblemSummary['latestAttempt']> | null;
};

export type ReviewProblemDetail = {
  id: string;
  publicContent: NotebookProblemSummary['publicContent'];
};

type ReviewProblemCandidateRow = {
  id: string;
  courseId: string | null;
  notebookId: string | null;
  notebookName: string | null;
  title: string;
  type: string;
  status: string;
  tags: string[];
  difficulty: string;
  searchText: string | null;
  latestAttemptId: string | null;
  latestAttemptStatus: string | null;
  latestAttemptScore: number | null;
  latestAttemptCreatedAt: Date | null;
};

type ReviewProblemDetailRow = {
  id: string;
  publicContentJson: unknown;
};

const PUBLISH_PROBLEM_WRITE_BATCH_SIZE = 40;

function mapAttemptRow(row: ProblemAttemptRow): NotebookProblemAttemptRecord {
  return notebookProblemAttemptRecordSchema.parse({
    id: row.id,
    problemId: row.problemId,
    userId: row.userId,
    kind: row.kind,
    status: row.status,
    score: row.score,
    answer: row.answerJson,
    result: row.resultJson ?? undefined,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  });
}

function mapProblemRow(
  row: ProblemRow,
  latestAttempt?: Pick<ProblemAttemptRow, 'id' | 'status' | 'score' | 'createdAt'> | null,
): NotebookProblemSummaryForUser {
  const resolvedCourseId = row.courseId ?? row.notebook?.courseId ?? null;
  const problem = notebookProblemSummarySchema.parse({
    id: row.id,
    courseId: resolvedCourseId,
    notebookId: row.notebookId,
    notebookName: row.notebook?.name ?? undefined,
    title: row.title,
    type: row.type,
    status: row.status,
    source: row.source,
    order: row.order,
    problemNumber: row.problemNumber,
    points: row.points,
    tags: normalizeProblemConceptTags({
      courseId: resolvedCourseId,
      notebookId: row.notebookId,
      notebookName: row.notebook?.name,
      title: row.title,
      type: row.type,
      tags: row.tags ?? [],
      difficulty: row.difficulty,
      publicContent: row.publicContentJson,
      sourceMeta: row.sourceMeta ?? {},
    }),
    difficulty: row.difficulty,
    publicContent: row.publicContentJson,
    grading: row.gradingJson,
    sourceMeta: row.sourceMeta ?? {},
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    latestAttempt: latestAttempt
      ? {
          id: latestAttempt.id,
          status: latestAttempt.status,
          score: latestAttempt.score,
          createdAt: latestAttempt.createdAt.getTime(),
        }
      : null,
  });

  return row.secret?.secretJudgeJson
    ? {
        ...problem,
        secretJudge: row.secret.secretJudgeJson as NotebookProblemSecretJudge,
      }
    : problem;
}

function latestAttemptFromProgress(
  progress: ProblemInlineProgressRow | null | undefined,
): Pick<ProblemAttemptRow, 'id' | 'status' | 'score' | 'createdAt'> | null {
  if (!progress?.latestAttempt) return null;
  return {
    id: progress.latestAttempt.id,
    status: progress.status,
    score: progress.score,
    createdAt: progress.lastAttemptAt ?? progress.latestAttempt.createdAt,
  };
}

function buildPublishDraftFromRow(row: ProblemWithSecretRow): NotebookProblemImportDraft {
  return notebookProblemImportDraftSchema.parse({
    draftId: row.id,
    notebookId: row.notebookId,
    title: row.title,
    type: row.type,
    status: 'published',
    source: row.source,
    points: row.points,
    tags: row.tags ?? [],
    difficulty: row.difficulty,
    publicContent: row.publicContentJson,
    grading: row.gradingJson,
    secretJudge: row.secret?.secretJudgeJson as NotebookProblemSecretJudge | undefined,
    sourceMeta: row.sourceMeta ?? {},
    validationErrors: [],
  });
}

function prepareProblemRowsForPublish(rows: ProblemWithSecretRow[]): {
  result: PublishProblemBankResult;
  writes: PreparedPublishProblemWrite[];
} {
  const result: PublishProblemBankResult = {
    totalCount: rows.length,
    publishedCount: 0,
    skippedCount: 0,
  };
  const writes: PreparedPublishProblemWrite[] = [];

  for (const row of rows) {
    const normalizedDraft = normalizeDraftForPersistence(buildPublishDraftFromRow(row), row.order);
    const conceptTags = normalizeProblemConceptTags({
      courseId: row.courseId ?? row.notebook?.courseId ?? null,
      notebookId: row.notebookId,
      notebookName: row.notebook?.name,
      title: normalizedDraft.title,
      type: normalizedDraft.type,
      tags: normalizedDraft.tags,
      difficulty: normalizedDraft.difficulty,
      publicContent: normalizedDraft.publicContent,
      sourceMeta: normalizedDraft.sourceMeta,
    });
    if (normalizedDraft.status === 'published') {
      if (row.status !== 'published') result.publishedCount += 1;
    } else {
      result.skippedCount += 1;
    }

    writes.push({
      id: row.id,
      status: normalizedDraft.status,
      tags: conceptTags,
      publicContentJson: toPrismaJson(normalizedDraft.publicContent),
      gradingJson: toPrismaJson(normalizedDraft.grading),
      sourceMeta: toPrismaNullableJson(normalizedDraft.sourceMeta),
      secretJudgeJson: normalizedDraft.secretJudge
        ? toPrismaJson(normalizedDraft.secretJudge)
        : undefined,
    });
  }

  return { result, writes };
}

async function writePreparedProblemPublishBatch(writes: PreparedPublishProblemWrite[]) {
  const operations: Prisma.PrismaPromise<unknown>[] = [];

  for (const write of writes) {
    operations.push(
      prismaDb.notebookProblem.update({
        where: { id: write.id },
        data: {
          status: write.status,
          tags: write.tags,
          publicContentJson: write.publicContentJson,
          gradingJson: write.gradingJson,
          sourceMeta: write.sourceMeta,
        },
      }),
    );

    if (write.secretJudgeJson) {
      operations.push(
        prismaDb.notebookProblemSecret.upsert({
          where: { problemId: write.id },
          create: {
            problemId: write.id,
            secretJudgeJson: write.secretJudgeJson,
          },
          update: {
            secretJudgeJson: write.secretJudgeJson,
          },
        }),
      );
    }
  }

  if (operations.length > 0) {
    await prismaDb.$transaction(operations);
  }
}

async function publishPreparedProblemWrites(writes: PreparedPublishProblemWrite[]) {
  for (let index = 0; index < writes.length; index += PUBLISH_PROBLEM_WRITE_BATCH_SIZE) {
    await writePreparedProblemPublishBatch(
      writes.slice(index, index + PUBLISH_PROBLEM_WRITE_BATCH_SIZE),
    );
  }
}

function mapSceneRowToScene(row: {
  id: string;
  notebookId: string;
  title: string;
  type: string;
  order: number;
  content: unknown;
  actions: unknown;
  whiteboard: unknown;
  createdAt: Date;
  updatedAt: Date;
}): Scene {
  return {
    id: row.id,
    stageId: row.notebookId,
    title: row.title,
    type: row.type as Scene['type'],
    order: row.order,
    content: row.content as Scene['content'],
    actions: (row.actions ?? undefined) as Scene['actions'],
    whiteboards: (row.whiteboard ?? undefined) as Scene['whiteboards'],
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

async function requireNotebookOwnership(
  userId: string,
  notebookId: string,
): Promise<OwnedNotebook> {
  const notebook = await prisma.notebook.findFirst({
    where: { id: notebookId, ownerId: userId },
    select: { id: true, name: true, courseId: true },
  });
  if (!notebook) {
    throw new Error('Notebook not found');
  }
  return notebook;
}

async function requireNotebookReadAccess(
  userId: string,
  notebookId: string,
): Promise<ReadableNotebook> {
  const notebook = await prisma.notebook.findFirst({
    where: { id: notebookId },
    select: { id: true, name: true, courseId: true, ownerId: true },
  });
  if (!notebook) {
    throw new Error('Notebook not found');
  }
  if (notebook.ownerId === userId) {
    return {
      id: notebook.id,
      name: notebook.name,
      courseId: notebook.courseId,
      accessRole: 'owner',
    };
  }
  if (!notebook.courseId) {
    throw new Error('Notebook not found');
  }
  const courseAccessRole = await findCourseAccessRole(prisma, userId, notebook.courseId);
  if (!courseAccessRole) {
    throw new Error('Notebook not found');
  }
  return {
    id: notebook.id,
    name: notebook.name,
    courseId: notebook.courseId,
    accessRole: courseAccessRole,
  };
}

async function requireCourseOwnership(userId: string, courseId: string): Promise<OwnedCourse> {
  const course = await prisma.course.findFirst({
    where: { id: courseId, ownerId: userId },
    select: { id: true, name: true },
  });
  if (!course) {
    throw new Error('Course not found');
  }
  return course;
}

async function requireCourseReadAccess(
  userId: string,
  courseId: string,
): Promise<CourseAccessRole> {
  const accessRole = await findCourseAccessRole(prisma, userId, courseId);
  if (!accessRole) {
    throw new Error('Course not found');
  }
  return accessRole;
}

async function listOwnedCourseNotebooks(
  userId: string,
  courseId: string,
): Promise<OwnedNotebook[]> {
  return prisma.notebook.findMany({
    where: { ownerId: userId, courseId },
    orderBy: [{ updatedAt: 'desc' }],
    select: { id: true, name: true, courseId: true },
  });
}

function normalizeDraftForPersistence(
  draftInput: NotebookProblemImportDraft,
  order: number,
): NotebookProblemImportDraft {
  const draft = notebookProblemImportDraftSchema.parse(draftInput);
  const isCode = draft.type === 'code';
  const hasSecretTests = (draft.secretJudge?.secretTests?.length ?? 0) > 0;
  const hasFunctionSignature =
    draft.publicContent.type === 'code'
      ? Boolean(draft.publicContent.functionSignature?.trim())
      : true;
  const hasPublicTests =
    draft.publicContent.type === 'code' ? (draft.publicContent.publicTests?.length ?? 0) > 0 : true;
  const publishRequirementsMet =
    !isCode || (hasSecretTests && hasFunctionSignature && hasPublicTests);

  return {
    ...draft,
    status:
      draft.status === 'archived' ? 'archived' : publishRequirementsMet ? draft.status : 'draft',
    publicContent:
      isCode && draft.publicContent.type === 'code'
        ? {
            ...draft.publicContent,
            secretConfigPresent: hasSecretTests,
          }
        : draft.publicContent,
    grading:
      isCode && draft.grading.type === 'code'
        ? {
            ...draft.grading,
            publishRequirementsMet,
          }
        : draft.grading,
    sourceMeta: {
      ...draft.sourceMeta,
      normalizedOrder: order,
    },
    validationErrors: [
      ...draft.validationErrors,
      ...(isCode && !hasFunctionSignature ? ['缺少 function signature'] : []),
      ...(isCode && !hasPublicTests ? ['缺少 public tests'] : []),
      ...(isCode && !hasSecretTests ? ['缺少 secret tests'] : []),
    ],
  };
}

async function createProblemFromDraftTx(args: {
  tx: Prisma.TransactionClient;
  courseId?: string | null;
  notebookId?: string | null;
  draft: NotebookProblemImportDraft;
  order: number;
  problemNumber?: number | null;
}) {
  const normalized = normalizeDraftForPersistence(args.draft, args.order);
  const conceptTags = normalizeProblemConceptTags({
    courseId: args.courseId,
    notebookId: args.notebookId,
    title: normalized.title,
    type: normalized.type,
    tags: normalized.tags,
    difficulty: normalized.difficulty,
    publicContent: normalized.publicContent,
    sourceMeta: normalized.sourceMeta,
  });
  const created = await args.tx.notebookProblem.create({
    data: {
      title: normalized.title,
      type: normalized.type,
      status: normalized.status,
      source: normalized.source,
      order: args.order,
      problemNumber: args.problemNumber ?? null,
      points: normalized.points,
      tags: conceptTags,
      difficulty: normalized.difficulty,
      publicContentJson: toPrismaJson(normalized.publicContent),
      gradingJson: toPrismaJson(normalized.grading),
      sourceMeta: toPrismaNullableJson(normalized.sourceMeta),
      dedupeKey: args.courseId ? courseProblemDedupeKey(normalized) : null,
      courseId: args.courseId ?? null,
      notebookId: args.notebookId ?? null,
    },
  });

  if (normalized.secretJudge) {
    await args.tx.notebookProblemSecret.create({
      data: {
        problemId: created.id,
        secretJudgeJson: toPrismaJson(normalized.secretJudge),
      },
    });
  }

  return created;
}

async function ensureCourseProblemDedupeStateTx(
  tx: Prisma.TransactionClient,
  courseId: string,
): Promise<Map<string, string>> {
  await tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "locked"',
    `course-problem-dedupe:${courseId}`,
  );

  // Normalize legacy notebook-scoped rows into their effective course before
  // claiming keys. This preserves every problem while making the database
  // uniqueness constraint cover old and new imports through the same path.
  await tx.$executeRaw`
    UPDATE "NotebookProblem" AS problem
    SET "courseId" = notebook."courseId"
    FROM "Notebook" AS notebook
    WHERE problem."courseId" IS NULL
      AND problem."notebookId" = notebook."id"
      AND notebook."courseId" = ${courseId}
  `;

  const rows = await tx.notebookProblem.findMany({
    where: { courseId },
    select: {
      id: true,
      title: true,
      type: true,
      publicContentJson: true,
      dedupeKey: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const desiredKeyByProblemId = new Map<string, string>();
  for (const row of rows) {
    const parsedContent = notebookProblemPublicContentSchema.safeParse(row.publicContentJson);
    if (!parsedContent.success) continue;
    desiredKeyByProblemId.set(
      row.id,
      courseProblemDedupeKey({
        title: row.title,
        type: row.type,
        publicContent: parsedContent.data,
      }),
    );
  }

  // A fingerprint contract upgrade must not strand old-version keys. Clear
  // the course in one locked transaction, then let the oldest canonical row
  // claim each new key. Counts and problem IDs are never changed.
  const requiresKeyRebuild = rows.some(
    (row) =>
      Boolean(row.dedupeKey) && row.dedupeKey !== (desiredKeyByProblemId.get(row.id) ?? null),
  );
  if (requiresKeyRebuild) {
    await tx.notebookProblem.updateMany({
      where: { courseId },
      data: { dedupeKey: null },
    });
  }

  const problemIdByKey = new Map<string, string>();
  if (!requiresKeyRebuild) {
    for (const row of rows) {
      if (row.dedupeKey && !problemIdByKey.has(row.dedupeKey)) {
        problemIdByKey.set(row.dedupeKey, row.id);
      }
    }
  }

  for (const row of rows) {
    const dedupeKey = desiredKeyByProblemId.get(row.id);
    if (!dedupeKey || problemIdByKey.has(dedupeKey)) continue;
    if (!requiresKeyRebuild && row.dedupeKey) {
      problemIdByKey.set(row.dedupeKey, row.id);
      continue;
    }
    const claimed = await tx.notebookProblem.updateMany({
      where: {
        id: row.id,
        courseId,
        ...(requiresKeyRebuild ? {} : { dedupeKey: null }),
      },
      data: { dedupeKey },
    });
    if (claimed.count === 1) problemIdByKey.set(dedupeKey, row.id);
  }

  return problemIdByKey;
}

async function refreshNotebookProblemSummaryFieldsTx(
  tx: Prisma.TransactionClient,
  notebookIds: string[],
  now: Date,
) {
  for (const notebookId of notebookIds) {
    const [problemCount, publishedProblemCount] = await Promise.all([
      tx.notebookProblem.count({ where: { notebookId } }),
      tx.notebookProblem.count({ where: { notebookId, status: 'published' } }),
    ]);
    await tx.notebook.updateMany({
      where: { id: notebookId },
      data: {
        problemCount,
        publishedProblemCount,
        updatedAt: now,
      },
    });
  }
}

async function refreshNotebookProblemSummaryFields(notebookIds: string[], now: Date) {
  for (const notebookId of notebookIds) {
    const [problemCount, publishedProblemCount] = await Promise.all([
      prismaDb.notebookProblem.count({ where: { notebookId } }),
      prismaDb.notebookProblem.count({ where: { notebookId, status: 'published' } }),
    ]);
    await prismaDb.notebook.updateMany({
      where: { id: notebookId },
      data: {
        problemCount,
        publishedProblemCount,
        updatedAt: now,
      },
    });
  }
}

async function touchOwnersAfterProblemWriteTx(args: {
  tx: Prisma.TransactionClient;
  courseId?: string | null;
  notebookIds?: Array<string | null | undefined>;
}) {
  const now = new Date();
  const notebookIds = Array.from(
    new Set((args.notebookIds ?? []).filter((value): value is string => Boolean(value))),
  );
  if (notebookIds.length > 0) {
    await refreshNotebookProblemSummaryFieldsTx(args.tx, notebookIds, now);
  }

  if (args.courseId) {
    await refreshCourseSummaryFields(args.tx, args.courseId);
  }
}

async function touchOwnersAfterProblemWrite(args: {
  courseId?: string | null;
  notebookIds?: Array<string | null | undefined>;
}) {
  const now = new Date();
  const notebookIds = Array.from(
    new Set((args.notebookIds ?? []).filter((value): value is string => Boolean(value))),
  );
  if (notebookIds.length > 0) {
    await refreshNotebookProblemSummaryFields(notebookIds, now);
  }

  if (args.courseId) {
    await refreshCourseSummaryFields(prismaDb, args.courseId);
  }
}

function normalizeAssignedNotebookId(
  rawNotebookId: string | null | undefined,
  allowedNotebookIds: Set<string>,
): string | null {
  const notebookId = rawNotebookId?.trim();
  if (!notebookId) return null;
  return allowedNotebookIds.has(notebookId) ? notebookId : null;
}

function draftWithImportBatchId(
  draft: NotebookProblemImportDraft,
  importBatchId?: string | null,
): NotebookProblemImportDraft {
  const batchId = importBatchId?.trim();
  if (!batchId) return draft;
  return {
    ...draft,
    sourceMeta: {
      ...draft.sourceMeta,
      importBatchId: batchId,
    },
  };
}

async function assertProblemImportBatchCommitLeaseTx(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    importBatchId?: string | null;
    importBatchLeaseToken?: string | null;
  },
): Promise<void> {
  const importBatchId = args.importBatchId?.trim();
  const leaseToken = args.importBatchLeaseToken?.trim();
  if (!importBatchId || !leaseToken) return;

  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "ProblemImportBatch"
    WHERE "id" = ${importBatchId}
      AND "ownerId" = ${args.userId}
      AND "status" = 'committing'
      AND "commitLeaseToken" = ${leaseToken}
      AND "commitLeaseExpiresAt" > CURRENT_TIMESTAMP
    FOR UPDATE
  `;
  if (rows.length !== 1) {
    throw new Error('Problem import batch commit lease was lost before problem persistence');
  }
}

async function recordProblemImportBatchPersistedCountTx(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    importBatchId?: string | null;
    importBatchLeaseToken?: string | null;
    persistedCount: number;
    writeSummary: ProblemDraftWriteSummary;
  },
): Promise<void> {
  const importBatchId = args.importBatchId?.trim();
  const leaseToken = args.importBatchLeaseToken?.trim();
  if (!importBatchId || !leaseToken) return;

  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    UPDATE "ProblemImportBatch"
    SET "committedCount" = ${args.persistedCount},
        "commitResultJson" = CAST(${JSON.stringify(args.writeSummary)} AS JSONB),
        "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = ${importBatchId}
      AND "ownerId" = ${args.userId}
      AND "status" = 'committing'
      AND "commitLeaseToken" = ${leaseToken}
      AND "commitLeaseExpiresAt" > CURRENT_TIMESTAMP
    RETURNING "id"
  `;
  if (rows.length !== 1) {
    throw new Error('Problem import batch persisted-count fence was lost');
  }
}

async function listLatestAttemptsForUser(
  userId: string,
  problemIds: string[],
): Promise<Map<string, ProblemAttemptRow>> {
  if (problemIds.length === 0) return new Map<string, ProblemAttemptRow>();

  const progressRows = await prismaDb.notebookProblemProgress.findMany({
    where: {
      userId,
      problemId: { in: problemIds },
    },
    select: {
      problemId: true,
      latestAttemptId: true,
    },
  });

  const latestAttemptIds = progressRows
    .map((row) => row.latestAttemptId)
    .filter((id): id is string => Boolean(id));
  const attemptsById =
    latestAttemptIds.length > 0
      ? new Map(
          (
            (await prismaDb.notebookProblemAttempt.findMany({
              where: { id: { in: latestAttemptIds } },
            })) as unknown as ProblemAttemptRow[]
          ).map((attempt) => [attempt.id, attempt] as const),
        )
      : new Map<string, ProblemAttemptRow>();

  const latestByProblemId = new Map<string, ProblemAttemptRow>();
  for (const row of progressRows) {
    const attempt = row.latestAttemptId ? attemptsById.get(row.latestAttemptId) : null;
    if (attempt) latestByProblemId.set(row.problemId, attempt);
  }

  const missingProblemIds = problemIds.filter((problemId) => !latestByProblemId.has(problemId));
  if (missingProblemIds.length === 0) return latestByProblemId;

  const attempts = (await prismaDb.notebookProblemAttempt.findMany({
    where: {
      userId,
      problemId: { in: missingProblemIds },
    },
    orderBy: [{ createdAt: 'desc' }],
  })) as unknown as ProblemAttemptRow[];

  for (const attempt of attempts) {
    if (!latestByProblemId.has(attempt.problemId)) {
      latestByProblemId.set(attempt.problemId, attempt);
    }
  }
  return latestByProblemId;
}

function courseProblemNumberScopeWhere(
  courseId: string,
  notebookIds: string[],
): Prisma.NotebookProblemWhereInput {
  return notebookIds.length > 0
    ? {
        OR: [{ courseId }, { notebookId: { in: notebookIds } }],
      }
    : { courseId };
}

function notebookProblemNumberScopeWhere(notebookId: string): Prisma.NotebookProblemWhereInput {
  return { notebookId };
}

async function assignMissingProblemNumbersTx(
  tx: Prisma.TransactionClient,
  where: Prisma.NotebookProblemWhereInput,
): Promise<void> {
  const rows = await tx.notebookProblem.findMany({
    where,
    select: {
      id: true,
      order: true,
      problemNumber: true,
      createdAt: true,
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });

  const usedNumbers = new Set<number>();
  const rowsNeedingNumber: typeof rows = [];
  for (const row of rows) {
    if (
      typeof row.problemNumber === 'number' &&
      row.problemNumber > 0 &&
      !usedNumbers.has(row.problemNumber)
    ) {
      usedNumbers.add(row.problemNumber);
      continue;
    }
    rowsNeedingNumber.push(row);
  }

  let nextNumber = 1;
  const assignments: Array<{ id: string; problemNumber: number }> = [];
  for (const row of rowsNeedingNumber) {
    while (usedNumbers.has(nextNumber)) nextNumber += 1;
    assignments.push({ id: row.id, problemNumber: nextNumber });
    usedNumbers.add(nextNumber);
  }
  if (assignments.length === 0) return;

  await tx.$executeRaw`
    UPDATE "NotebookProblem" AS p
    SET "problemNumber" = v."problemNumber"
    FROM (
      VALUES ${Prisma.join(
        assignments.map(
          (assignment) => Prisma.sql`(${assignment.id}, ${assignment.problemNumber})`,
        ),
      )}
    ) AS v("id", "problemNumber")
    WHERE p."id" = v."id"
  `;
}

async function ensureProblemNumbersBackfilled(
  where: Prisma.NotebookProblemWhereInput,
): Promise<void> {
  await prismaDb.$transaction(async (tx: Prisma.TransactionClient) => {
    await assignMissingProblemNumbersTx(tx, where);
  });
}

async function nextProblemNumberForScopeTx(
  tx: Prisma.TransactionClient,
  where: Prisma.NotebookProblemWhereInput,
): Promise<number> {
  await assignMissingProblemNumbersTx(tx, where);
  const aggregate = await tx.notebookProblem.aggregate({
    where,
    _max: { problemNumber: true },
  });
  return (aggregate._max.problemNumber ?? 0) + 1;
}

async function loadProblemsWithNotebook(args: {
  where: Prisma.NotebookProblemWhereInput;
  includeSecret?: boolean;
  latestAttemptUserId?: string;
}): Promise<ProblemRow[]> {
  return (await prismaDb.notebookProblem.findMany({
    where: args.where,
    include: {
      notebook: {
        select: {
          id: true,
          name: true,
          courseId: true,
        },
      },
      ...(args.includeSecret ? { secret: true } : {}),
      ...(args.latestAttemptUserId
        ? {
            progress: {
              where: { userId: args.latestAttemptUserId },
              take: 1,
              select: {
                status: true,
                score: true,
                lastAttemptAt: true,
                latestAttempt: {
                  select: {
                    id: true,
                    createdAt: true,
                  },
                },
              },
            },
          }
        : {}),
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })) as unknown as ProblemRow[];
}

async function loadCourseProblemsForUserFast(args: {
  userId: string;
  courseId: string;
}): Promise<NotebookProblemSummaryForUser[]> {
  const rows = await withCourseEnrollmentSchemaFallback(
    prismaDb,
    () =>
      prismaDb.$queryRaw<FlatCourseProblemRow[]>`
      SELECT
        p."id",
        p."courseId",
        p."notebookId",
        p."title",
        p."type"::text AS "type",
        p."status"::text AS "status",
        p."source"::text AS "source",
        p."order",
        p."problemNumber",
        p."points",
        p."tags",
        p."difficulty"::text AS "difficulty",
        p."publicContentJson",
        p."gradingJson",
        p."sourceMeta",
        p."createdAt",
        p."updatedAt",
        n."name" AS "notebookName",
        n."courseId" AS "notebookCourseId",
        CASE
          WHEN (
            (
              NOT EXISTS (SELECT 1 FROM "ExternalCourseBinding" b WHERE b."courseId" = c."id")
              AND c."ownerId" = ${args.userId}
            )
            OR EXISTS (
              SELECT 1
              FROM "ExternalCourseBinding" b
              JOIN "ExternalCourseMembership" m ON m."bindingId" = b."id"
              WHERE b."courseId" = c."id"
                AND m."userId" = ${args.userId}
                AND m."role" = 'TEACHER'::"ExternalCourseMemberRole"
                AND m."active" = true
            )
          ) THEN s."secretJudgeJson"
          ELSE NULL
        END AS "secretJudgeJson",
        a."id" AS "latestAttemptId",
        g."status"::text AS "latestAttemptStatus",
        g."score" AS "latestAttemptScore",
        COALESCE(g."lastAttemptAt", a."createdAt") AS "latestAttemptCreatedAt"
      FROM "NotebookProblem" p
      JOIN "Course" c ON c."id" = p."courseId"
      LEFT JOIN "Notebook" n ON n."id" = p."notebookId"
      LEFT JOIN "NotebookProblemSecret" s ON s."problemId" = p."id"
      LEFT JOIN "NotebookProblemProgress" g
        ON g."problemId" = p."id" AND g."userId" = ${args.userId}
      LEFT JOIN "NotebookProblemAttempt" a ON a."id" = g."latestAttemptId"
      WHERE p."courseId" = ${args.courseId}
        AND (
          (
            NOT EXISTS (SELECT 1 FROM "ExternalCourseBinding" b WHERE b."courseId" = c."id")
            AND c."ownerId" = ${args.userId}
          )
          OR EXISTS (
            SELECT 1
            FROM "ExternalCourseBinding" b
            JOIN "ExternalCourseMembership" m ON m."bindingId" = b."id"
            WHERE b."courseId" = c."id"
              AND m."userId" = ${args.userId}
              AND m."role" = 'TEACHER'::"ExternalCourseMemberRole"
              AND m."active" = true
          )
          OR EXISTS (
            SELECT 1
            FROM "CourseEnrollment" e
            WHERE e."courseId" = c."id" AND e."userId" = ${args.userId}
              AND (
                NOT EXISTS (
                  SELECT 1 FROM "ExternalCourseBinding" b WHERE b."courseId" = c."id"
                )
                OR EXISTS (
                  SELECT 1
                  FROM "ExternalCourseBinding" b
                  JOIN "ExternalCourseMembership" m ON m."bindingId" = b."id"
                  WHERE b."courseId" = c."id"
                    AND m."userId" = ${args.userId}
                    AND m."role" = 'STUDENT'::"ExternalCourseMemberRole"
                    AND m."active" = true
                )
              )
          )
          OR EXISTS (
            SELECT 1
            FROM "CoursePurchase" cp
            WHERE cp."sourceCourseId" = c."id" AND cp."buyerId" = ${args.userId}
          )
        )
      ORDER BY p."order" ASC, p."createdAt" ASC
    `,
  );

  return rows.map((row) =>
    mapProblemRow(
      {
        id: row.id,
        courseId: row.courseId,
        notebookId: row.notebookId,
        title: row.title,
        type: row.type,
        status: row.status,
        source: row.source,
        order: row.order,
        problemNumber: row.problemNumber,
        points: row.points,
        tags: row.tags,
        difficulty: row.difficulty,
        publicContentJson: row.publicContentJson,
        gradingJson: row.gradingJson,
        sourceMeta: row.sourceMeta,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        notebook:
          row.notebookId && row.notebookName
            ? {
                id: row.notebookId,
                name: row.notebookName,
                courseId: row.notebookCourseId,
              }
            : null,
        secret: row.secretJudgeJson ? { secretJudgeJson: row.secretJudgeJson } : null,
      },
      row.latestAttemptId && row.latestAttemptStatus && row.latestAttemptCreatedAt
        ? {
            id: row.latestAttemptId,
            status: row.latestAttemptStatus,
            score: row.latestAttemptScore,
            createdAt: row.latestAttemptCreatedAt,
          }
        : null,
    ),
  );
}

function reviewProblemTargetAccessSql(args: {
  userId: string;
  targetType: 'course' | 'notebook';
  targetId: string;
}): Prisma.Sql {
  return Prisma.sql`
    (
      (
        CAST(${args.targetType} AS TEXT) = 'course'
        AND c."id" = ${args.targetId}
      )
      OR (
        CAST(${args.targetType} AS TEXT) = 'notebook'
        AND p."notebookId" = ${args.targetId}
      )
    )
    AND (
      (
        NOT EXISTS (SELECT 1 FROM "ExternalCourseBinding" b WHERE b."courseId" = c."id")
        AND (n."ownerId" = ${args.userId} OR c."ownerId" = ${args.userId})
      )
      OR EXISTS (
        SELECT 1
        FROM "ExternalCourseBinding" b
        JOIN "ExternalCourseMembership" m ON m."bindingId" = b."id"
        WHERE b."courseId" = c."id"
          AND m."userId" = ${args.userId}
          AND m."role" = 'TEACHER'::"ExternalCourseMemberRole"
          AND m."active" = true
      )
      OR EXISTS (
        SELECT 1
        FROM "CourseEnrollment" AS enrollment
        WHERE enrollment."courseId" = c."id"
          AND enrollment."userId" = ${args.userId}
          AND (
            NOT EXISTS (SELECT 1 FROM "ExternalCourseBinding" b WHERE b."courseId" = c."id")
            OR EXISTS (
              SELECT 1
              FROM "ExternalCourseBinding" b
              JOIN "ExternalCourseMembership" m ON m."bindingId" = b."id"
              WHERE b."courseId" = c."id"
                AND m."userId" = ${args.userId}
                AND m."role" = 'STUDENT'::"ExternalCourseMemberRole"
                AND m."active" = true
            )
          )
      )
      OR EXISTS (
        SELECT 1
        FROM "CoursePurchase" AS purchase
        WHERE purchase."sourceCourseId" = c."id"
          AND purchase."buyerId" = ${args.userId}
      )
    )
  `;
}

async function requireReviewProblemTargetAccess(args: {
  userId: string;
  targetType: 'course' | 'notebook';
  targetId: string;
}): Promise<void> {
  if (args.targetType === 'course') {
    await requireCourseReadAccess(args.userId, args.targetId);
    return;
  }
  await requireNotebookReadAccess(args.userId, args.targetId);
}

function mapReviewProblemCandidate(row: ReviewProblemCandidateRow): ReviewProblemCandidate {
  return {
    id: row.id,
    courseId: row.courseId,
    notebookId: row.notebookId,
    notebookName: row.notebookName ?? undefined,
    title: row.title,
    type: row.type as ReviewProblemCandidate['type'],
    status: row.status as ReviewProblemCandidate['status'],
    tags: row.tags ?? [],
    difficulty: row.difficulty as ReviewProblemCandidate['difficulty'],
    searchText: row.searchText ?? '',
    latestAttempt:
      row.latestAttemptId && row.latestAttemptStatus && row.latestAttemptCreatedAt
        ? {
            id: row.latestAttemptId,
            status: row.latestAttemptStatus as NonNullable<
              ReviewProblemCandidate['latestAttempt']
            >['status'],
            score: row.latestAttemptScore,
            createdAt: row.latestAttemptCreatedAt.getTime(),
          }
        : null,
  };
}

function mapReviewProblemDetail(row: ReviewProblemDetailRow): ReviewProblemDetail {
  return {
    id: row.id,
    publicContent: notebookProblemPublicContentSchema.parse(row.publicContentJson),
  };
}

export async function ensureLegacyProblemsBackfilled(
  userId: string,
  notebookId: string,
): Promise<void> {
  const notebook = await requireNotebookOwnership(userId, notebookId);
  const quizScenes = await prismaDb.scene.findMany({
    where: { notebookId, type: 'quiz' },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  const drafts = quizScenes.flatMap((row) =>
    buildLegacyProblemDraftsFromScene(mapSceneRowToScene(row)),
  );
  if (drafts.length === 0) return;

  await prismaDb.$transaction(async (tx: Prisma.TransactionClient) => {
    const existingProblemIdByKey = notebook.courseId
      ? await ensureCourseProblemDedupeStateTx(tx, notebook.courseId)
      : new Map<string, string>();
    await tx.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "locked"',
      `notebook-problem-backfill:${notebookId}`,
    );
    const existingCount = await tx.notebookProblem.count({
      where: { notebookId },
    });
    if (existingCount > 0) return;

    const seenDraftKeys = new Set<string>();
    let insertedCount = 0;
    for (const draft of drafts) {
      const dedupeKey = courseProblemDedupeKey(draft);
      if (seenDraftKeys.has(dedupeKey) || existingProblemIdByKey.has(dedupeKey)) {
        continue;
      }
      seenDraftKeys.add(dedupeKey);
      await createProblemFromDraftTx({
        tx,
        courseId: notebook.courseId,
        notebookId,
        draft,
        order: insertedCount,
      });
      insertedCount += 1;
    }
  });
}

export async function ensureLegacyProblemsBackfilledForCourse(
  userId: string,
  courseId: string,
): Promise<void> {
  await requireCourseOwnership(userId, courseId);
  const notebooks = await listOwnedCourseNotebooks(userId, courseId);
  for (const notebook of notebooks) {
    await ensureLegacyProblemsBackfilled(userId, notebook.id);
  }
}

async function ensureProblemNumbersBackfilledForNotebook(
  userId: string,
  notebookId: string,
): Promise<void> {
  const notebook = await requireNotebookOwnership(userId, notebookId);
  if (notebook.courseId) {
    const notebooks = await listOwnedCourseNotebooks(userId, notebook.courseId);
    await ensureProblemNumbersBackfilled(
      courseProblemNumberScopeWhere(
        notebook.courseId,
        notebooks.map((item) => item.id),
      ),
    );
    return;
  }

  await ensureProblemNumbersBackfilled(notebookProblemNumberScopeWhere(notebookId));
}

async function ensureProblemNumbersBackfilledForCourse(
  userId: string,
  courseId: string,
): Promise<void> {
  await requireCourseOwnership(userId, courseId);
  const notebooks = await listOwnedCourseNotebooks(userId, courseId);
  await ensureProblemNumbersBackfilled(
    courseProblemNumberScopeWhere(
      courseId,
      notebooks.map((notebook) => notebook.id),
    ),
  );
}

export async function listNotebookProblemsForUser(
  userId: string,
  notebookId: string,
): Promise<NotebookProblemSummaryForUser[]> {
  const notebook = await requireNotebookReadAccess(userId, notebookId);
  if (notebook.accessRole === 'owner') {
    await ensureLegacyProblemsBackfilled(userId, notebookId);
    await ensureProblemNumbersBackfilledForNotebook(userId, notebookId);
  }
  const problems = await loadProblemsWithNotebook({
    where: { notebookId },
    includeSecret: notebook.accessRole === 'owner',
  });
  const latestByProblemId = await listLatestAttemptsForUser(
    userId,
    problems.map((problem) => problem.id),
  );
  return problems.map((problem) =>
    mapProblemRow(problem, latestByProblemId.get(problem.id) ?? null),
  );
}

export async function listCourseProblemsForUser(
  userId: string,
  courseId: string,
  options: { skipMaintenance?: boolean } = {},
): Promise<NotebookProblemSummaryForUser[]> {
  if (options.skipMaintenance) {
    const problems = await loadCourseProblemsForUserFast({ userId, courseId });
    if (problems.length === 0) {
      await requireCourseReadAccess(userId, courseId);
    }
    return problems;
  }

  const accessRole = await requireCourseReadAccess(userId, courseId);
  if (accessRole === 'owner') {
    await ensureLegacyProblemsBackfilledForCourse(userId, courseId);
    await ensureProblemNumbersBackfilledForCourse(userId, courseId);
  }

  return loadCourseProblemsForUserFast({ userId, courseId });
}

export async function listCourseProblemsByIdsForUser(
  userId: string,
  courseId: string,
  problemIds: string[],
  options: { skipMaintenance?: boolean } = {},
): Promise<NotebookProblemSummaryForUser[]> {
  const uniqueProblemIds = Array.from(new Set(problemIds.filter(Boolean)));
  if (uniqueProblemIds.length === 0) return [];

  const accessRole = await requireCourseReadAccess(userId, courseId);
  if (accessRole === 'owner' && !options.skipMaintenance) {
    await ensureLegacyProblemsBackfilledForCourse(userId, courseId);
    await ensureProblemNumbersBackfilledForCourse(userId, courseId);
  }
  const problems = await loadProblemsWithNotebook({
    where: {
      id: { in: uniqueProblemIds },
      courseId,
    },
    includeSecret: accessRole === 'owner',
    latestAttemptUserId: userId,
  });
  const byId = new Map(
    problems.map((problem) => [
      problem.id,
      mapProblemRow(problem, latestAttemptFromProgress(problem.progress?.[0])),
    ]),
  );
  return uniqueProblemIds
    .map((problemId) => byId.get(problemId))
    .filter((problem): problem is NotebookProblemSummaryForUser => Boolean(problem));
}

/**
 * Bounded lean projection for evidence-led review planning.
 *
 * This query intentionally excludes every full JSON document and
 * NotebookProblemSecret. It extracts at most 900 public stem characters solely
 * for candidate ranking. The fixed cap covers the maximum 20-question plan plus
 * four fallback candidates without making course size part of request cost.
 */
export async function listReviewProblemCandidatesForUser(args: {
  userId: string;
  targetType: 'course' | 'notebook';
  targetId: string;
  priorityProblemIds?: string[];
  priorityConcepts?: string[];
  priorityContextText?: string;
  limit?: number;
}): Promise<ReviewProblemCandidate[]> {
  const requestedLimit = Number.isFinite(args.limit) ? Math.trunc(args.limit ?? 0) : 0;
  const limit = Math.max(
    1,
    Math.min(requestedLimit || REVIEW_PROBLEM_CANDIDATE_LIMIT, REVIEW_PROBLEM_CANDIDATE_LIMIT),
  );
  const priorityProblemIds = Array.from(
    new Set((args.priorityProblemIds ?? []).map((problemId) => problemId.trim()).filter(Boolean)),
  ).slice(0, REVIEW_PROBLEM_CANDIDATE_LIMIT);
  const priorityConcepts = Array.from(
    new Set(
      (args.priorityConcepts ?? [])
        .map((concept) => concept.normalize('NFKC').trim().toLowerCase())
        .filter(Boolean),
    ),
  ).slice(0, 12);
  const priorityContextText = (args.priorityContextText ?? '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 6000);
  const rows = await withCourseEnrollmentSchemaFallback(prismaDb, () =>
    prismaDb.$queryRaw<ReviewProblemCandidateRow[]>(Prisma.sql`
        WITH preferred AS (
          SELECT item."value" AS "id", item."ordinality"
          FROM jsonb_array_elements_text(
            CAST(${JSON.stringify(priorityProblemIds)} AS JSONB)
          ) WITH ORDINALITY AS item("value", "ordinality")
        ),
        focus AS (
          SELECT item."value" AS "concept"
          FROM jsonb_array_elements_text(
            CAST(${JSON.stringify(priorityConcepts)} AS JSONB)
          ) AS item("value")
        )
        SELECT
          p."id",
          c."id" AS "courseId",
          p."notebookId",
          n."name" AS "notebookName",
          p."title",
          p."type"::text AS "type",
          p."status"::text AS "status",
          p."tags",
          p."difficulty"::text AS "difficulty",
          public_search."searchText",
          attempt."id" AS "latestAttemptId",
          progress."status"::text AS "latestAttemptStatus",
          progress."score" AS "latestAttemptScore",
          COALESCE(progress."lastAttemptAt", attempt."createdAt") AS "latestAttemptCreatedAt"
        FROM "NotebookProblem" AS p
        LEFT JOIN "Notebook" AS n ON n."id" = p."notebookId"
        LEFT JOIN "Course" AS c ON c."id" = COALESCE(p."courseId", n."courseId")
        LEFT JOIN preferred ON preferred."id" = p."id"
        LEFT JOIN LATERAL (
          SELECT LEFT(
            CONCAT_WS(
              E'\n',
              p."publicContentJson"->>'stem',
              p."publicContentJson"#>>'{translations,zh-CN,stem}',
              p."publicContentJson"#>>'{translations,en-US,stem}'
            ),
            900
          ) AS "searchText"
        ) AS public_search ON TRUE
        LEFT JOIN LATERAL (
          SELECT COUNT(DISTINCT hit."signal")::integer AS "matchedConcepts"
          FROM (
            SELECT focus."concept" AS "signal"
            FROM focus
            WHERE
              lower(p."title") LIKE '%' || focus."concept" || '%'
              OR lower(COALESCE(n."name", '')) LIKE '%' || focus."concept" || '%'
              OR lower(public_search."searchText") LIKE '%' || focus."concept" || '%'
              OR EXISTS (
                SELECT 1
                FROM unnest(p."tags") AS problem_tag("value")
                WHERE
                  lower(problem_tag."value") = focus."concept"
                  OR lower(problem_tag."value") LIKE '%' || focus."concept" || '%'
                  OR focus."concept" LIKE '%' || lower(problem_tag."value") || '%'
              )

            UNION ALL

            SELECT lower(problem_tag."value") AS "signal"
            FROM unnest(p."tags") AS problem_tag("value")
            WHERE char_length(problem_tag."value") >= 2
              AND position(
                lower(problem_tag."value")
                IN ${priorityContextText}
              ) > 0

            UNION ALL

            SELECT lower(p."title") AS "signal"
            WHERE char_length(p."title") >= 4
              AND position(lower(p."title") IN ${priorityContextText}) > 0

            UNION ALL

            SELECT lower(n."name") AS "signal"
            WHERE n."name" IS NOT NULL
              AND char_length(n."name") >= 4
              AND position(lower(n."name") IN ${priorityContextText}) > 0
          ) AS hit
        ) AS relevance ON TRUE
        LEFT JOIN "NotebookProblemProgress" AS progress
          ON progress."problemId" = p."id"
          AND progress."userId" = ${args.userId}
        LEFT JOIN "NotebookProblemAttempt" AS attempt
          ON attempt."id" = progress."latestAttemptId"
        WHERE ${reviewProblemTargetAccessSql(args)}
          AND p."status"::text <> 'archived'
        ORDER BY
          (preferred."id" IS NULL) ASC,
          preferred."ordinality" ASC NULLS LAST,
          relevance."matchedConcepts" DESC,
          CASE progress."status"::text
            WHEN 'failed' THEN 0
            WHEN 'partial' THEN 1
            WHEN 'pending' THEN 2
            WHEN 'passed' THEN 4
            ELSE 3
          END ASC,
          CASE p."status"::text WHEN 'published' THEN 0 ELSE 1 END ASC,
          p."order" ASC,
          p."createdAt" ASC,
          p."id" ASC
        LIMIT ${limit}
      `),
  );
  if (rows.length === 0) {
    await requireReviewProblemTargetAccess(args);
  }
  return rows.map(mapReviewProblemCandidate);
}

/**
 * Fetches public question detail only for IDs selected from the lean review
 * candidate set. Grading and secret-judge rows are never joined or returned.
 */
export async function listReviewProblemDetailsByIdsForUser(args: {
  userId: string;
  targetType: 'course' | 'notebook';
  targetId: string;
  problemIds: string[];
}): Promise<ReviewProblemDetail[]> {
  const problemIds = Array.from(
    new Set(args.problemIds.map((problemId) => problemId.trim()).filter(Boolean)),
  ).slice(0, REVIEW_PROBLEM_DETAIL_LIMIT);
  if (problemIds.length === 0) return [];

  const rows = await withCourseEnrollmentSchemaFallback(prismaDb, () =>
    prismaDb.$queryRaw<ReviewProblemDetailRow[]>(Prisma.sql`
        SELECT
          p."id",
          p."publicContentJson"
        FROM "NotebookProblem" AS p
        LEFT JOIN "Notebook" AS n ON n."id" = p."notebookId"
        LEFT JOIN "Course" AS c ON c."id" = COALESCE(p."courseId", n."courseId")
        WHERE p."id" IN (${Prisma.join(problemIds)})
          AND ${reviewProblemTargetAccessSql(args)}
        ORDER BY array_position(ARRAY[${Prisma.join(problemIds)}]::text[], p."id")
      `),
  );
  if (rows.length === 0) {
    await requireReviewProblemTargetAccess(args);
  }
  return rows.map(mapReviewProblemDetail);
}

export async function listCourseProblemSummariesForUser(
  userId: string,
  courseId: string,
  options: { skipMaintenance?: boolean } = {},
): Promise<CourseProblemListSummary[]> {
  const accessRole = await requireCourseReadAccess(userId, courseId);
  if (accessRole === 'owner' && !options.skipMaintenance) {
    await ensureProblemNumbersBackfilledForCourse(userId, courseId);
  }

  const problems = (await prismaDb.notebookProblem.findMany({
    where: { courseId },
    select: {
      id: true,
      courseId: true,
      notebookId: true,
      title: true,
      type: true,
      status: true,
      tags: true,
      difficulty: true,
      updatedAt: true,
      notebook: {
        select: {
          id: true,
          name: true,
          courseId: true,
        },
      },
      progress: {
        where: { userId },
        take: 1,
        select: {
          status: true,
          score: true,
          lastAttemptAt: true,
          latestAttempt: {
            select: {
              id: true,
              createdAt: true,
            },
          },
        },
      },
    },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  })) as unknown as ProblemCourseSummaryRow[];

  return problems.map((problem) => {
    const latestAttempt = latestAttemptFromProgress(problem.progress?.[0]);
    return {
      id: problem.id,
      courseId: problem.courseId ?? problem.notebook?.courseId ?? null,
      notebookId: problem.notebookId,
      notebookName: problem.notebook?.name ?? undefined,
      title: problem.title,
      type: problem.type,
      status: problem.status,
      tags: normalizeProblemConceptTags({
        courseId: problem.courseId ?? problem.notebook?.courseId ?? courseId,
        notebookId: problem.notebookId,
        notebookName: problem.notebook?.name,
        title: problem.title,
        tags: problem.tags ?? [],
      }),
      difficulty: problem.difficulty,
      updatedAt: problem.updatedAt.getTime(),
      latestAttempt: latestAttempt
        ? {
            id: latestAttempt.id,
            status: latestAttempt.status,
            score: latestAttempt.score,
            createdAt: latestAttempt.createdAt.getTime(),
          }
        : null,
    };
  });
}

export async function publishNotebookProblemBankForUser(args: {
  userId: string;
  notebookId: string;
}): Promise<PublishProblemBankResult> {
  const notebook = await requireNotebookOwnership(args.userId, args.notebookId);
  await ensureLegacyProblemsBackfilled(args.userId, args.notebookId);
  await ensureProblemNumbersBackfilledForNotebook(args.userId, args.notebookId);

  const rows = (await prismaDb.notebookProblem.findMany({
    where: {
      notebookId: args.notebookId,
      status: { not: 'archived' },
    },
    include: {
      notebook: {
        select: {
          id: true,
          name: true,
          courseId: true,
        },
      },
      secret: true,
    },
    orderBy: [{ problemNumber: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
  })) as unknown as ProblemWithSecretRow[];

  const prepared = prepareProblemRowsForPublish(rows);
  await publishPreparedProblemWrites(prepared.writes);
  await touchOwnersAfterProblemWrite({
    courseId: notebook.courseId,
    notebookIds: [args.notebookId],
  });
  return prepared.result;
}

export async function publishCourseProblemBankForUser(args: {
  userId: string;
  courseId: string;
}): Promise<PublishProblemBankResult> {
  await requireCourseOwnership(args.userId, args.courseId);
  await ensureLegacyProblemsBackfilledForCourse(args.userId, args.courseId);
  await ensureProblemNumbersBackfilledForCourse(args.userId, args.courseId);
  const notebooks = await listOwnedCourseNotebooks(args.userId, args.courseId);
  const notebookIds = notebooks.map((notebook) => notebook.id);

  const rows = (await prismaDb.notebookProblem.findMany({
    where: {
      status: { not: 'archived' },
      OR:
        notebookIds.length > 0
          ? [{ courseId: args.courseId }, { notebookId: { in: notebookIds } }]
          : [{ courseId: args.courseId }],
    },
    include: {
      notebook: {
        select: {
          id: true,
          name: true,
          courseId: true,
        },
      },
      secret: true,
    },
    orderBy: [{ problemNumber: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
  })) as unknown as ProblemWithSecretRow[];

  const prepared = prepareProblemRowsForPublish(rows);
  await publishPreparedProblemWrites(prepared.writes);
  await touchOwnersAfterProblemWrite({
    courseId: args.courseId,
    notebookIds,
  });
  return prepared.result;
}

export async function getNotebookProblemForUser(
  userId: string,
  notebookId: string,
  problemId: string,
): Promise<{
  problem: NotebookProblemRecord;
  secretJudge?: NotebookProblemSecretJudge;
}> {
  const notebookAccess = await requireNotebookReadAccess(userId, notebookId);
  const canReadSecretJudge = notebookAccess.accessRole === 'owner';
  if (notebookAccess.accessRole === 'owner') {
    await ensureLegacyProblemsBackfilled(userId, notebookId);
    await ensureProblemNumbersBackfilledForNotebook(userId, notebookId);
  }
  const row = (await prismaDb.notebookProblem.findFirst({
    where: { id: problemId, notebookId },
    include: {
      notebook: {
        select: {
          id: true,
          name: true,
          courseId: true,
        },
      },
      secret: true,
    },
  })) as unknown as ProblemWithSecretRow | null;

  if (!row) {
    throw new Error('Problem not found');
  }

  return {
    problem: notebookProblemRecordSchema.parse({
      id: row.id,
      courseId: row.courseId ?? row.notebook?.courseId ?? null,
      notebookId: row.notebookId,
      notebookName: row.notebook?.name ?? undefined,
      title: row.title,
      type: row.type,
      status: row.status,
      source: row.source,
      order: row.order,
      problemNumber: row.problemNumber,
      points: row.points,
      tags: normalizeProblemConceptTags({
        courseId: row.courseId ?? row.notebook?.courseId ?? notebookAccess.courseId,
        notebookId: row.notebookId,
        notebookName: row.notebook?.name,
        title: row.title,
        type: row.type,
        tags: row.tags ?? [],
        difficulty: row.difficulty,
        publicContent: row.publicContentJson,
        sourceMeta: row.sourceMeta ?? {},
      }),
      difficulty: row.difficulty,
      publicContent: row.publicContentJson,
      grading: row.gradingJson,
      sourceMeta: row.sourceMeta ?? {},
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    }),
    secretJudge: canReadSecretJudge
      ? (row.secret?.secretJudgeJson as NotebookProblemSecretJudge | undefined)
      : undefined,
  };
}

export async function getCourseProblemForUser(
  userId: string,
  courseId: string,
  problemId: string,
  options: { skipMaintenance?: boolean } = {},
): Promise<{
  problem: NotebookProblemRecord;
  secretJudge?: NotebookProblemSecretJudge;
}> {
  const accessRole = await requireCourseReadAccess(userId, courseId);
  const canReadSecretJudge = accessRole === 'owner';
  if (accessRole === 'owner' && !options.skipMaintenance) {
    await ensureLegacyProblemsBackfilledForCourse(userId, courseId);
    await ensureProblemNumbersBackfilledForCourse(userId, courseId);
  }
  const row = (await prismaDb.notebookProblem.findFirst({
    where: {
      id: problemId,
      OR: [{ courseId }, { notebook: { courseId } }],
    },
    include: {
      notebook: {
        select: {
          id: true,
          name: true,
          courseId: true,
        },
      },
      secret: true,
    },
  })) as unknown as ProblemWithSecretRow | null;

  if (!row) {
    throw new Error('Problem not found');
  }

  return {
    problem: notebookProblemRecordSchema.parse({
      id: row.id,
      courseId: row.courseId ?? row.notebook?.courseId ?? courseId,
      notebookId: row.notebookId,
      notebookName: row.notebook?.name ?? undefined,
      title: row.title,
      type: row.type,
      status: row.status,
      source: row.source,
      order: row.order,
      problemNumber: row.problemNumber,
      points: row.points,
      tags: normalizeProblemConceptTags({
        courseId: row.courseId ?? row.notebook?.courseId ?? courseId,
        notebookId: row.notebookId,
        notebookName: row.notebook?.name,
        title: row.title,
        type: row.type,
        tags: row.tags ?? [],
        difficulty: row.difficulty,
        publicContent: row.publicContentJson,
        sourceMeta: row.sourceMeta ?? {},
      }),
      difficulty: row.difficulty,
      publicContent: row.publicContentJson,
      grading: row.gradingJson,
      sourceMeta: row.sourceMeta ?? {},
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    }),
    secretJudge: canReadSecretJudge
      ? (row.secret?.secretJudgeJson as NotebookProblemSecretJudge | undefined)
      : undefined,
  };
}

type CreateNotebookProblemsFromDraftsArgs = {
  userId: string;
  notebookId: string;
  drafts: NotebookProblemImportDraft[];
  importBatchId?: string | null;
  importBatchLeaseToken?: string | null;
};

async function createNotebookProblemsFromDraftsInternal(
  args: CreateNotebookProblemsFromDraftsArgs,
): Promise<NotebookProblemDraftWriteResult> {
  const notebook = await requireNotebookOwnership(args.userId, args.notebookId);
  await ensureLegacyProblemsBackfilled(args.userId, args.notebookId);
  const problemNumberScopeWhere = notebook.courseId
    ? courseProblemNumberScopeWhere(
        notebook.courseId,
        (await listOwnedCourseNotebooks(args.userId, notebook.courseId)).map((item) => item.id),
      )
    : notebookProblemNumberScopeWhere(args.notebookId);
  const insertedProblemIds: string[] = [];
  const reusedProblemIds = new Set<string>();
  const skippedDraftIds: string[] = [];
  const reusedDrafts: ProblemDraftWriteSummary['reusedDrafts'] = [];

  await prismaDb.$transaction(
    async (tx: Prisma.TransactionClient) => {
      await assertProblemImportBatchCommitLeaseTx(tx, args);
      const existingProblemIdByKey = notebook.courseId
        ? await ensureCourseProblemDedupeStateTx(tx, notebook.courseId)
        : new Map<string, string>();
      const count = await tx.notebookProblem.count({
        where: { notebookId: args.notebookId },
      });
      const firstProblemNumber = await nextProblemNumberForScopeTx(tx, problemNumberScopeWhere);
      for (let index = 0; index < args.drafts.length; index += 1) {
        const draft = args.drafts[index];
        const dedupeKey = notebook.courseId ? courseProblemDedupeKey(draft) : null;
        const existingProblemId = dedupeKey ? existingProblemIdByKey.get(dedupeKey) : null;
        if (dedupeKey && existingProblemId) {
          reusedProblemIds.add(existingProblemId);
          skippedDraftIds.push(draft.draftId);
          reusedDrafts.push({
            draftId: draft.draftId,
            existingProblemId,
            dedupeKey,
          });
          continue;
        }
        const created = await createProblemFromDraftTx({
          tx,
          courseId: notebook.courseId,
          notebookId: args.notebookId,
          draft: draftWithImportBatchId(draft, args.importBatchId),
          order: count + insertedProblemIds.length,
          problemNumber: firstProblemNumber + insertedProblemIds.length,
        });
        insertedProblemIds.push(created.id);
        if (dedupeKey) existingProblemIdByKey.set(dedupeKey, created.id);
      }
      const writeSummary: ProblemDraftWriteSummary = {
        requestedCount: args.drafts.length,
        insertedProblemIds: [...insertedProblemIds],
        reusedProblemIds: Array.from(reusedProblemIds).sort(),
        skippedDraftIds: [...skippedDraftIds],
        reusedDrafts: [...reusedDrafts],
      };
      await recordProblemImportBatchPersistedCountTx(tx, {
        ...args,
        persistedCount: insertedProblemIds.length,
        writeSummary,
      });
      if (insertedProblemIds.length > 0) {
        await touchOwnersAfterProblemWriteTx({
          tx,
          courseId: notebook.courseId,
          notebookIds: [args.notebookId],
        });
      }
    },
    {
      maxWait: 20_000,
      timeout: 60_000,
    },
  );

  return {
    problems: await listNotebookProblemsForUser(args.userId, args.notebookId),
    writeSummary: {
      requestedCount: args.drafts.length,
      insertedProblemIds,
      reusedProblemIds: Array.from(reusedProblemIds).sort(),
      skippedDraftIds,
      reusedDrafts,
    },
  };
}

export async function createNotebookProblemsFromDrafts(
  args: CreateNotebookProblemsFromDraftsArgs,
): Promise<NotebookProblemSummary[]> {
  return (await createNotebookProblemsFromDraftsInternal(args)).problems;
}

export async function createNotebookProblemsFromDraftsWithSummary(
  args: CreateNotebookProblemsFromDraftsArgs,
): Promise<NotebookProblemDraftWriteResult> {
  return createNotebookProblemsFromDraftsInternal(args);
}

type CreateCourseProblemsFromDraftsArgs = {
  userId: string;
  courseId: string;
  drafts: NotebookProblemImportDraft[];
  importBatchId?: string | null;
  importBatchLeaseToken?: string | null;
  /**
   * Source ingestion already has normalized drafts and only needs to compare
   * their persisted dedupe keys. Other callers retain the legacy full-course
   * repair path by default.
   */
  dedupeReadStrategy?: 'full_course_backfill' | 'indexed_input_keys';
  /** Avoid reloading the complete problem bank when the caller only needs the write summary. */
  returnProblems?: boolean;
};

const INDEXED_DEDUPE_INPUT_LIMIT = 5_000;
const LEGACY_DEDUPE_FALLBACK_LIMIT = 128;

async function loadIndexedCourseProblemDedupeStateTx(args: {
  tx: Prisma.TransactionClient;
  courseId: string;
  notebookIds: string[];
  drafts: NotebookProblemImportDraft[];
}): Promise<Map<string, string>> {
  await args.tx.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "locked"',
    `course-problem-dedupe:${args.courseId}`,
  );
  const requestedKeys = Array.from(
    new Set(args.drafts.map((draft) => courseProblemDedupeKey(draft))),
  );
  if (requestedKeys.length > INDEXED_DEDUPE_INPUT_LIMIT) {
    throw new Error(
      `Problem import contains ${requestedKeys.length} distinct dedupe keys; maximum is ${INDEXED_DEDUPE_INPUT_LIMIT}.`,
    );
  }
  if (requestedKeys.length === 0) return new Map();

  const indexedRows = await args.tx.notebookProblem.findMany({
    where: {
      dedupeKey: { in: requestedKeys },
      OR: [
        { courseId: args.courseId },
        ...(args.notebookIds.length > 0
          ? [{ courseId: null, notebookId: { in: args.notebookIds } }]
          : []),
      ],
    },
    select: { id: true, dedupeKey: true },
    take: INDEXED_DEDUPE_INPUT_LIMIT,
  });
  const problemIdByKey = new Map<string, string>();
  for (const row of indexedRows) {
    if (row.dedupeKey && !problemIdByKey.has(row.dedupeKey)) {
      problemIdByKey.set(row.dedupeKey, row.id);
    }
  }
  if (problemIdByKey.size === requestedKeys.length) return problemIdByKey;

  // A bounded compatibility bridge for pre-dedupeKey rows. Never materialize
  // an unbounded course problem bank merely to compare a small upload.
  const legacyRows = await args.tx.notebookProblem.findMany({
    where: {
      dedupeKey: null,
      OR: [
        { courseId: args.courseId },
        ...(args.notebookIds.length > 0
          ? [{ courseId: null, notebookId: { in: args.notebookIds } }]
          : []),
      ],
    },
    select: {
      id: true,
      title: true,
      type: true,
      publicContentJson: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: LEGACY_DEDUPE_FALLBACK_LIMIT + 1,
  });
  if (legacyRows.length > LEGACY_DEDUPE_FALLBACK_LIMIT) {
    throw new Error(
      `Course has more than ${LEGACY_DEDUPE_FALLBACK_LIMIT} legacy problems without dedupe keys; run the problem dedupe maintenance task before importing.`,
    );
  }
  const requestedKeySet = new Set(requestedKeys);
  for (const row of legacyRows) {
    const parsedContent = notebookProblemPublicContentSchema.safeParse(row.publicContentJson);
    if (!parsedContent.success) continue;
    const dedupeKey = courseProblemDedupeKey({
      title: row.title,
      type: row.type,
      publicContent: parsedContent.data,
    });
    if (requestedKeySet.has(dedupeKey) && !problemIdByKey.has(dedupeKey)) {
      problemIdByKey.set(dedupeKey, row.id);
    }
  }
  return problemIdByKey;
}

async function createCourseProblemsFromDraftsInternal(
  args: CreateCourseProblemsFromDraftsArgs,
): Promise<CourseProblemDraftWriteResult> {
  await requireCourseOwnership(args.userId, args.courseId);
  const dedupeReadStrategy = args.dedupeReadStrategy ?? 'full_course_backfill';
  if (dedupeReadStrategy === 'full_course_backfill') {
    await ensureLegacyProblemsBackfilledForCourse(args.userId, args.courseId);
  }

  const notebooks = await listOwnedCourseNotebooks(args.userId, args.courseId);
  const allowedNotebookIds = new Set(notebooks.map((notebook) => notebook.id));
  const allowedNotebookIdList = Array.from(allowedNotebookIds);
  const problemNumberScopeWhere = courseProblemNumberScopeWhere(
    args.courseId,
    allowedNotebookIdList,
  );
  const insertedProblemIds: string[] = [];
  const reusedProblemIds = new Set<string>();
  const skippedDraftIds: string[] = [];
  const reusedDrafts: ProblemDraftWriteSummary['reusedDrafts'] = [];

  await prismaDb.$transaction(
    async (tx: Prisma.TransactionClient) => {
      await assertProblemImportBatchCommitLeaseTx(tx, args);
      const existingProblemIdByKey =
        dedupeReadStrategy === 'indexed_input_keys'
          ? await loadIndexedCourseProblemDedupeStateTx({
              tx,
              courseId: args.courseId,
              notebookIds: allowedNotebookIdList,
              drafts: args.drafts,
            })
          : await ensureCourseProblemDedupeStateTx(tx, args.courseId);
      const count = await tx.notebookProblem.count({
        where: problemNumberScopeWhere,
      });
      const firstProblemNumber = await nextProblemNumberForScopeTx(tx, problemNumberScopeWhere);
      const touchedNotebookIds = new Set<string>();
      for (let index = 0; index < args.drafts.length; index += 1) {
        const draft = args.drafts[index];
        const notebookId = normalizeAssignedNotebookId(draft.notebookId, allowedNotebookIds);
        const dedupeKey = courseProblemDedupeKey(draft);
        const existingProblemId = existingProblemIdByKey.get(dedupeKey);
        if (existingProblemId) {
          reusedProblemIds.add(existingProblemId);
          skippedDraftIds.push(draft.draftId);
          reusedDrafts.push({
            draftId: draft.draftId,
            existingProblemId,
            dedupeKey,
          });
          continue;
        }
        const created = await createProblemFromDraftTx({
          tx,
          courseId: args.courseId,
          notebookId,
          draft: draftWithImportBatchId({ ...draft, notebookId }, args.importBatchId),
          order: count + insertedProblemIds.length,
          problemNumber: firstProblemNumber + insertedProblemIds.length,
        });
        insertedProblemIds.push(created.id);
        existingProblemIdByKey.set(dedupeKey, created.id);
        if (notebookId) touchedNotebookIds.add(notebookId);
      }
      await recordProblemImportBatchPersistedCountTx(tx, {
        ...args,
        persistedCount: insertedProblemIds.length,
        writeSummary: {
          requestedCount: args.drafts.length,
          insertedProblemIds: [...insertedProblemIds],
          reusedProblemIds: Array.from(reusedProblemIds).sort(),
          skippedDraftIds: [...skippedDraftIds],
          reusedDrafts: [...reusedDrafts],
        },
      });
      if (insertedProblemIds.length > 0) {
        await touchOwnersAfterProblemWriteTx({
          tx,
          courseId: args.courseId,
          notebookIds: Array.from(touchedNotebookIds),
        });
      }
    },
    {
      maxWait: 20_000,
      timeout: 60_000,
    },
  );

  const problems =
    args.returnProblems === false
      ? []
      : await listCourseProblemsForUser(args.userId, args.courseId);
  return {
    problems,
    writeSummary: {
      requestedCount: args.drafts.length,
      insertedProblemIds,
      reusedProblemIds: Array.from(reusedProblemIds).sort(),
      skippedDraftIds,
      reusedDrafts,
    },
  };
}

export async function createCourseProblemsFromDrafts(
  args: CreateCourseProblemsFromDraftsArgs,
): Promise<NotebookProblemSummary[]> {
  return (await createCourseProblemsFromDraftsInternal(args)).problems;
}

export async function createCourseProblemsFromDraftsWithSummary(
  args: CreateCourseProblemsFromDraftsArgs,
): Promise<CourseProblemDraftWriteResult> {
  return createCourseProblemsFromDraftsInternal(args);
}

export async function updateNotebookProblem(args: {
  userId: string;
  notebookId: string;
  problemId: string;
  patch: {
    title?: string;
    status?: string;
    points?: number;
    order?: number;
    tags?: string[];
    difficulty?: string;
    publicContent?: unknown;
    grading?: unknown;
    secretJudge?: unknown | null;
  };
}): Promise<NotebookProblemRecordForOwner> {
  const notebook = await requireNotebookOwnership(args.userId, args.notebookId);
  const current = await getNotebookProblemForUser(args.userId, args.notebookId, args.problemId);

  const publicContent = args.patch.publicContent
    ? notebookProblemPublicContentSchema.parse(args.patch.publicContent)
    : current.problem.publicContent;
  const grading = args.patch.grading
    ? notebookProblemGradingSchema.parse(args.patch.grading)
    : current.problem.grading;
  const status = args.patch.status
    ? notebookProblemStatusSchema.parse(args.patch.status)
    : current.problem.status;
  const difficulty = args.patch.difficulty
    ? notebookProblemDifficultySchema.parse(args.patch.difficulty)
    : current.problem.difficulty;

  const effectiveSecretJudge =
    args.patch.secretJudge === null
      ? undefined
      : args.patch.secretJudge
        ? (args.patch.secretJudge as NotebookProblemSecretJudge)
        : current.secretJudge;

  const normalizedDraft = normalizeDraftForPersistence(
    notebookProblemImportDraftSchema.parse({
      draftId: current.problem.id,
      notebookId: current.problem.notebookId ?? null,
      title: args.patch.title ?? current.problem.title,
      type: current.problem.type,
      status,
      source: current.problem.source,
      points: args.patch.points ?? current.problem.points,
      tags: args.patch.tags ?? current.problem.tags,
      difficulty,
      publicContent,
      grading,
      secretJudge: effectiveSecretJudge,
      sourceMeta: current.problem.sourceMeta,
      validationErrors: [],
    }),
    args.patch.order ?? current.problem.order,
  );
  const conceptTags = normalizeProblemConceptTags({
    courseId: current.problem.courseId,
    notebookId: current.problem.notebookId,
    notebookName: current.problem.notebookName,
    title: normalizedDraft.title,
    type: normalizedDraft.type,
    tags: normalizedDraft.tags,
    difficulty: normalizedDraft.difficulty,
    publicContent: normalizedDraft.publicContent,
    sourceMeta: normalizedDraft.sourceMeta,
  });

  const updated = (await prismaDb.$transaction(async (tx: Prisma.TransactionClient) => {
    const courseId = notebook.courseId ?? current.problem.courseId ?? null;
    const dedupeKey = courseId ? courseProblemDedupeKey(normalizedDraft) : null;
    if (courseId && dedupeKey) {
      const existingProblemId = (await ensureCourseProblemDedupeStateTx(tx, courseId)).get(
        dedupeKey,
      );
      if (existingProblemId && existingProblemId !== args.problemId) {
        throw new DuplicateCourseProblemError(existingProblemId);
      }
    }
    const row = await tx.notebookProblem.update({
      where: { id: args.problemId },
      data: {
        title: normalizedDraft.title,
        status: normalizedDraft.status,
        order: args.patch.order ?? current.problem.order,
        points: normalizedDraft.points,
        tags: conceptTags,
        difficulty: normalizedDraft.difficulty,
        publicContentJson: toPrismaJson(normalizedDraft.publicContent),
        gradingJson: toPrismaJson(normalizedDraft.grading),
        sourceMeta: toPrismaNullableJson(normalizedDraft.sourceMeta),
        dedupeKey,
        ...(courseId ? { courseId } : {}),
      },
      include: {
        notebook: {
          select: {
            id: true,
            name: true,
            courseId: true,
          },
        },
      },
    });

    if (args.patch.secretJudge === null) {
      await tx.notebookProblemSecret.deleteMany({ where: { problemId: args.problemId } });
    } else if (normalizedDraft.secretJudge) {
      await tx.notebookProblemSecret.upsert({
        where: { problemId: args.problemId },
        create: {
          problemId: args.problemId,
          secretJudgeJson: toPrismaJson(normalizedDraft.secretJudge),
        },
        update: {
          secretJudgeJson: toPrismaJson(normalizedDraft.secretJudge),
        },
      });
    }

    await touchOwnersAfterProblemWriteTx({
      tx,
      courseId: notebook.courseId,
      notebookIds: [args.notebookId],
    });
    return row;
  })) as unknown as ProblemRow;

  const problem = notebookProblemRecordSchema.parse({
    id: updated.id,
    courseId: updated.courseId ?? updated.notebook?.courseId ?? notebook.courseId,
    notebookId: updated.notebookId,
    notebookName: updated.notebook?.name ?? undefined,
    title: updated.title,
    type: updated.type,
    status: updated.status,
    source: updated.source,
    order: updated.order,
    problemNumber: updated.problemNumber,
    points: updated.points,
    tags: updated.tags ?? [],
    difficulty: updated.difficulty,
    publicContent: updated.publicContentJson,
    grading: updated.gradingJson,
    sourceMeta: updated.sourceMeta ?? {},
    createdAt: updated.createdAt.getTime(),
    updatedAt: updated.updatedAt.getTime(),
  });

  return normalizedDraft.secretJudge
    ? {
        ...problem,
        secretJudge: normalizedDraft.secretJudge,
      }
    : problem;
}

export async function updateCourseProblem(args: {
  userId: string;
  courseId: string;
  problemId: string;
  patch: {
    notebookId?: string | null;
    title?: string;
    status?: string;
    points?: number;
    order?: number;
    tags?: string[];
    difficulty?: string;
    publicContent?: unknown;
    grading?: unknown;
    secretJudge?: unknown | null;
  };
}): Promise<NotebookProblemRecordForOwner> {
  await requireCourseOwnership(args.userId, args.courseId);
  const notebooks = await listOwnedCourseNotebooks(args.userId, args.courseId);
  const allowedNotebookIds = new Set(notebooks.map((notebook) => notebook.id));
  const current = await getCourseProblemForUser(args.userId, args.courseId, args.problemId);

  const publicContent = args.patch.publicContent
    ? notebookProblemPublicContentSchema.parse(args.patch.publicContent)
    : current.problem.publicContent;
  const grading = args.patch.grading
    ? notebookProblemGradingSchema.parse(args.patch.grading)
    : current.problem.grading;
  const status = args.patch.status
    ? notebookProblemStatusSchema.parse(args.patch.status)
    : current.problem.status;
  const difficulty = args.patch.difficulty
    ? notebookProblemDifficultySchema.parse(args.patch.difficulty)
    : current.problem.difficulty;

  const effectiveSecretJudge =
    args.patch.secretJudge === null
      ? undefined
      : args.patch.secretJudge
        ? (args.patch.secretJudge as NotebookProblemSecretJudge)
        : current.secretJudge;

  const nextNotebookId =
    args.patch.notebookId !== undefined
      ? normalizeAssignedNotebookId(args.patch.notebookId, allowedNotebookIds)
      : (current.problem.notebookId ?? null);

  const normalizedDraft = normalizeDraftForPersistence(
    notebookProblemImportDraftSchema.parse({
      draftId: current.problem.id,
      notebookId: nextNotebookId,
      title: args.patch.title ?? current.problem.title,
      type: current.problem.type,
      status,
      source: current.problem.source,
      points: args.patch.points ?? current.problem.points,
      tags: args.patch.tags ?? current.problem.tags,
      difficulty,
      publicContent,
      grading,
      secretJudge: effectiveSecretJudge,
      sourceMeta: current.problem.sourceMeta,
      validationErrors: [],
    }),
    args.patch.order ?? current.problem.order,
  );
  const conceptTags = normalizeProblemConceptTags({
    courseId: args.courseId,
    notebookId: nextNotebookId,
    notebookName: current.problem.notebookName,
    title: normalizedDraft.title,
    type: normalizedDraft.type,
    tags: normalizedDraft.tags,
    difficulty: normalizedDraft.difficulty,
    publicContent: normalizedDraft.publicContent,
    sourceMeta: normalizedDraft.sourceMeta,
  });

  const updated = (await prismaDb.$transaction(async (tx: Prisma.TransactionClient) => {
    const dedupeKey = courseProblemDedupeKey(normalizedDraft);
    const existingProblemId = (await ensureCourseProblemDedupeStateTx(tx, args.courseId)).get(
      dedupeKey,
    );
    if (existingProblemId && existingProblemId !== args.problemId) {
      throw new DuplicateCourseProblemError(existingProblemId);
    }
    const row = await tx.notebookProblem.update({
      where: { id: args.problemId },
      data: {
        title: normalizedDraft.title,
        status: normalizedDraft.status,
        order: args.patch.order ?? current.problem.order,
        points: normalizedDraft.points,
        tags: conceptTags,
        difficulty: normalizedDraft.difficulty,
        publicContentJson: toPrismaJson(normalizedDraft.publicContent),
        gradingJson: toPrismaJson(normalizedDraft.grading),
        sourceMeta: toPrismaNullableJson(normalizedDraft.sourceMeta),
        dedupeKey,
        courseId: args.courseId,
        notebookId: nextNotebookId,
      },
      include: {
        notebook: {
          select: {
            id: true,
            name: true,
            courseId: true,
          },
        },
      },
    });

    if (args.patch.secretJudge === null) {
      await tx.notebookProblemSecret.deleteMany({ where: { problemId: args.problemId } });
    } else if (normalizedDraft.secretJudge) {
      await tx.notebookProblemSecret.upsert({
        where: { problemId: args.problemId },
        create: {
          problemId: args.problemId,
          secretJudgeJson: toPrismaJson(normalizedDraft.secretJudge),
        },
        update: {
          secretJudgeJson: toPrismaJson(normalizedDraft.secretJudge),
        },
      });
    }

    await touchOwnersAfterProblemWriteTx({
      tx,
      courseId: args.courseId,
      notebookIds: [current.problem.notebookId, nextNotebookId],
    });
    return row;
  })) as unknown as ProblemRow;

  const problem = notebookProblemRecordSchema.parse({
    id: updated.id,
    courseId: updated.courseId ?? updated.notebook?.courseId ?? args.courseId,
    notebookId: updated.notebookId,
    notebookName: updated.notebook?.name ?? undefined,
    title: updated.title,
    type: updated.type,
    status: updated.status,
    source: updated.source,
    order: updated.order,
    problemNumber: updated.problemNumber,
    points: updated.points,
    tags: updated.tags ?? [],
    difficulty: updated.difficulty,
    publicContent: updated.publicContentJson,
    grading: updated.gradingJson,
    sourceMeta: updated.sourceMeta ?? {},
    createdAt: updated.createdAt.getTime(),
    updatedAt: updated.updatedAt.getTime(),
  });

  return normalizedDraft.secretJudge
    ? {
        ...problem,
        secretJudge: normalizedDraft.secretJudge,
      }
    : problem;
}

export async function deleteNotebookProblem(args: {
  userId: string;
  notebookId: string;
  problemId: string;
}): Promise<void> {
  const notebook = await requireNotebookOwnership(args.userId, args.notebookId);
  await getNotebookProblemForUser(args.userId, args.notebookId, args.problemId);

  await prismaDb.$transaction(async (tx: Prisma.TransactionClient) => {
    await tx.notebookProblem.delete({
      where: { id: args.problemId },
    });
    await touchOwnersAfterProblemWriteTx({
      tx,
      courseId: notebook.courseId,
      notebookIds: [args.notebookId],
    });
  });
}

export async function assignUnassignedCourseProblemsToNotebooks(args: {
  userId: string;
  courseId: string;
  assignments: Array<{ problemId: string; notebookId: string }>;
}): Promise<{
  assignedCount: number;
  assignedProblemIds: string[];
  touchedNotebookIds: string[];
}> {
  const accessRole = await findCourseAccessRole(prisma, args.userId, args.courseId);
  if (accessRole !== 'owner') throw new Error('Course not found');

  const notebooks = await prisma.notebook.findMany({
    where: { courseId: args.courseId, removedAt: null },
    select: { id: true },
  });
  const allowedNotebookIds = new Set(notebooks.map((notebook) => notebook.id));
  const problemIdsByNotebook = new Map<string, Set<string>>();
  for (const assignment of args.assignments) {
    const notebookId = assignment.notebookId.trim();
    const problemId = assignment.problemId.trim();
    if (!problemId || !allowedNotebookIds.has(notebookId)) continue;
    const problemIds = problemIdsByNotebook.get(notebookId) ?? new Set<string>();
    problemIds.add(problemId);
    problemIdsByNotebook.set(notebookId, problemIds);
  }
  if (problemIdsByNotebook.size === 0) {
    return { assignedCount: 0, assignedProblemIds: [], touchedNotebookIds: [] };
  }

  return prisma.$transaction(async (tx) => {
    let assignedCount = 0;
    const assignedProblemIds: string[] = [];
    const touchedNotebookIds: string[] = [];
    for (const [notebookId, problemIds] of problemIdsByNotebook) {
      const ids = Array.from(problemIds);
      const existing = await tx.notebookProblem.findMany({
        where: {
          id: { in: ids },
          courseId: args.courseId,
          notebookId: null,
          status: { not: 'archived' },
        },
        select: { id: true },
      });
      if (existing.length === 0) continue;
      const assignableIds = existing.map((problem) => problem.id);
      const result = await tx.notebookProblem.updateMany({
        where: {
          id: { in: assignableIds },
          courseId: args.courseId,
          notebookId: null,
          status: { not: 'archived' },
        },
        data: { notebookId },
      });
      if (result.count <= 0) continue;
      const assigned = await tx.notebookProblem.findMany({
        where: { id: { in: assignableIds }, courseId: args.courseId, notebookId },
        select: { id: true },
      });
      assignedCount += result.count;
      assignedProblemIds.push(...assigned.map((problem) => problem.id));
      touchedNotebookIds.push(notebookId);
    }
    await touchOwnersAfterProblemWriteTx({
      tx,
      courseId: args.courseId,
      notebookIds: touchedNotebookIds,
    });
    return {
      assignedCount,
      assignedProblemIds: Array.from(new Set(assignedProblemIds)),
      touchedNotebookIds: Array.from(new Set(touchedNotebookIds)),
    };
  });
}

export async function deleteCourseProblem(args: {
  userId: string;
  courseId: string;
  problemId: string;
}): Promise<void> {
  await requireCourseOwnership(args.userId, args.courseId);
  const current = await getCourseProblemForUser(args.userId, args.courseId, args.problemId, {
    skipMaintenance: true,
  });
  await prismaDb.notebookProblem.delete({
    where: { id: args.problemId },
  });

  // Summary columns are derived caches. A slow or interrupted remote
  // aggregation must not roll back (or misreport) the primary deletion.
  try {
    await touchOwnersAfterProblemWrite({
      courseId: args.courseId,
      notebookIds: [current.problem.notebookId],
    });
  } catch (error) {
    console.warn('[course-problem-delete] summary refresh failed after deletion', {
      courseId: args.courseId,
      problemId: args.problemId,
      notebookId: current.problem.notebookId,
      error,
    });
  }
}

export async function createNotebookProblemAttempt(args: {
  userId: string;
  problemId: string;
  kind: 'run' | 'submit' | 'answer';
  status: 'pending' | 'passed' | 'failed' | 'partial' | 'error';
  score?: number | null;
  answer: NotebookProblemAttemptAnswer;
  result?: NotebookProblemAttemptResult;
}): Promise<NotebookProblemAttemptRecord> {
  const created = (await prismaDb.$transaction(async (tx: Prisma.TransactionClient) => {
    const attempt = await tx.notebookProblemAttempt.create({
      data: {
        userId: args.userId,
        problemId: args.problemId,
        kind: args.kind,
        status: args.status,
        score: args.score ?? null,
        answerJson: toPrismaJson(args.answer),
        resultJson: args.result ? toPrismaJson(args.result) : undefined,
      },
    });

    await tx.notebookProblemProgress.upsert({
      where: {
        problemId_userId: {
          problemId: args.problemId,
          userId: args.userId,
        },
      },
      update: {
        latestAttemptId: attempt.id,
        status: args.status,
        score: args.score ?? null,
        lastAttemptAt: attempt.createdAt,
        attemptedCount: { increment: 1 },
        ...(args.status === 'passed' ? { passedCount: { increment: 1 } } : {}),
      },
      create: {
        problemId: args.problemId,
        userId: args.userId,
        latestAttemptId: attempt.id,
        status: args.status,
        score: args.score ?? null,
        attemptedCount: 1,
        passedCount: args.status === 'passed' ? 1 : 0,
        lastAttemptAt: attempt.createdAt,
      },
    });

    return attempt;
  })) as unknown as ProblemAttemptRow;

  const attempt = mapAttemptRow(created);

  // Attempt/progress persistence above is the source of truth. Learner-memory
  // projection is deliberately best-effort and runs only after that transaction
  // commits, so an indexing or memory failure can never roll back the answer.
  if (args.kind !== 'run') {
    try {
      const [problemRow, recentRows] = await Promise.all([
        prismaDb.notebookProblem.findUnique({
          where: { id: args.problemId },
          include: {
            notebook: {
              select: {
                id: true,
                name: true,
                courseId: true,
              },
            },
          },
        }) as unknown as Promise<ProblemRow | null>,
        prismaDb.notebookProblemAttempt.findMany({
          where: {
            userId: args.userId,
            problemId: args.problemId,
            kind: { in: ['submit', 'answer'] },
          },
          orderBy: { createdAt: 'desc' },
          take: 30,
        }) as unknown as Promise<ProblemAttemptRow[]>,
      ]);

      if (problemRow) {
        const problem = mapProblemRow(problemRow);
        await maybeWriteProblemAttemptMemorySignal({
          prisma: prismaDb,
          userId: args.userId,
          courseId: problem.courseId,
          notebookId: problem.notebookId,
          problem,
          attempt,
          recentAttempts: recentRows.map(mapAttemptRow),
        });
      }
    } catch (error) {
      console.warn('[notebook-problem-attempt] learner-memory write failed after commit', {
        attemptId: attempt.id,
        problemId: args.problemId,
        userId: args.userId,
        error,
      });
    }
  }

  return attempt;
}

export async function listNotebookProblemAttempts(args: {
  userId: string;
  notebookId: string;
  problemId: string;
}): Promise<NotebookProblemAttemptRecord[]> {
  await getNotebookProblemForUser(args.userId, args.notebookId, args.problemId);
  const rows = (await prismaDb.notebookProblemAttempt.findMany({
    where: {
      userId: args.userId,
      problemId: args.problemId,
    },
    orderBy: { createdAt: 'desc' },
    take: 30,
  })) as unknown as ProblemAttemptRow[];
  return rows.map(mapAttemptRow);
}
