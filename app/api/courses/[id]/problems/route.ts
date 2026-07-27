import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  listCourseProblemsByIdsForUser,
  listCourseProblemSummariesForUser,
  listCourseProblemsForUser,
} from '@/features/problems/server/service';

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
    ...(problem.secretJudge ? { secretJudge: problem.secretJudge } : {}),
  };
}

function toClientProblemSummary(
  problem: Awaited<ReturnType<typeof listCourseProblemSummariesForUser>>[number],
) {
  return {
    id: problem.id,
    courseId: problem.courseId ?? null,
    notebookId: problem.notebookId,
    notebookName: problem.notebookName,
    title: problem.title,
    type: problem.type,
    status: problem.status,
    tags: problem.tags,
    difficulty: problem.difficulty,
    updatedAt: problem.updatedAt,
    latestAttempt: problem.latestAttempt ?? null,
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const url = new URL(request.url);
    // Listing problems is a read path. Course-wide legacy backfill and problem
    // number maintenance can exceed the short transaction budget on a large
    // bank, so only run it when an operator explicitly requests maintenance.
    const skipMaintenance = url.searchParams.get('maintenance') !== '1';
    const ids = (url.searchParams.get('ids') || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 40);
    if (ids.length > 0) {
      const problems = await listCourseProblemsByIdsForUser(auth.userId, id, ids, {
        skipMaintenance,
      });
      return NextResponse.json({ problems: problems.map(toClientProblem) });
    }

    if (url.searchParams.get('summary') === '1') {
      const problems = await listCourseProblemSummariesForUser(auth.userId, id, {
        skipMaintenance,
      });
      return NextResponse.json({ problems: problems.map(toClientProblemSummary) });
    }

    const problems = await listCourseProblemsForUser(auth.userId, id, {
      skipMaintenance,
    });
    return NextResponse.json({ problems: problems.map(toClientProblem) });
  });
}
