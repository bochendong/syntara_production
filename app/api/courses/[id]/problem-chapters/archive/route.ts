import { Output } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { callLLM } from '@/lib/ai/llm';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { withRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_PROBLEMS = 240;
const outputSchema = z.object({
  assignments: z
    .array(
      z.object({
        problemId: z.string().trim().min(1).max(240),
        chapterId: z.string().trim().min(1).max(240),
      }),
    )
    .max(MAX_PROBLEMS),
});

function compact(value: unknown, limit: number) {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId } = await context.params;
    const accessRole = await findCourseAccessRole(prisma, auth.userId, courseId);
    if (accessRole !== 'owner') {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const unfiledWhere = {
      OR: [{ courseId }, { notebook: { courseId } }],
      chapterId: null,
      status: { not: 'archived' as const },
    };
    const [course, chapters, problems, totalUnfiledCount] = await Promise.all([
      prisma.course.findUnique({
        where: { id: courseId },
        select: { name: true, courseCode: true },
      }),
      prisma.courseProblemChapter.findMany({
        where: { courseId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: { id: true, name: true, description: true, position: true },
      }),
      prisma.notebookProblem.findMany({
        where: unfiledWhere,
        orderBy: [{ problemNumber: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
        take: MAX_PROBLEMS,
        select: {
          id: true,
          title: true,
          type: true,
          difficulty: true,
          publicContentJson: true,
        },
      }),
      prisma.notebookProblem.count({ where: unfiledWhere }),
    ]);
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    if (chapters.length === 0) {
      return NextResponse.json(
        { error: '请先添加至少一个章节，再使用 AI 归档。', code: 'CHAPTER_REQUIRED' },
        { status: 409 },
      );
    }
    if (problems.length === 0) {
      return NextResponse.json({
        candidateCount: 0,
        archivedCount: 0,
        unfiledCount: totalUnfiledCount,
        truncated: false,
      });
    }

    const model = await resolveModelFromHeaders(request, {
      allowOpenAIModelOverride: true,
      useOpenAIResponses: true,
    });
    if (!model.apiKey) {
      return NextResponse.json({ error: '系统 OpenAI API Key 尚未配置。' }, { status: 503 });
    }

    const validProblemIds = new Set(problems.map((problem) => problem.id));
    const validChapterIds = new Set(chapters.map((chapter) => chapter.id));
    const prompt = [
      `课程：${course.courseCode || course.name} · ${course.name}`,
      '把未归档题目归入老师已经建立的章节。只能选择给定 chapterId，不能创建、改名或合并章节。',
      '只归档能从题面明确判断属于某一章节的题目；无法可靠判断的题目不要输出，它们继续保留为未归档。',
      '每道题最多出现一次。不要生成标签、知识点或其他分类字段。',
      `章节：${JSON.stringify(chapters)}`,
      `未归档题目：${JSON.stringify(
        problems.map((problem) => ({
          problemId: problem.id,
          title: problem.title,
          type: problem.type,
          difficulty: problem.difficulty,
          stem: compact(JSON.stringify(problem.publicContentJson), 1000),
        })),
      )}`,
    ].join('\n');

    const result = await withRequestContext(
      {
        userId: auth.userId,
        courseId,
        courseName: course.name,
        route: `/api/courses/${courseId}/problem-chapters/archive`,
        operationCode: 'course_problem_chapter_archive',
        chargeReason: 'AI 归档课程题目',
        serviceLabel: '课程题库 AI 归档',
      },
      () =>
        callLLM(
          {
            model: model.model,
            system: '你是严谨的课程题目归档助手。只返回符合 schema 的章节归档结果。',
            prompt,
            output: Output.object({ schema: outputSchema, name: 'problem_chapter_assignments' }),
            maxOutputTokens: 6_000,
            maxRetries: 1,
          },
          'course-problem-chapter-archive',
        ),
    );

    const seen = new Set<string>();
    const assignments = outputSchema.parse(result.output).assignments.filter((assignment) => {
      if (
        seen.has(assignment.problemId) ||
        !validProblemIds.has(assignment.problemId) ||
        !validChapterIds.has(assignment.chapterId)
      ) {
        return false;
      }
      seen.add(assignment.problemId);
      return true;
    });
    const assignmentsByChapter = new Map<string, string[]>();
    for (const assignment of assignments) {
      assignmentsByChapter.set(assignment.chapterId, [
        ...(assignmentsByChapter.get(assignment.chapterId) ?? []),
        assignment.problemId,
      ]);
    }

    let archivedCount = 0;
    await prisma.$transaction(async (tx) => {
      for (const [chapterId, problemIds] of assignmentsByChapter) {
        const updated = await tx.notebookProblem.updateMany({
          where: {
            id: { in: problemIds },
            chapterId: null,
            status: { not: 'archived' },
            OR: [{ courseId }, { notebook: { courseId } }],
          },
          data: { chapterId },
        });
        archivedCount += updated.count;
      }
    });

    return NextResponse.json({
      candidateCount: problems.length,
      archivedCount,
      unfiledCount: Math.max(0, totalUnfiledCount - archivedCount),
      truncated: totalUnfiledCount > MAX_PROBLEMS,
    });
  });
}
