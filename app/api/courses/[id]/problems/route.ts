import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import {
  listCourseProblemsByIdsForUser,
  listCourseProblemSummariesForUser,
  listCourseProblemsForUser,
} from '@/features/problems/server/service';
import { getProblemTagAssignments } from '@/features/problem-tags/server/problem-tag-service';
import type { NotebookProblemTagAssignment } from '@/lib/problem-bank';

function toClientProblem(
  problem: Awaited<ReturnType<typeof listCourseProblemsForUser>>[number],
  tagAssignments: NotebookProblemTagAssignment[],
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
    attemptStats: problem.attemptStats ?? null,
    latestAttempt: problem.latestAttempt ?? null,
    ...(problem.secretJudge ? { secretJudge: problem.secretJudge } : {}),
  };
}

function toClientProblemSummary(
  problem: Awaited<ReturnType<typeof listCourseProblemSummariesForUser>>[number],
  tagAssignments: NotebookProblemTagAssignment[],
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
    tagAssignments,
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
    const areaId = url.searchParams.get('areaId')?.trim() || null;
    const conceptId = url.searchParams.get('conceptId')?.trim() || null;
    const matchesTagFilter = (items: NotebookProblemTagAssignment[]) =>
      !areaId && !conceptId
        ? true
        : items.some(
            (item) =>
              item.status === 'applied' &&
              (!areaId || item.areaId === areaId) &&
              (!conceptId || item.id === conceptId),
          );
    if (ids.length > 0) {
      const problems = await listCourseProblemsByIdsForUser(auth.userId, id, ids, {
        skipMaintenance,
      });
      const assignments = await getProblemTagAssignments(
        prisma,
        id,
        problems.map((item) => item.id),
      );
      return NextResponse.json({
        problems: problems.map((item) => toClientProblem(item, assignments.get(item.id) || [])),
      });
    }

    if (url.searchParams.get('summary') === '1') {
      const problems = await listCourseProblemSummariesForUser(auth.userId, id, {
        skipMaintenance,
      });
      const assignments = await getProblemTagAssignments(
        prisma,
        id,
        problems.map((item) => item.id),
      );
      return NextResponse.json({
        problems: problems
          .map((item) => toClientProblemSummary(item, assignments.get(item.id) || []))
          .filter((item) => matchesTagFilter(item.tagAssignments)),
      });
    }

    const problems = await listCourseProblemsForUser(auth.userId, id, {
      skipMaintenance,
    });
    const assignments = await getProblemTagAssignments(
      prisma,
      id,
      problems.map((item) => item.id),
    );
    return NextResponse.json({
      problems: problems
        .map((item) => toClientProblem(item, assignments.get(item.id) || []))
        .filter((item) => matchesTagFilter(item.tagAssignments)),
    });
  });
}
