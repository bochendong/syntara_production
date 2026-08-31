import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  claimProblemImportBatchCommit,
  getProblemImportBatchForTarget,
  hashProblemImportCommitPayload,
  markProblemImportBatchCommitted,
  readProblemImportCommitResult,
  releaseProblemImportBatchCommit,
  type ProblemImportBatchRecord,
  type ProblemImportCommitResult,
} from '@/lib/server/notebook-problems/import-batch-store';
import { notebookProblemImportDraftSchema } from '@/features/problems';
import {
  createCourseProblemsFromDraftsWithSummary,
  listCourseProblemsForUser,
  type ProblemDraftWriteSummary,
} from '@/features/problems/server/service';
import { scheduleUnlinkedCourseKnowledgeProjectionSync } from '@/lib/server/unlinked-course-knowledge-projection';

const commitSchema = z.object({
  drafts: z.array(notebookProblemImportDraftSchema).min(1).max(200),
  importBatchId: z.string().trim().min(1).optional(),
});

function toClientProblem(problem: Awaited<ReturnType<typeof listCourseProblemsForUser>>[number]) {
  return {
    id: problem.id,
    courseId: problem.courseId ?? null,
    notebookId: problem.notebookId,
    notebookName: problem.notebookName,
    title: problem.title,
    type: problem.type,
    status: problem.status,
    source: problem.source,
    order: problem.order,
    problemNumber: problem.problemNumber ?? null,
    points: problem.points,
    tags: problem.tags,
    difficulty: problem.difficulty,
    publicContent: problem.publicContent,
    grading: problem.grading,
    sourceMeta: problem.sourceMeta,
    createdAt: problem.createdAt,
    updatedAt: problem.updatedAt,
    latestAttempt: problem.latestAttempt ?? null,
  };
}

type CourseProblem = Awaited<ReturnType<typeof listCourseProblemsForUser>>[number];

function problemsForImportBatch(problems: CourseProblem[], importBatchId: string) {
  return problems.filter((problem) => {
    const sourceMeta = problem.sourceMeta;
    return (
      sourceMeta !== null &&
      typeof sourceMeta === 'object' &&
      !Array.isArray(sourceMeta) &&
      (sourceMeta as Record<string, unknown>).importBatchId === importBatchId
    );
  });
}

async function readBatchProblemState(userId: string, courseId: string, importBatchId: string) {
  const problems = await listCourseProblemsForUser(userId, courseId, {
    skipMaintenance: true,
  });
  return {
    problems,
    batchProblems: problemsForImportBatch(problems, importBatchId),
  };
}

