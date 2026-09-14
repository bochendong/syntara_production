import { z } from 'zod';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { notebookProblemImportDraftSchema } from '@/lib/problem-bank/schema';
import { createManualCourseProblem } from '@/features/problems/server/service';
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  listCourseProblemsByIdsForUser,
  listCourseProblemPageForUser,
  listCourseProblemSummariesForUser,
  listCourseProblemsForUser,
} from '@/features/problems/server/service';

function toClientProblem(problem: Awaited<ReturnType<typeof listCourseProblemsForUser>>[number]) {
  return {
    id: problem.id,
    courseId: problem.courseId ?? null,
    notebookId: problem.notebookId,
    notebookName: problem.notebookName,
    chapterId: problem.chapterId ?? null,
    chapterName: problem.chapterName,
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
    attemptStats: problem.attemptStats ?? null,
    classStats: problem.classStats ?? null,
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
    chapterId: problem.chapterId ?? null,
    chapterName: problem.chapterName,
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
      return NextResponse.json({
        problems: problems.map((item) => toClientProblem(item)),
      });
    }

    const requestedPage = Number.parseInt(url.searchParams.get('page') || '', 10);
    if (Number.isFinite(requestedPage) && requestedPage > 0) {
      const pageSize = Number.parseInt(url.searchParams.get('pageSize') || '10', 10);
      const result = await listCourseProblemPageForUser(auth.userId, id, {
        page: requestedPage,
        pageSize: Number.isFinite(pageSize) ? pageSize : 10,
        skipMaintenance,
        filters: {
          searchQuery: url.searchParams.get('q') || undefined,
          practiceFilter: (url.searchParams.get('practice') || 'all') as
            | 'all'
            | 'review'
            | 'wrong'
            | 'unattempted'
            | 'mastered',
          typeFilter: url.searchParams.get('type') || undefined,
          difficultyFilter: url.searchParams.get('difficulty') || undefined,
          chapterFilter: url.searchParams.get('chapter') || undefined,
          statusFilter: url.searchParams.get('status') || undefined,
          notebookId: url.searchParams.get('notebookId') || undefined,
        },
      });
      return NextResponse.json({
        ...result,
        problems: result.problems.map((item) => toClientProblem(item)),
      });
    }

    if (url.searchParams.get('summary') === '1') {
      const problems = await listCourseProblemSummariesForUser(auth.userId, id, {
        skipMaintenance,
      });
      return NextResponse.json({
        problems: problems.map((item) => toClientProblemSummary(item)),
      });
    }

    const problems = await listCourseProblemsForUser(auth.userId, id, {
      skipMaintenance,
    });
    return NextResponse.json({
      problems: problems.map((item) => toClientProblem(item)),
    });
  });
}

export const maxDuration = 300;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireTeacher();
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const parsed = z
      .object({
        draft: notebookProblemImportDraftSchema,
        chapterId: z.string().min(1).nullable().optional(),
      })
      .strict()
      .safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: '请补全题目标题、题面和答案。' }, { status: 400 });
    try {
      const result = await createManualCourseProblem({
        userId: auth.userId,
        courseId: id,
        ...parsed.data,
      });
      return NextResponse.json(result, { status: 201 });
    } catch (error) {
      if (error instanceof Error && error.message === 'Course not found')
        return NextResponse.json({ error: '课程不存在或无管理权限。' }, { status: 404 });
      if (
        error instanceof Error &&
        /^(题型|暂时无法发布|所选章节|题库中已存在)/.test(error.message)
      )
        return NextResponse.json({ error: error.message }, { status: 400 });
      throw error;
    }
  });
}
