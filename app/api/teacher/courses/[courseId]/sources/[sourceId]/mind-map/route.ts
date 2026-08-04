import { createHash } from 'node:crypto';
import { after, NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { POST as generateImage } from '@/app/api/generate/image/route';
import {
  prepareCheatSheetPrompt,
  type SourceUploadKind,
} from '@/features/memory/server/source-upload-ingestion';
import { createLogger } from '@/lib/logger';
import type { ImageGenerationResult } from '@/lib/media/types';
import { prisma } from '@/lib/server/prisma';
import { toPrismaJson } from '@/lib/server/prisma-json';
import { withRequestContext } from '@/lib/server/request-context';
import { resolveOpenAIResponsesModelFromHeaders } from '@/lib/server/resolve-model';
import { requireTeacher } from '@/lib/server/teacher-auth';

export const runtime = 'nodejs';
export const maxDuration = 300;

const log = createLogger('TeacherMindMap');
const MIND_MAP_TASK_STALE_MS = 6 * 60 * 1000;

const requestSchema = z.object({
  notebookId: z.string().trim().min(1).max(200),
  sourceText: z.string().trim().min(100).max(220_000).optional(),
  sourcePageCount: z.number().int().min(1).max(10_000).optional(),
});

type InternalImageResponse = {
  success?: boolean;
  result?: ImageGenerationResult;
  error?: string;
};

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sourceKind(title: string, mimeType: string | null): SourceUploadKind {
  const lower = title.toLowerCase();
  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.pptx')) return 'pptx';
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.md') || lower.endsWith('.markdown')) return 'markdown';
  if (mimeType?.startsWith('text/')) return 'plain_text';
  return 'other';
}

function imageBuffer(result: ImageGenerationResult) {
  if (!result.base64) throw new Error('图片生成完成，但没有返回可持久化的图片数据');
  const matched = result.base64.match(/^data:[^;,]+;base64,([\s\S]+)$/);
  return Buffer.from(matched?.[1] || result.base64, 'base64');
}

function safeToken(value: number | undefined) {
  return Number.isFinite(value) && (value ?? 0) > 0 ? Math.floor(value ?? 0) : 0;
}

function previewTitle(sourceTitle: string) {
  return sourceTitle.replace(/\.[^.]+$/, '').trim() || '思维导图';
}

async function runMindMapGeneration(args: {
  ownerId: string;
  courseId: string;
  taskId: string;
  requestUrl: string;
  requestedModel?: string;
  sourcePageCount?: number;
  course: { name: string; courseCode: string | null };
  source: {
    id: string;
    title: string;
    fileMime: string | null;
    sourceHash: string;
    extractedText: string | null;
  };
  notebook: { id: string; name: string; coverSlideJson: unknown };
}) {
  try {
    await prisma.agentTask.update({
      where: { id: args.taskId },
      data: { status: 'running', stage: 'generating_mind_map', progress: 15, error: null },
    });
    log.info('Mind-map task started', {
      taskId: args.taskId,
      courseId: args.courseId,
      sourceId: args.source.id,
      notebookId: args.notebook.id,
    });

    const modelRequest = new NextRequest(args.requestUrl, {
      headers: args.requestedModel ? { 'x-model': args.requestedModel } : undefined,
    });
    const resolved = await resolveOpenAIResponsesModelFromHeaders(modelRequest);
    const sourceText = args.source.extractedText?.trim() || '';
    if (sourceText.length < 100) {
      throw new Error('源文件尚未完成文字提取，请先生成笔记本。');
    }
    const preview = await withRequestContext(
      {
        userId: args.ownerId,
        courseId: args.courseId,
        courseName: args.course.name,
        notebookId: args.notebook.id,
        notebookName: args.notebook.name,
        route: '/api/teacher/courses/source/mind-map',
        operationCode: 'teacher_mind_map_content',
        chargeReason: '生成课程思维导图内容',
      },
      () =>
        prepareCheatSheetPrompt({
          sourceTitle: args.source.title,
          sourceKind: sourceKind(args.source.title, args.source.fileMime),
          sourceFileMime: args.source.fileMime,
          text: sourceText,
          rawFileHash: args.source.sourceHash,
          pageCount: args.sourcePageCount,
          language: 'zh-CN',
          usageProfile: 'university_course',
          coverTitle: `${args.course.courseCode || args.course.name} · ${previewTitle(args.source.title)}`,
          coverCourseLabel: args.course.courseCode || args.course.name,
          coverFocus: '概念层级、关键关系、学习顺序、易错点',
          model: resolved.model,
          modelProviderId: resolved.providerId,
          usageSource: 'teacher-mind-map-content',
        }),
    );
    await prisma.agentTask.update({
      where: { id: args.taskId },
      data: { stage: 'generating_image', progress: 60 },
    });
    const imageRequest = new NextRequest(new URL('/api/generate/image', args.requestUrl), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-image-provider': 'openai-image',
        'x-image-model': 'gpt-image-2',
        'x-user-id': args.ownerId,
        'x-usage-source': 'teacher-mind-map-image',
      },
      body: JSON.stringify({
        prompt: `${preview.prompt}\n\n额外要求：把内容组织成清晰的思维导图，以中心主题向外分支；用连线和层级节点表达概念关系，保持简体中文可读。`,
        negativePrompt:
          '乱码、伪汉字、无意义文字、写实照片、广告海报、黑色背景、logo、水印、巨大留白、UI界面',
        width: 1448,
        height: 1024,
        style: 'detailed landscape Chinese educational mind map',
        quality: 'medium',
        notebookContext: {
          id: args.notebook.id,
          name: args.notebook.name,
          courseId: args.courseId,
          courseName: args.course.name,
        },
      }),
    });
    const imageResponse = await generateImage(imageRequest);
    const imagePayload = (await imageResponse
      .clone()
      .json()
      .catch(() => null)) as InternalImageResponse | null;
    if (!imageResponse.ok || !imagePayload?.result) {
      throw new Error(imagePayload?.error || '思维导图图片生成失败');
    }

    await prisma.agentTask.update({
      where: { id: args.taskId },
      data: { stage: 'persisting_mind_map', progress: 85 },
    });
    const result = imagePayload.result;
    const imageInputTokens = safeToken(result.usage?.inputTokens);
    const imageOutputTokens = safeToken(result.usage?.outputTokens);
    const imageTotalTokens =
      safeToken(result.usage?.totalTokens) || imageInputTokens + imageOutputTokens;
    const usage = {
      inputTokens: preview.usage.inputTokens + imageInputTokens,
      outputTokens: preview.usage.outputTokens + imageOutputTokens,
      cachedInputTokens: preview.usage.cachedInputTokens,
      totalTokens: preview.usage.totalTokens + imageTotalTokens,
    };
    const buffer = imageBuffer(result);
    const generatedAt = Date.now();
    const mindMap = {
      storage: 'postgresql',
      contentHash: createHash('sha256').update(buffer).digest('hex'),
      mimeType: 'image/png',
      width: result.width || 1448,
      height: result.height || 1024,
      sourceId: args.source.id,
      sourceTitle: args.source.title,
      providerId: resolved.providerId,
      textModel: resolved.modelString,
      imageModel: result.usage?.modelId || 'gpt-image-2',
      generatedAt,
      summary: preview.summary,
    };
    await prisma.notebook.update({
      where: { id: args.notebook.id },
      data: {
        coverSlideJson: toPrismaJson({ ...jsonRecord(args.notebook.coverSlideJson), mindMap }),
        mindMapData: Uint8Array.from(buffer),
        mindMapMime: 'image/png',
        contentVersion: { increment: 1 },
      },
    });
    await prisma.agentTask.update({
      where: { id: args.taskId },
      data: {
        status: 'completed',
        stage: 'completed',
        progress: 100,
        result: toPrismaJson({
          notebookId: args.notebook.id,
          mindMap,
          usage,
          persistence: 'postgresql',
        }),
        error: null,
      },
    });
    log.info('Mind-map task completed', {
      taskId: args.taskId,
      courseId: args.courseId,
      notebookId: args.notebook.id,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '思维导图生成失败';
    await prisma.agentTask
      .update({
        where: { id: args.taskId },
        data: { status: 'failed', stage: 'failed', progress: 100, error: message },
      })
      .catch(() => undefined);
    log.error('Mind-map task failed', {
      taskId: args.taskId,
      courseId: args.courseId,
      sourceId: args.source.id,
      error: message,
    });
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ courseId: string; sourceId: string }> },
) {
  try {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, sourceId } = await context.params;
    const payload = requestSchema.parse(await request.json());
    const [course, source, notebook] = await Promise.all([
      prisma.course.findFirst({
        where: { id: courseId, ownerId: teacher.userId },
        select: { id: true, name: true, courseCode: true },
      }),
      prisma.courseSource.findFirst({
        where: { id: sourceId, courseId, ownerId: teacher.userId, kind: 'teacher_upload' },
      }),
      prisma.notebook.findFirst({
        where: { id: payload.notebookId, courseId, ownerId: teacher.userId },
        select: { id: true, name: true, coverSlideJson: true, mindMapData: true },
      }),
    ]);
    if (!course || !source || !notebook) {
      return NextResponse.json({ error: '课程资料或关联笔记本不存在' }, { status: 404 });
    }
    const sourceText = payload.sourceText?.trim() || source.extractedText?.trim() || '';
    if (sourceText.length < 100) {
      return NextResponse.json(
        { error: '源文件尚未完成文字提取，请先生成笔记本。' },
        { status: 409 },
      );
    }
    const taskId = `teacher-mind-map:${sourceId}:${notebook.id}`;
    if (notebook.mindMapData) {
      await prisma.agentTask.updateMany({
        where: { id: taskId },
        data: { status: 'completed', stage: 'completed', progress: 100, error: null },
      });
      return NextResponse.json({
        ok: true,
        alreadyGenerated: true,
        notebookId: notebook.id,
        imageUrl: `/api/teacher/courses/${encodeURIComponent(courseId)}/notebooks/${encodeURIComponent(notebook.id)}/mind-map`,
      });
    }

    const existingTask = await prisma.agentTask.findUnique({
      where: { id: taskId },
      select: {
        status: true,
        stage: true,
        progress: true,
        attemptCount: true,
        updatedAt: true,
      },
    });
    const existingTaskIsActive =
      existingTask?.status === 'queued' || existingTask?.status === 'running';
    const existingTaskIsStale =
      existingTaskIsActive &&
      Date.now() - existingTask.updatedAt.getTime() > MIND_MAP_TASK_STALE_MS;
    if (existingTaskIsActive && !existingTaskIsStale) {
      return NextResponse.json(
        { ok: true, taskId, notebookId: notebook.id, ...existingTask },
        { status: 202 },
      );
    }

    const requestPayload = toPrismaJson({
      sourceId,
      sourceTitle: source.title,
      notebookId: notebook.id,
      sourcePageCount: payload.sourcePageCount || 0,
      sourceTextCharacters: sourceText.length,
    });
    const task = await prisma.agentTask.upsert({
      where: { id: taskId },
      create: {
        id: taskId,
        ownerId: teacher.userId,
        courseId,
        notebookId: notebook.id,
        taskType: 'teacher_mind_map_generation',
        status: 'queued',
        stage: 'queued',
        progress: 0,
        attemptCount: 1,
        request: requestPayload,
      },
      update: {
        notebookId: notebook.id,
        status: 'queued',
        stage: 'queued',
        progress: 0,
        attemptCount: { increment: 1 },
        error: null,
        request: requestPayload,
      },
      select: { status: true, stage: true, progress: true, attemptCount: true },
    });
    after(() =>
      runMindMapGeneration({
        ownerId: teacher.userId,
        courseId,
        taskId,
        requestUrl: request.url,
        requestedModel: request.headers.get('x-model')?.trim() || undefined,
        sourcePageCount: payload.sourcePageCount,
        course,
        source: { ...source, extractedText: sourceText },
        notebook,
      }),
    );
    log.info('Mind-map task queued', { taskId, courseId, sourceId, notebookId: notebook.id });
    return NextResponse.json(
      { ok: true, taskId, notebookId: notebook.id, ...task },
      { status: 202 },
    );
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '思维导图生成失败' },
      { status: 500 },
    );
  }
}
