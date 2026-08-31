import { Output } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { callLLM } from '@/lib/ai/llm';
import { assignUnassignedCourseProblemsToNotebooks } from '@/features/problems/server/service';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { withRequestContext } from '@/lib/server/request-context';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_PROBLEMS_PER_RUN = 300;
const PROBLEMS_PER_MODEL_BATCH = 50;
const MIN_ASSIGNMENT_CONFIDENCE = 0.58;

const assignmentOutputSchema = z.object({
  assignments: z
    .array(
      z.object({
        problemId: z.string().trim().min(1).max(240),
        notebookId: z.string().trim().min(1).max(240),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(PROBLEMS_PER_MODEL_BATCH),
});

function compactText(value: unknown, maxLength: number): string {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= maxLength ? text : `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

function problemStem(publicContent: unknown): string {
  if (!publicContent || typeof publicContent !== 'object' || Array.isArray(publicContent)) {
    return '';
  }
  const record = publicContent as Record<string, unknown>;
  const direct = [record.stem, record.stemTemplate, record.prompt, record.question].find(
    (value) => typeof value === 'string' && value.trim(),
  );
  if (typeof direct === 'string') return compactText(direct, 700);
  return compactText(JSON.stringify(record), 700);
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
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

    const [course, notebooks, unassignedProblems] = await Promise.all([
      prisma.course.findUnique({
        where: { id: courseId },
        select: { id: true, name: true, courseCode: true },
      }),
      prisma.notebook.findMany({
        where: { courseId, removedAt: null },
        orderBy: [{ updatedAt: 'desc' }],
        take: 80,
        select: {
          id: true,
          name: true,
          description: true,
          tags: true,
          markdownSections: {
            orderBy: { order: 'asc' },
            take: 12,
            select: { title: true, summary: true },
          },
          pages: {
            orderBy: { order: 'asc' },
            take: 12,
            select: { title: true },
          },
          scenes: {
            orderBy: { order: 'asc' },
            take: 12,
            select: { title: true },
          },
        },
      }),
      prisma.notebookProblem.findMany({
        where: { courseId, notebookId: null, status: { not: 'archived' } },
        orderBy: [{ problemNumber: 'asc' }, { order: 'asc' }, { createdAt: 'asc' }],
        take: MAX_PROBLEMS_PER_RUN,
        select: {
          id: true,
          title: true,
          type: true,
          tags: true,
          difficulty: true,
          publicContentJson: true,
        },
      }),
    ]);
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    if (unassignedProblems.length === 0) {
      return NextResponse.json({
        candidateCount: 0,
        assignedCount: 0,
        remainingCount: 0,
        skippedLowConfidenceCount: 0,
        truncated: false,
      });
    }
    if (notebooks.length === 0) {
      return NextResponse.json(
        { error: '这门课程还没有可用于归档的章节。请先创建课程笔记本。' },
        { status: 409 },
      );
    }

    const model = await resolveModelFromHeaders(request, {
      allowOpenAIModelOverride: true,
      useOpenAIResponses: true,
    });
    if (!model.apiKey) {
      return NextResponse.json({ error: '系统 OpenAI API Key 尚未配置。' }, { status: 503 });
    }

    const fullNotebookCatalog = notebooks.map((notebook) => ({
      notebookId: notebook.id,
      name: notebook.name,
      description: compactText(notebook.description, 300),
      tags: notebook.tags.slice(0, 12),
      sections: [
        ...notebook.markdownSections.map((section) => ({
          title: compactText(section.title, 120),
          summary: compactText(section.summary, 180),
        })),
        ...notebook.pages.map((page) => ({ title: compactText(page.title, 120) })),
        ...notebook.scenes.map((scene) => ({ title: compactText(scene.title, 120) })),
      ].slice(0, 10),
    }));
    const notebookCatalog: typeof fullNotebookCatalog = [];
    for (const notebook of fullNotebookCatalog) {
      const next = [...notebookCatalog, notebook];
      if (notebookCatalog.length > 0 && JSON.stringify(next).length > 28_000) break;
      notebookCatalog.push(notebook);
    }
    const validProblemIds = new Set(unassignedProblems.map((problem) => problem.id));
    const validNotebookIds = new Set(notebookCatalog.map((notebook) => notebook.notebookId));
    const acceptedAssignments = new Map<
      string,
      { problemId: string; notebookId: string; confidence: number }
    >();
    let lowConfidenceCount = 0;

    for (const problemBatch of chunks(unassignedProblems, PROBLEMS_PER_MODEL_BATCH)) {
      const prompt = [
        `课程：${course.courseCode || course.name} · ${course.name}`,
        '请把每道尚未归档的题目匹配到最合适的课程章节（notebook）。',
        '规则：',
        '- 只能使用给出的 problemId 和 notebookId。',
        '- 一道题最多匹配一个章节。',
        '- 依据题目知识点与章节内容匹配，不要只根据编号或顺序猜测。',
        '- 不确定时可以省略该题；不要为了覆盖全部题目而强行匹配。',
        '- confidence 表示匹配把握，范围 0 到 1。',
        `章节目录：${JSON.stringify(notebookCatalog)}`,
        `待归档题目：${JSON.stringify(
          problemBatch.map((problem) => ({
            problemId: problem.id,
            title: compactText(problem.title, 220),
            type: problem.type,
            difficulty: problem.difficulty,
            tags: problem.tags.slice(0, 12),
            stem: problemStem(problem.publicContentJson),
          })),
        )}`,
      ].join('\n');
      const result = await withRequestContext(
        {
          userId: auth.userId,
          courseId,
          courseName: course.name,
          route: `/api/courses/${courseId}/problems/auto-archive`,
          operationCode: 'course_problem_auto_archive',
          chargeReason: 'AI 自动归档课程题目',
          serviceLabel: '课程题库 AI 归档',
        },
        () =>
          callLLM(
            {
              model: model.model,
              system:
                '你是严谨的课程题库管理员。你的任务是依据课程章节内容，把未归档题目分配到最合适的唯一章节，并返回机器可验证的结构化结果。',
              prompt,
              output: Output.object({
                schema: assignmentOutputSchema,
                name: 'course_problem_archive_assignments',
                description: 'Assignments from unarchived course problems to course notebooks.',
              }),
              maxOutputTokens: 6_000,
              maxRetries: 1,
            },
            'course-problem-auto-archive',
          ),
      );
      const output = assignmentOutputSchema.parse(result.output);
      for (const assignment of output.assignments) {
        if (
          !validProblemIds.has(assignment.problemId) ||
          !validNotebookIds.has(assignment.notebookId) ||
          acceptedAssignments.has(assignment.problemId)
        ) {
          continue;
        }
        if (assignment.confidence < MIN_ASSIGNMENT_CONFIDENCE) {
          lowConfidenceCount += 1;
          continue;
        }
        acceptedAssignments.set(assignment.problemId, assignment);
      }
    }

    const writeResult = await assignUnassignedCourseProblemsToNotebooks({
      userId: auth.userId,
      courseId,
      assignments: Array.from(acceptedAssignments.values()).map((assignment) => ({
        problemId: assignment.problemId,
        notebookId: assignment.notebookId,
      })),
    });
    const remainingCount = await prisma.notebookProblem.count({
      where: { courseId, notebookId: null, status: { not: 'archived' } },
    });
    const assignedProblemIds = new Set(writeResult.assignedProblemIds);
    return NextResponse.json({
      candidateCount: unassignedProblems.length,
      assignedCount: writeResult.assignedCount,
      remainingCount,
      skippedLowConfidenceCount: lowConfidenceCount,
      truncated: unassignedProblems.length === MAX_PROBLEMS_PER_RUN && remainingCount > 0,
      notebookCounts: Array.from(acceptedAssignments.values()).reduce<Record<string, number>>(
        (counts, assignment) => {
          if (!assignedProblemIds.has(assignment.problemId)) return counts;
          counts[assignment.notebookId] = (counts[assignment.notebookId] ?? 0) + 1;
          return counts;
        },
        {},
      ),
    });
  });
}
