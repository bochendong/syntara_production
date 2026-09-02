import { after, NextResponse } from 'next/server';

import { parsePDF } from '@/lib/pdf/pdf-providers';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { toPrismaJson } from '@/lib/server/prisma-json';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { generateTeacherCourseNotebook } from '@/lib/server/teacher-course-notebook-generation';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import { courseSourceFileKind } from '@/lib/uploads/course-source-policy';
import { extractCourseSourceImageText } from '@/lib/server/extract-course-source-image-text';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';
import { getServerOpenAIResponsesModel } from '@/lib/ai/server-model';
import {
  convertOfficeSourceToPdf,
  persistCourseSourcePreviewPdf,
} from '@/lib/server/office-source-pdf';
import {
  extractProblemDraftsFromText,
  llmExtractProblemDraftsFromOpenAIFile,
} from '@/features/problems/server/import';
import { createCourseProblemsFromDraftsWithSummary } from '@/features/problems/server/service';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function extractText(args: { title: string; mimeType: string; data: Buffer }) {
  const kind = courseSourceFileKind({ name: args.title, type: args.mimeType });
  if (kind === 'pdf') {
    const parsed = await parsePDF({ providerId: 'unpdf', apiKey: '', baseUrl: '' }, args.data);
    return {
      text: parsed.text || '',
      pageCount: typeof parsed.metadata?.pageCount === 'number' ? parsed.metadata.pageCount : 1,
    };
  }
  if (kind === 'docx') {
    const converted = await convertOfficeSourceToPdf(args);
    return { text: converted.text, pageCount: converted.pageCount, previewPdf: converted.pdf };
  }
  if (kind === 'pptx') {
    const converted = await convertOfficeSourceToPdf(args);
    return { text: converted.text, pageCount: converted.pageCount, previewPdf: converted.pdf };
  }
  if (kind === 'image') {
    return {
      text: await extractCourseSourceImageText({
        buffer: args.data,
        fileName: args.title,
        mimeType: args.mimeType,
      }),
      pageCount: 1,
    };
  }
  return { text: args.data.toString('utf8'), pageCount: 1 };
}

