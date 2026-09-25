import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { courseProblemDedupeKey } from '../../features/problems/domain/problem-dedupe';
import {
  notebookProblemDifficultySchema,
  notebookProblemGradingSchema,
  notebookProblemPublicContentSchema,
  notebookProblemTypeSchema,
} from '../problem-bank/schema';

const revisionSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const courseProblemUploadSchema = z
  .object({
    courseId: z.string().trim().min(1),
    changes: z
      .array(
        z
          .object({
            id: z.string().trim().min(1),
            expectedRevision: revisionSchema,
            title: z.string().trim().min(1).max(200).optional(),
            type: notebookProblemTypeSchema.optional(),
            difficulty: notebookProblemDifficultySchema.optional(),
            publicContent: notebookProblemPublicContentSchema.optional(),
            grading: notebookProblemGradingSchema.optional(),
            sourceMeta: z.record(z.string(), z.unknown()).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, change] of value.changes.entries()) {
      if (seen.has(change.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Duplicate problem id',
          path: ['changes', index, 'id'],
        });
      }
      seen.add(change.id);
      if (!Object.keys(change).some((key) => !['id', 'expectedRevision'].includes(key))) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'No replacement fields supplied',
          path: ['changes', index],
        });
      }
    }
  });

export type CourseProblemUpload = z.infer<typeof courseProblemUploadSchema>;

type ProblemSnapshot = {
  id: string;
  courseId: string | null;
  title: string;
  type: string;
  status: string;
  difficulty: string;
  publicContentJson: Prisma.JsonValue;
  gradingJson: Prisma.JsonValue;
  sourceMeta: Prisma.JsonValue | null;
  updatedAt: Date;
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}

export function courseProblemRevision(problem: ProblemSnapshot): string {
  return createHash('sha256')
    .update(
      stableJson({
        id: problem.id,
        courseId: problem.courseId,
        title: problem.title,
        type: problem.type,
        status: problem.status,
        difficulty: problem.difficulty,
        publicContentJson: problem.publicContentJson,
        gradingJson: problem.gradingJson,
        sourceMeta: problem.sourceMeta,
        updatedAt: problem.updatedAt.toISOString(),
      }),
    )
    .digest('hex');
}

function validateChoice(
  content: z.infer<typeof notebookProblemPublicContentSchema>,
  grading: z.infer<typeof notebookProblemGradingSchema>,
) {
  if (content.type !== 'choice' || grading.type !== 'choice') return;
  const optionIds = new Set(content.options.map((option) => option.id));
  const answerIds = grading.correctOptionIds;
  if (
    optionIds.size !== content.options.length ||
    answerIds.length < 1 ||
    new Set(answerIds).size !== answerIds.length ||
    answerIds.some((id) => !optionIds.has(id)) ||
    (content.selectionMode === 'single' && answerIds.length !== 1)
  ) {
    throw new Error('Choice options and correctOptionIds do not form a valid answer');
  }
}

export class CourseProblemUploadConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CourseProblemUploadConflict';
  }
}

type PreparedChange = {
  id: string;
  oldType: string;
  newType: string;
  oldTitle: string;
  newTitle: string;
  revision: string;
  updatedAt: Date;
  data: Prisma.NotebookProblemUpdateManyMutationInput;
};

async function prepareUpload(
  db: PrismaClient | Prisma.TransactionClient,
  upload: CourseProblemUpload,
): Promise<PreparedChange[]> {
  const course = await db.course.findUnique({
    where: { id: upload.courseId },
    select: { id: true },
  });
  if (!course) throw new CourseProblemUploadConflict('Course not found');
  const rows = await db.notebookProblem.findMany({
    where: { courseId: upload.courseId, id: { in: upload.changes.map((item) => item.id) } },
    select: {
      id: true,
      courseId: true,
      title: true,
      type: true,
      status: true,
      difficulty: true,
      publicContentJson: true,
      gradingJson: true,
      sourceMeta: true,
      updatedAt: true,
    },
  });
  const existingAttempts = await db.notebookProblemAttempt.count({
    where: { problemId: { in: upload.changes.map((item) => item.id) } },
  });
  if (existingAttempts > 0) {
    throw new CourseProblemUploadConflict('Problems with student attempts cannot be uploaded');
  }
  const currentById = new Map(rows.map((row) => [row.id, row]));
  const prepared: PreparedChange[] = [];
  for (const change of upload.changes) {
    const current = currentById.get(change.id);
    if (!current) throw new CourseProblemUploadConflict(`Problem not in course: ${change.id}`);
    if (current.status !== 'draft') {
      throw new CourseProblemUploadConflict(`Only draft problems can be uploaded: ${change.id}`);
    }
    const revision = courseProblemRevision(current);
    if (revision !== change.expectedRevision) {
      throw new CourseProblemUploadConflict(`Problem changed since export: ${change.id}`);
    }
    const type = change.type ?? current.type;
    const content = notebookProblemPublicContentSchema.parse(
      change.publicContent ?? current.publicContentJson,
    );
    const grading = notebookProblemGradingSchema.parse(change.grading ?? current.gradingJson);
    if (type !== content.type || type !== grading.type) {
      throw new Error(`Problem type, public content, and grading must match: ${change.id}`);
    }
    validateChoice(content, grading);
    const title = change.title ?? current.title;
    const dedupeKey = courseProblemDedupeKey({ title, type, publicContent: content });
    prepared.push({
      id: change.id,
      oldType: current.type,
      newType: type,
      oldTitle: current.title,
      newTitle: title,
      revision,
      updatedAt: current.updatedAt,
      data: {
        title,
        type: type as Prisma.NotebookProblemUpdateManyMutationInput['type'],
        difficulty: change.difficulty ?? current.difficulty,
        publicContentJson: content as Prisma.InputJsonValue,
        gradingJson: grading as Prisma.InputJsonValue,
        ...(change.sourceMeta === undefined
          ? {}
          : { sourceMeta: change.sourceMeta as Prisma.InputJsonValue }),
        dedupeKey,
      },
    });
  }
  if (new Set(prepared.map((item) => item.data.dedupeKey)).size !== prepared.length) {
    throw new CourseProblemUploadConflict('Upload would create duplicate problems');
  }
  return prepared;
}

export async function previewCourseProblemUpload(db: PrismaClient, input: unknown) {
  const upload = courseProblemUploadSchema.parse(input);
  const prepared = await prepareUpload(db, upload);
  return {
    courseId: upload.courseId,
    count: prepared.length,
    changes: prepared.map(({ id, oldType, newType, oldTitle, newTitle, revision }) => ({
      id,
      oldType,
      newType,
      oldTitle,
      newTitle,
      revision,
    })),
  };
}

export async function applyCourseProblemUpload(db: PrismaClient, input: unknown) {
  const upload = courseProblemUploadSchema.parse(input);
  return db.$transaction(
    async (tx) => {
      const prepared = await prepareUpload(tx, upload);
      for (const change of prepared) {
        const result = await tx.notebookProblem.updateMany({
          where: {
            id: change.id,
            courseId: upload.courseId,
            status: 'draft',
            updatedAt: change.updatedAt,
          },
          data: change.data,
        });
        if (result.count !== 1) {
          throw new CourseProblemUploadConflict(`Concurrent change to problem: ${change.id}`);
        }
      }
      return { courseId: upload.courseId, updated: prepared.map((item) => item.id) };
    },
    { timeout: 60_000 },
  );
}
