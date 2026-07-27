import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  buildNotebookProblemDraftsFromReviewInsertRequest,
  ReviewProblemInsertError,
  reviewProblemInsertRequestSchema,
} from '@/lib/problem-bank/review-problem-insert';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { scheduleUnlinkedCourseKnowledgeProjectionSync } from '@/lib/server/unlinked-course-knowledge-projection';
import {
  createNotebookProblemsFromDraftsWithSummary,
  listNotebookProblemsForUser,
} from '@/features/problems/server/service';

function toClientProblem(problem: Awaited<ReturnType<typeof listNotebookProblemsForUser>>[number]) {
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
    ...(problem.secretJudge ? { secretJudge: problem.secretJudge } : {}),
  };
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const problems = await listNotebookProblemsForUser(auth.userId, id);
    return NextResponse.json({ problems: problems.map(toClientProblem) });
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id } = await context.params;

    const payload = reviewProblemInsertRequestSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    let drafts;
    try {
      drafts = buildNotebookProblemDraftsFromReviewInsertRequest(payload.data);
    } catch (error) {
      const message =
        error instanceof ReviewProblemInsertError || error instanceof z.ZodError
          ? error.message
          : 'Failed to normalize review problems';
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const writeResult = await createNotebookProblemsFromDraftsWithSummary({
      userId: auth.userId,
      notebookId: id,
      drafts,
    });
    const problems = writeResult.problems;
    scheduleUnlinkedCourseKnowledgeProjectionSync({
      prisma,
      courseId: problems[0]?.courseId,
      ownerId: auth.userId,
      reason: 'notebook_problems_created',
    });
    return NextResponse.json(
      {
        insertedCount: writeResult.writeSummary.insertedProblemIds.length,
        reusedCount: writeResult.writeSummary.reusedProblemIds.length,
        skippedCount: writeResult.writeSummary.skippedDraftIds.length,
        insertedProblemIds: writeResult.writeSummary.insertedProblemIds,
        reusedProblemIds: writeResult.writeSummary.reusedProblemIds,
        problems: problems.map(toClientProblem),
      },
      { status: 201 },
    );
  });
}
