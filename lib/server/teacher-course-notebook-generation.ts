import { Output } from 'ai';
import { z } from 'zod';

import { callLLM } from '@/lib/ai/llm';
import { prisma } from '@/lib/server/prisma';
import { toPrismaJson } from '@/lib/server/prisma-json';
import { withRequestContext } from '@/lib/server/request-context';
import { resolveModel } from '@/lib/server/resolve-model';
import { persistTeacherCourseNotebook } from '@/lib/server/teacher-course-notebook-storage';

const generatedNotebookSchema = z.object({
  title: z.string().trim().min(4).max(160),
  summary: z.string().trim().min(30).max(500),
  sections: z
    .array(
      z.object({
        title: z.string().trim().min(2).max(100),
        summary: z.string().trim().min(10).max(220),
        markdown: z.string().trim().min(180).max(8_000),
        sourcePages: z.array(z.number().int().min(1).max(500)).min(1).max(12),
      }),
    )
    .min(6)
    .max(12),
});

function safeToken(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

export async function generateTeacherCourseNotebook(args: {
  ownerId: string;
  courseId: string;
  notebookId: string;
  sourceId: string;
  courseCode: string;
  courseTitle: string;
  sourceTitle: string;
  sourceText: string;
  sourcePageCount: number;
}) {
  const taskId = `teacher-generation:${args.notebookId}`;
  const taskRequest = toPrismaJson({
    notebookId: args.notebookId,
    sourceId: args.sourceId,
    sourceTitle: args.sourceTitle,
    sourcePageCount: args.sourcePageCount,
    sourceTextCharacters: args.sourceText.length,
    courseCode: args.courseCode,
  });
  await prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status: 'running',
      stage: 'generating_notebook',
      progress: 40,
      request: taskRequest,
      error: null,
    },
  });
  try {
    const { model, modelString, providerId } = await resolveModel({});
    const prompt = [
      `课程：${args.courseCode} · ${args.courseTitle}`,
      `源文件：${args.sourceTitle}`,
      `源文件页数：${args.sourcePageCount}`,
      '',
      '把下面的课程讲义重写为一份可直接给学生阅读的 Markdown 笔记本。',
      '要求：',
      '- 使用简体中文讲解，首次出现的重要英文术语放在括号中。',
      '- 只使用源文件能支持的内容；不要补造定理、数值、例题答案或页码。',
      '- 组织为 6–12 个递进章节，覆盖学习目标、定义、核心关系、典型例题与自测。',
      '- 至少完整保留并讲解 3 个源文件中的例题或练习；写清思路与关键步骤。',
      '- 数学公式使用标准 LaTeX：行内 $...$，独立公式 $$...$$。',
      '- 删除页眉、页脚、页码、断行和 OCR 碎片，不要写“根据文档”“原文提到”等空话。',
      '- 每章 sourcePages 必须列出真实支撑页码；一章可对应多页。',
      '- markdown 正文不要重复章节标题；可使用小标题、列表、表格、例题和自测。',
      '',
      '源文件提取正文如下：',
      args.sourceText,
    ].join('\n');
    const result = await withRequestContext(
      {
        userId: args.ownerId,
        courseId: args.courseId,
        courseName: args.courseTitle,
        notebookId: args.notebookId,
        notebookName: args.sourceTitle,
        notebookGenerationTaskId: taskId,
        route: '/api/teacher/courses/source/process',
        operationCode: 'teacher_notebook_generation',
        chargeReason: '生成课程 AI 笔记本',
        serviceLabel: '教师端 AI 笔记本',
      },
      () =>
        callLLM(
          {
            model,
            system:
              'You are a source-faithful university course notebook editor. Produce concise, teachable Chinese notes through the required schema.',
            prompt,
            output: Output.object({
              schema: generatedNotebookSchema,
              name: 'teacher_course_markdown_notebook',
              description: 'A source-faithful, student-facing Markdown course notebook.',
            }),
            maxOutputTokens: 7_000,
            maxRetries: 1,
          },
          'teacher-course-notebook-generation',
        ),
    );
    const notebook = generatedNotebookSchema.parse(result.output);
    const inputTokens = safeToken(result.usage.inputTokens);
    const outputTokens = safeToken(result.usage.outputTokens);
    const cachedInputTokens = safeToken(result.usage.cachedInputTokens);
    const totalTokens = safeToken(result.usage.totalTokens) || inputTokens + outputTokens;
    const generatedAt = Date.now();
    const sections = notebook.sections.map((section, index) => ({
      id: `section:${args.notebookId}:${index + 1}`,
      ...section,
    }));
    const generation = {
      providerId,
      model: modelString,
      inputTokens,
      outputTokens,
      cachedInputTokens,
      totalTokens,
      sourcePageCount: args.sourcePageCount,
      generatedAt,
    };
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { stage: 'persisting_notebook', progress: 85 },
    });
    await persistTeacherCourseNotebook({
      ownerId: args.ownerId,
      courseId: args.courseId,
      notebookId: args.notebookId,
      title: notebook.title,
      summary: notebook.summary,
      sourceId: args.sourceId,
      sections,
      generation,
    });
    await prisma.agentTask.update({
      where: { id: taskId },
      data: {
        notebookId: args.notebookId,
        status: 'completed',
        stage: 'completed',
        progress: 100,
        result: toPrismaJson({
          title: notebook.title,
          sectionCount: sections.length,
          generation,
          persistence: 'postgresql',
        }),
        error: null,
      },
    });
    return {
      notebook: { ...notebook, sections },
      usage: { inputTokens, outputTokens, cachedInputTokens, totalTokens },
      providerId,
      model: modelString,
    };
  } catch (error) {
    await prisma.agentTask
      .update({
        where: { id: taskId },
        data: {
          status: 'failed',
          stage: 'failed',
          progress: 100,
          error: error instanceof Error ? error.message : '笔记本生成失败',
        },
      })
      .catch(() => undefined);
    throw error;
  }
}