async function runSourceProcessing(args: {
  ownerId: string;
  courseId: string;
  sourceId: string;
  notebookId: string | null;
  taskId: string;
}) {
  try {
    await prisma.agentTask.update({
      where: { id: args.taskId },
      data: { status: 'running', stage: 'extracting', progress: 10, error: null },
    });
    const [course, source] = await Promise.all([
      prisma.course.findFirst({
        where: { id: args.courseId, ownerId: args.ownerId },
        select: { id: true, name: true, courseCode: true },
      }),
      prisma.courseSource.findFirst({
        where: {
          id: args.sourceId,
          courseId: args.courseId,
          ownerId: args.ownerId,
          removedAt: null,
        },
      }),
    ]);
    if (!course || !source) throw new Error('课程或源文件不存在');
    if (!source.fileData && !source.extractedText) {
      throw new Error('源文件没有可处理的数据库内容');
    }

    await prisma.courseSource.update({
      where: { id: source.id },
      data: { ingestStatus: 'processing', errorReason: null },
    });
    const sourceKind = courseSourceFileKind({
      name: source.title,
      type: source.fileMime || 'application/octet-stream',
    });
    const officeSource = sourceKind === 'docx' || sourceKind === 'pptx';
    if (officeSource) {
      await prisma.agentTask.update({
        where: { id: args.taskId },
        data: { stage: 'converting_to_pdf', progress: 12 },
      });
    }
    const extracted =
      officeSource || !source.extractedText?.trim()
        ? await extractText({
            title: source.title,
            mimeType: source.fileMime || 'application/octet-stream',
            data: Buffer.from(source.fileData!),
          })
        : { text: source.extractedText, pageCount: 1 };
    if ('previewPdf' in extracted && extracted.previewPdf) {
      await persistCourseSourcePreviewPdf(source.id, extracted.previewPdf);
    }
    // PostgreSQL text columns reject NUL bytes. Some PDF text extractors keep
    // them as U+0000, so normalize before either prompting the model or
    // persisting the extracted source text.
    const text = extracted.text
      .replace(/\u0000/g, '')
      .trim()
      .slice(0, 90_000);
    const minimumTextLength = source.sourceCategory === 'problem_bank' ? 10 : 400;
    if (text.length < minimumTextLength) {
      throw new Error(
        source.sourceCategory === 'problem_bank'
          ? '源文件提取文字不足，无法导入课程题库'
          : '源文件提取文字不足，无法生成课程笔记本',
      );
    }

    await prisma.courseSource.update({
      where: { id: source.id },
      data: { extractedText: text, ingestStatus: 'processing', errorReason: null },
    });

    if (source.sourceCategory === 'problem_bank') {
      const runtimeConfig = await getSystemLLMRuntimeConfig();
      if (!runtimeConfig.apiKey) throw new Error('系统 OpenAI API Key 尚未配置。');
      const { model } = getServerOpenAIResponsesModel({
        providerId: 'openai',
        providerType: 'openai',
        modelId: runtimeConfig.modelId,
        apiKey: runtimeConfig.apiKey,
        baseUrl: runtimeConfig.baseUrl,
        requiresApiKey: true,
      });
      const extractedProblems = source.openaiFileId
        ? await llmExtractProblemDraftsFromOpenAIFile({
            fileId: source.openaiFileId,
            fileName: source.title,
            mimeType: source.fileMime || 'application/octet-stream',
            source: 'pdf',
            model,
            language: 'zh-CN',
          })
        : await extractProblemDraftsFromText({
            text,
            source: 'pdf',
            model,
            language: 'zh-CN',
          });
      await createCourseProblemsFromDraftsWithSummary({
        userId: args.ownerId,
        courseId: args.courseId,
        drafts: extractedProblems.drafts.map((draft) => ({
          ...draft,
          notebookId: null,
          sourceMeta: {
            ...draft.sourceMeta,
            courseSourceId: source.id,
            sourceFileName: source.title,
            suggestedNotebookId: null,
          },
        })),
      });
      await Promise.all([
        prisma.courseSource.update({
          where: { id: source.id },
          data: {
            ingestStatus: 'ready',
            indexStatus: 'ready',
            ingestedAt: new Date(),
            indexedAt: new Date(),
            errorReason: null,
          },
        }),
        prisma.agentTask.update({
          where: { id: args.taskId },
          data: { status: 'completed', stage: 'completed', progress: 100, error: null },
        }),
      ]);
      return;
    }

    if (!args.notebookId) throw new Error('课程笔记本任务缺少 notebookId');

    await generateTeacherCourseNotebook({
      ownerId: args.ownerId,
      courseId: args.courseId,
      notebookId: args.notebookId,
      sourceId: source.id,
      courseCode: course.courseCode || course.name,
      courseTitle: course.name,
      sourceTitle: source.title,
      sourceText: text,
      sourcePageCount: Math.max(1, Math.min(500, extracted.pageCount)),
    });
    await prisma.courseSource.update({
      where: { id: source.id },
      data: {
        ingestStatus: 'ready',
        indexStatus: 'ready',
        ingestedAt: new Date(),
        indexedAt: new Date(),
        errorReason: null,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '源文件处理失败';
    await Promise.allSettled([
      prisma.courseSource.update({
        where: { id: args.sourceId },
        data: { ingestStatus: 'error', errorReason: message },
      }),
      prisma.agentTask.update({
        where: { id: args.taskId },
        data: { status: 'failed', stage: 'failed', progress: 100, error: message },
      }),
    ]);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ courseId: string; sourceId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, sourceId } = await context.params;
    const [course, source] = await Promise.all([
      prisma.course.findFirst({
        where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
        select: { id: true, name: true, courseCode: true },
      }),
      prisma.courseSource.findFirst({
        where: { id: sourceId, courseId, ownerId: teacher.userId, removedAt: null },
      }),
    ]);
    if (!course || !source) {
      return NextResponse.json({ error: '课程或源文件不存在' }, { status: 404 });
    }
    if (!source.fileData && !source.extractedText) {
      return NextResponse.json({ error: '源文件没有可处理的数据库内容' }, { status: 409 });
    }

    const isProblemBank = source.sourceCategory === 'problem_bank';
    const notebookId = isProblemBank ? null : `teacher-notebook:${source.id}`;
    const taskId = isProblemBank
      ? `teacher-problem-import:${source.id}`
      : `teacher-generation:${notebookId}`;
    const existingTask = await prisma.agentTask.findUnique({
      where: { id: taskId },
      select: { status: true, stage: true, progress: true },
    });
    if (existingTask?.status === 'queued' || existingTask?.status === 'running') {
      return NextResponse.json({ ok: true, taskId, notebookId, ...existingTask }, { status: 202 });
    }

    const requestPayload = toPrismaJson({
      notebookId,
      sourceId: source.id,
      sourceTitle: source.title,
      sourcePageCount: 0,
      sourceTextCharacters: source.extractedText?.length || 0,
      courseCode: course.courseCode || course.name,
    });
    const task = await prisma.agentTask.upsert({
      where: { id: taskId },
      create: {
        id: taskId,
        ownerId: teacher.userId,
        courseId,
        // The notebook does not exist yet. Linking it here violates the
        // AgentTask_notebookId_fkey before generation has had a chance to
        // persist the notebook. generateTeacherCourseNotebook attaches the
        // relation after persistTeacherCourseNotebook succeeds.
        notebookId: null,
        taskType: isProblemBank ? 'teacher_problem_bank_import' : 'teacher_notebook_generation',
        status: 'queued',
        stage: 'queued',
        progress: 0,
        attemptCount: 1,
        request: requestPayload,
      },
      update: {
        notebookId: null,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        attemptCount: { increment: 1 },
        request: requestPayload,
        error: null,
      },
      select: { status: true, stage: true, progress: true, attemptCount: true },
    });
    after(() =>
      runSourceProcessing({
        ownerId: teacher.userId,
        courseId,
        sourceId: source.id,
        notebookId,
        taskId,
      }),
    );
    return NextResponse.json({ ok: true, taskId, notebookId, ...task }, { status: 202 });
  });
}