function committedBatchResponse(
  batch: ProblemImportBatchRecord,
  problems: CourseProblem[],
  batchProblems: CourseProblem[],
  replayed: boolean,
  requestedCount: number,
  writeSummary?: ProblemDraftWriteSummary | ProblemImportCommitResult | null,
) {
  const persistedResult = writeSummary ?? readProblemImportCommitResult(batch);
  const originalRequestedCount = persistedResult?.requestedCount ?? requestedCount;
  const insertedProblemIds =
    persistedResult?.insertedProblemIds ?? batchProblems.map((problem) => problem.id);
  const reusedProblemIds = persistedResult?.reusedProblemIds ?? [];
  const originalInsertedCount = insertedProblemIds.length;
  const reusedCount = persistedResult
    ? reusedProblemIds.length
    : Math.max(0, originalRequestedCount - batchProblems.length);
  const originalSkippedCount = persistedResult?.skippedDraftIds.length ?? reusedCount;
  return NextResponse.json(
    {
      problems: problems.map(toClientProblem),
      import: {
        batchId: batch.id,
        status: 'committed',
        replayed,
        insertedCount: replayed ? 0 : originalInsertedCount,
        persistedInsertedCount: originalInsertedCount,
        reusedCount,
        skippedCount: replayed ? originalRequestedCount : originalSkippedCount,
        problemIds: insertedProblemIds,
        reusedProblemIds,
      },
    },
    { headers: { 'Idempotency-Key': batch.id } },
  );
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id } = await context.params;

    const payload = commitSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const courseLevelDrafts = payload.data.drafts.map((draft) => ({
      ...draft,
      notebookId: null,
      sourceMeta: {
        ...draft.sourceMeta,
        suggestedNotebookId: null,
      },
    }));
    const importBatchId = payload.data.importBatchId?.trim() || null;
    const payloadHash = hashProblemImportCommitPayload(courseLevelDrafts);
    const idempotencyKey = request.headers.get('idempotency-key')?.trim() || null;
    if (idempotencyKey && idempotencyKey !== importBatchId) {
      return NextResponse.json(
        {
          error: 'Idempotency-Key must equal importBatchId',
          code: 'INVALID_IDEMPOTENCY_KEY',
        },
        { status: 400 },
      );
    }
    let importBatch: ProblemImportBatchRecord | null = null;
    if (importBatchId) {
      importBatch = await getProblemImportBatchForTarget({
        prisma,
        userId: auth.userId,
        batchId: importBatchId,
        targetType: 'course',
        courseId: id,
      });
      if (!importBatch) {
        return NextResponse.json({ error: 'Import batch not found' }, { status: 404 });
      }
      if (importBatch.status === 'cancelled') {
        return NextResponse.json(
          { error: 'Import batch was cancelled', code: 'IMPORT_BATCH_CANCELLED' },
          { status: 409 },
        );
      }
      if (importBatch.commitPayloadHash && importBatch.commitPayloadHash !== payloadHash) {
        return NextResponse.json(
          {
            error: 'Idempotency-Key was already used with a different commit payload',
            code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
          },
          { status: 409 },
        );
      }
      if (importBatch.status === 'committed') {
        const state = await readBatchProblemState(auth.userId, id, importBatchId);
        return committedBatchResponse(
          importBatch,
          state.problems,
          state.batchProblems,
          true,
          payload.data.drafts.length,
        );
      }
      if (importBatch.status === 'committing') {
        const state = await readBatchProblemState(auth.userId, id, importBatchId);
        if (state.batchProblems.length === importBatch.committedCount) {
          const committed = await markProblemImportBatchCommitted({
            prisma,
            userId: auth.userId,
            batchId: importBatchId,
            committedCount: state.batchProblems.length,
            leaseToken: importBatch.commitLeaseToken,
          });
          if (!committed) {
            return NextResponse.json(
              { error: 'Import batch reconciliation failed', code: 'IMPORT_BATCH_RETRY' },
              { status: 409, headers: { 'Retry-After': '1' } },
            );
          }
          return committedBatchResponse(
            committed,
            state.problems,
            state.batchProblems,
            true,
            payload.data.drafts.length,
          );
        }
        if (state.batchProblems.length > 0) {
          return NextResponse.json(
            {
              error: 'Import batch has an incomplete persisted result and requires repair',
              code: 'IMPORT_BATCH_PARTIAL_RESULT',
            },
            { status: 409 },
          );
        }
        const reclaimed = await claimProblemImportBatchCommit({
          prisma,
          userId: auth.userId,
          batchId: importBatchId,
          commitCount: courseLevelDrafts.length,
          payloadHash,
        });
        if (!reclaimed) {
          return NextResponse.json(
            {
              error: 'Import batch commit is already in progress',
              code: 'IMPORT_BATCH_COMMITTING',
            },
            { status: 409, headers: { 'Retry-After': '1' } },
          );
        }
        importBatch = reclaimed;
      } else {
        const claimed = await claimProblemImportBatchCommit({
          prisma,
          userId: auth.userId,
          batchId: importBatchId,
          commitCount: courseLevelDrafts.length,
          payloadHash,
        });
        if (!claimed) {
          const latest = await getProblemImportBatchForTarget({
            prisma,
            userId: auth.userId,
            batchId: importBatchId,
            targetType: 'course',
            courseId: id,
          });
          if (latest?.commitPayloadHash && latest.commitPayloadHash !== payloadHash) {
            return NextResponse.json(
              {
                error: 'Idempotency-Key was claimed with a different commit payload',
                code: 'IDEMPOTENCY_PAYLOAD_MISMATCH',
              },
              { status: 409 },
            );
          }
          return NextResponse.json(
            {
              error: 'Import batch was claimed by another request',
              code: 'IMPORT_BATCH_COMMITTING',
            },
            { status: 409, headers: { 'Retry-After': '1' } },
          );
        }
        importBatch = claimed;
      }
    }

    let problems: Awaited<ReturnType<typeof listCourseProblemsForUser>>;
    let writeSummary: ProblemDraftWriteSummary | null = null;
    try {
      const writeResult = await createCourseProblemsFromDraftsWithSummary({
        userId: auth.userId,
        courseId: id,
        drafts: courseLevelDrafts,
        importBatchId,
        importBatchLeaseToken: importBatch?.commitLeaseToken,
      });
      problems = writeResult.problems;
      writeSummary = writeResult.writeSummary;
    } catch (error) {
      if (importBatchId && importBatch) {
        const state = await readBatchProblemState(auth.userId, id, importBatchId).catch(() => ({
          problems: [] as CourseProblem[],
          batchProblems: [] as CourseProblem[],
        }));
        const latestBatch = await getProblemImportBatchForTarget({
          prisma,
          userId: auth.userId,
          batchId: importBatchId,
          targetType: 'course',
          courseId: id,
        }).catch(() => null);
        if (latestBatch && state.batchProblems.length === latestBatch.committedCount) {
          const committed = await markProblemImportBatchCommitted({
            prisma,
            userId: auth.userId,
            batchId: importBatchId,
            committedCount: state.batchProblems.length,
            leaseToken: latestBatch.commitLeaseToken,
          });
          if (committed) {
            return committedBatchResponse(
              committed,
              state.problems,
              state.batchProblems,
              true,
              payload.data.drafts.length,
            );
          }
        }
        if (state.batchProblems.length === 0 && importBatch.commitLeaseToken) {
          await releaseProblemImportBatchCommit({
            prisma,
            userId: auth.userId,
            batchId: importBatchId,
            leaseToken: importBatch.commitLeaseToken,
          });
        }
      }
      throw error;
    }
    let committedProblems = problems;
    let committedImportBatch = importBatch;
    if (importBatchId && importBatch) {
      committedProblems = problemsForImportBatch(problems, importBatchId);
      const committed = await markProblemImportBatchCommitted({
        prisma,
        userId: auth.userId,
        batchId: importBatchId,
        committedCount: committedProblems.length,
        leaseToken: importBatch.commitLeaseToken,
      });
      if (!committed) {
        throw new Error('Import batch commit state could not be persisted');
      }
      committedImportBatch = committed;
    }
    scheduleUnlinkedCourseKnowledgeProjectionSync({
      prisma,
      courseId: id,
      ownerId: auth.userId,
      reason: 'course_problems_imported',
    });
    if (committedImportBatch) {
      return committedBatchResponse(
        committedImportBatch,
        problems,
        committedProblems,
        false,
        payload.data.drafts.length,
        writeSummary,
      );
    }
    return NextResponse.json({
      problems: problems.map(toClientProblem),
      import: writeSummary
        ? {
            status: 'committed',
            replayed: false,
            insertedCount: writeSummary.insertedProblemIds.length,
            reusedCount: writeSummary.reusedProblemIds.length,
            skippedCount: writeSummary.skippedDraftIds.length,
            problemIds: writeSummary.insertedProblemIds,
            reusedProblemIds: writeSummary.reusedProblemIds,
          }
        : null,
    });
  });
}
