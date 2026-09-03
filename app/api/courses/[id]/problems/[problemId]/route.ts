import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { scheduleUnlinkedCourseKnowledgeProjectionSync } from '@/lib/server/unlinked-course-knowledge-projection';
import {
  notebookProblemGradingSchema,
  notebookProblemPublicContentSchema,
} from '@/features/problems';
import {
  deleteCourseProblem,
  DuplicateCourseProblemError,
  getCourseProblemForUser,
  updateCourseProblem,
} from '@/features/problems/server/service';
import { getProblemTagAssignments } from '@/features/problem-tags/server/problem-tag-service';

const updateProblemSchema = z.object({
  notebookId: z.string().trim().min(1).nullable().optional(),
  title: z.string().trim().min(1).max(200).optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  points: z.number().int().min(0).max(1000).optional(),
  order: z.number().int().min(0).optional(),
  tags: z.array(z.string().trim().min(1).max(30)).max(16).optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  publicContent: notebookProblemPublicContentSchema.optional(),
  grading: notebookProblemGradingSchema.optional(),
  secretJudge: z.unknown().nullable().optional(),
});

function toClientProblem(
  problem: Awaited<ReturnType<typeof getCourseProblemForUser>>['problem'],
  secretJudge?: Awaited<ReturnType<typeof getCourseProblemForUser>>['secretJudge'],
  tagAssignments: Awaited<ReturnType<typeof getProblemTagAssignments>> extends Map<string, infer T>
    ? T
    : never = [],
) {
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
    tagAssignments,
    difficulty: problem.difficulty,
    publicContent: problem.publicContent,
    grading: problem.grading,
    sourceMeta: problem.sourceMeta,
    createdAt: problem.createdAt,
    updatedAt: problem.updatedAt,
    ...(secretJudge ? { secretJudge } : {}),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; problemId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id, problemId } = await context.params;
    const url = new URL(request.url);
    const { problem, secretJudge } = await getCourseProblemForUser(auth.userId, id, problemId, {
      // A detail read must stay cheap and side-effect free. Running legacy
      // course-wide maintenance here walks every notebook before loading one
      // already-known problem and can exhaust small database proxy pools.
      // Keep an explicit escape hatch for maintenance/debugging callers.
      skipMaintenance: url.searchParams.get('maintenance') !== '1',
    });
    const assignments = await getProblemTagAssignments(prisma, id, [problem.id]);
    return NextResponse.json({
      problem: toClientProblem(problem, secretJudge, assignments.get(problem.id) || []),
    });
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; problemId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id, problemId } = await context.params;

    const payload = updateProblemSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    let problem: Awaited<ReturnType<typeof updateCourseProblem>>;
    try {
      problem = await updateCourseProblem({
        userId: auth.userId,
        courseId: id,
        problemId,
        patch: payload.data,
      });
    } catch (error) {
      if (error instanceof DuplicateCourseProblemError) {
        return NextResponse.json(
          {
            error: '课程中已经存在相同题目。',
            code: error.code,
            existingProblemId: error.existingProblemId,
          },
          { status: 409 },
        );
      }
      throw error;
    }
    scheduleUnlinkedCourseKnowledgeProjectionSync({
      prisma,
      courseId: id,
      ownerId: auth.userId,
      reason: 'course_problem_updated',
    });
    const assignments = await getProblemTagAssignments(prisma, id, [problem.id]);
    return NextResponse.json({
      problem: toClientProblem(problem, problem.secretJudge, assignments.get(problem.id) || []),
    });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string; problemId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id, problemId } = await context.params;
    await deleteCourseProblem({
      userId: auth.userId,
      courseId: id,
      problemId,
    });
    scheduleUnlinkedCourseKnowledgeProjectionSync({
      prisma,
      courseId: id,
      ownerId: auth.userId,
      reason: 'course_problem_deleted',
    });
    return NextResponse.json({ ok: true });
  });
}
