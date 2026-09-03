import { Output } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { callLLM } from '@/lib/ai/llm';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { withRequestContext } from '@/lib/server/request-context';
import {
  PROBLEM_TAG_AUTO_APPLY_CONFIDENCE,
  requireProblemTagCourseAccess,
  syncProblemTagPaths,
} from '@/features/problem-tags/server/problem-tag-service';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_PROBLEMS = 240;
const outputSchema = z.object({
  assignments: z
    .array(
      z.object({
        problemId: z.string().trim().min(1).max(240),
        area: z.string().trim().min(1).max(120),
        concept: z.string().trim().min(1).max(120),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(MAX_PROBLEMS * 3),
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
    if (!(await requireProblemTagCourseAccess(prisma, auth.userId, courseId, true))) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const [course, problems, existingNodes] = await Promise.all([
      prisma.course.findUnique({
        where: { id: courseId },
        select: { name: true, courseCode: true },
      }),
      prisma.notebookProblem.findMany({
        where: {
          status: { not: 'archived' },
          OR: [{ courseId }, { notebook: { courseId } }],
        },
        orderBy: [{ problemNumber: 'asc' }, { order: 'asc' }],
        take: MAX_PROBLEMS,
        select: {
          id: true,
          title: true,
          type: true,
          difficulty: true,
          tags: true,
          publicContentJson: true,
          tagAssignments: {
            where: { source: 'manual', status: 'applied' },
            select: { tagId: true },
          },
        },
      }),
      prisma.courseProblemTagNode.findMany({
        where: { courseId, status: 'active' },
        select: {
          id: true,
          parentId: true,
          level: true,
          name: true,
          aliases: true,
          lockedByTeacher: true,
        },
      }),
    ]);
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    if (problems.length === 0)
      return NextResponse.json({
        candidateCount: 0,
        appliedCount: 0,
        pendingCount: 0,
        truncated: false,
      });

    const model = await resolveModelFromHeaders(request, {
      allowOpenAIModelOverride: true,
      useOpenAIResponses: true,
    });
    if (!model.apiKey)
      return NextResponse.json({ error: '系统 OpenAI API Key 尚未配置。' }, { status: 503 });
    const validProblemIds = new Set(problems.map((problem) => problem.id));
    const prompt = [
      `课程：${course.courseCode || course.name} · ${course.name}`,
      '为课程题库建立严格的两级知识树，并给每道题分配 1-3 个叶子知识点。',
      '第一层 area 是稳定知识领域，第二层 concept 是可评估的具体知识点。不要使用题型、题号、年份、考试名或“练习题”等噪声标签。',
      '必须使用给定 problemId。已有 lockedByTeacher 节点和人工分配不可改写；优先复用含义相同的已有节点或别名。',
      `现有知识树：${JSON.stringify(existingNodes)}`,
      `题目：${JSON.stringify(
        problems.map((problem) => ({
          problemId: problem.id,
          title: problem.title,
          type: problem.type,
          difficulty: problem.difficulty,
          tags: problem.tags,
          stem: compact(JSON.stringify(problem.publicContentJson), 900),
          hasManualAssignment: problem.tagAssignments.length > 0,
        })),
      )}`,
    ].join('\n');
    const result = await withRequestContext(
      {
        userId: auth.userId,
        courseId,
        courseName: course.name,
        route: `/api/courses/${courseId}/problem-tags/organize`,
        operationCode: 'course_problem_tag_organize',
        chargeReason: 'AI 整理课程题库知识树',
        serviceLabel: '课程题库 AI 标签整理',
      },
      () =>
        callLLM(
          {
            model: model.model,
            system: '你是严谨的课程知识架构师。只返回符合 schema 的两级知识树题目分配。',
            prompt,
            output: Output.object({ schema: outputSchema, name: 'problem_tag_assignments' }),
            maxOutputTokens: 8_000,
            maxRetries: 1,
          },
          'course-problem-tag-organize',
        ),
    );
    const assignments = outputSchema
      .parse(result.output)
      .assignments.filter((item) => validProblemIds.has(item.problemId));
    const byProblem = new Map<string, typeof assignments>();
    for (const item of assignments)
      byProblem.set(item.problemId, [...(byProblem.get(item.problemId) || []), item]);
    let appliedCount = 0;
    let pendingCount = 0;
    for (const [problemId, items] of byProblem) {
      const confidence = Math.min(...items.map((item) => item.confidence));
      await syncProblemTagPaths({
        prisma,
        courseId,
        problemId,
        paths: items.map(({ area, concept }) => ({ area, concept })),
        source: 'ai',
        confidence,
      });
      if (confidence >= PROBLEM_TAG_AUTO_APPLY_CONFIDENCE) appliedCount += 1;
      else pendingCount += 1;
    }
    return NextResponse.json({
      candidateCount: problems.length,
      appliedCount,
      pendingCount,
      unassignedCount: Math.max(0, problems.length - byProblem.size),
      truncated: problems.length === MAX_PROBLEMS,
    });
  });
}
