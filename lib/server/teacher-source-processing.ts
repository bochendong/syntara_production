import { createHash } from 'node:crypto';
import {
  createImportCheckpoints,
  ImportContinuationRequired,
} from './notebook-problems/import.checkpoints';
import { parsePDF } from '@/lib/pdf/pdf-providers';
import { prisma } from '@/lib/server/prisma';
import { toPrismaJson } from '@/lib/server/prisma-json';
import { generateTeacherCourseNotebook } from '@/lib/server/teacher-course-notebook-generation';
import {
  normalizedCourseSourceMimeType,
  courseSourceFileKind,
} from '@/lib/uploads/course-source-policy';
import { extractCourseSourceImageText } from '@/lib/server/extract-course-source-image-text';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';
import { getServerOpenAIResponsesModel } from '@/lib/ai/server-model';
import {
  convertOfficeSourceToPdf,
  persistCourseSourcePreviewPdf,
} from '@/lib/server/office-source-pdf';
import {
  extractProblemDraftsFromText,
  finalizeImportedDrafts,
  llmExtractProblemDraftsFromOpenAIFile,
  summarizeCoverage,
} from '@/features/problems/server/import';
import { createCourseProblemsFromDraftsWithSummary } from '@/features/problems/server/service';
import { uploadOpenAIUserFile } from '@/lib/server/openai-user-files';

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function derivedPdfFileName(fileName: string): string {
  return /\.[^.]+$/.test(fileName) ? fileName.replace(/\.[^.]+$/, '.pdf') : `${fileName}.pdf`;
}

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

export async function runSourceProcessing(args: {
  ownerId: string;
  courseId: string;
  sourceId: string;
  notebookId: string | null;
  taskId: string;
}) {
  const startedAt = Date.now();
  let hasSavedResponse = false;
  try {
    const initialTask = await prisma.agentTask.findUniqueOrThrow({
      where: { id: args.taskId },
      select: { progress: true },
    });
    await prisma.agentTask.update({
      where: { id: args.taskId },
      data: {
        status: 'running',
        stage: 'extracting',
        progress: Math.max(10, initialTask.progress),
        error: null,
      },
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
    if (!source.fileData && !source.extractedText && !source.openaiFileId) {
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
    if (source.sourceCategory !== 'problem_bank') {
      if (!args.notebookId) throw new Error('课程笔记本任务缺少 notebookId');
      let fileId = source.openaiFileId;
      const fileMime = normalizedCourseSourceMimeType({
        name: source.title,
        type: source.fileMime || '',
      });
      if (!fileId) {
        if (!source.fileData)
          throw new Error('源文件原件缺失，请重新上传；笔记本生成不再使用提取文本。');
        await prisma.agentTask.update({
          where: { id: args.taskId },
          data: { stage: 'uploading_openai_file', progress: 20 },
        });
        fileId = await uploadOpenAIUserFile({
          buffer: Buffer.from(source.fileData),
          fileName: source.title,
          mimeType: fileMime,
        });
        const metadata = jsonRecord(source.metadataJson);
        const existingIds = Array.isArray(metadata.openaiFileIds)
          ? metadata.openaiFileIds.filter((id): id is string => typeof id === 'string')
          : [];
        await prisma.courseSource.update({
          where: { id: source.id },
          data: {
            openaiFileId: fileId,
            metadataJson: toPrismaJson({
              ...metadata,
              openaiFileIds: Array.from(new Set([...existingIds, fileId])),
              aiInputFileName: source.title,
              aiInputMimeType: fileMime,
              notebookInput: 'openai_file_id',
            }),
          },
        });
      }
      await generateTeacherCourseNotebook({
        ownerId: args.ownerId,
        courseId: args.courseId,
        notebookId: args.notebookId,
        sourceId: source.id,
        courseCode: course.courseCode || course.name,
        courseTitle: course.name,
        sourceTitle: source.title,
        sourceFileId: fileId,
        sourceFileMime: fileMime,
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
      return;
    }
    const officeSource = sourceKind === 'docx' || sourceKind === 'pptx';
    if (officeSource) {
      await prisma.agentTask.update({
        where: { id: args.taskId },
        data: { stage: 'converting_to_pdf', progress: 12 },
      });
    }
    const originalFile = source.fileData ? Buffer.from(source.fileData) : null;
    const directOriginalFileInput =
      source.sourceCategory === 'problem_bank' &&
      originalFile &&
      (sourceKind === 'pdf' || sourceKind === 'markdown' || sourceKind === 'plain_text');
    const extracted = await (async () => {
      // Problem-bank PDFs are read by OpenAI from the original file below. Running the
      // general PDF parser here used to extract every embedded image, convert it to PNG,
      // and retain all Base64 copies in memory even though the import never consumed
      // them. Image-heavy exam PDFs could therefore exhaust a Vercel function before
      // the OpenAI import started. Keep the database-backed original as the source of
      // truth and skip that redundant, memory-heavy local pass.
      if (directOriginalFileInput && sourceKind === 'pdf') {
        return { text: '', pageCount: 1 };
      }
      if (!officeSource && source.extractedText?.trim()) {
        return { text: source.extractedText, pageCount: 1 };
      }
      try {
        return await extractText({
          title: source.title,
          mimeType: source.fileMime || 'application/octet-stream',
          data: Buffer.from(source.fileData!),
        });
      } catch (error) {
        // PDF question extraction uses the original OpenAI file input. Local
        // parsing remains useful for indexing, but it must not block a valid
        // visual PDF from reaching the model.
        if (directOriginalFileInput && sourceKind === 'pdf') {
          return { text: '', pageCount: 1 };
        }
        throw error;
      }
    })();
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
    const openAIFileInput = (() => {
      if (source.sourceCategory !== 'problem_bank' || !originalFile) return null;
      if (sourceKind === 'docx' || sourceKind === 'pptx') {
        if (!('previewPdf' in extracted) || !extracted.previewPdf) return null;
        return {
          buffer: extracted.previewPdf,
          fileName: derivedPdfFileName(source.title),
          mimeType: 'application/pdf',
        };
      }
      if (directOriginalFileInput) {
        return {
          buffer: originalFile,
          fileName: source.title,
          mimeType: source.fileMime || 'application/octet-stream',
        };
      }
      return null;
    })();
    if (text.length < 10 && !openAIFileInput && !source.openaiFileId) {
      throw new Error('源文件提取文字不足，无法导入课程题库');
    }

    await prisma.courseSource.update({
      where: { id: source.id },
      data: { extractedText: text || null, ingestStatus: 'processing', errorReason: null },
    });

    if (source.sourceCategory === 'problem_bank') {
      const runtimeConfig = await getSystemLLMRuntimeConfig();
      if (!runtimeConfig.apiKey) throw new Error('系统 OpenAI API Key 尚未配置。');
      let openaiFileId = source.openaiFileId;
      const sourceMetadata = jsonRecord(source.metadataJson);
      let openAIInputFileName =
        typeof sourceMetadata.aiInputFileName === 'string'
          ? sourceMetadata.aiInputFileName
          : source.title;
      let openAIInputMimeType =
        typeof sourceMetadata.aiInputMimeType === 'string'
          ? sourceMetadata.aiInputMimeType
          : source.fileMime || 'application/octet-stream';
      if (!openaiFileId && openAIFileInput) {
        await prisma.agentTask.update({
          where: { id: args.taskId },
          data: { stage: 'uploading_to_openai', progress: 25 },
        });
        openaiFileId = await uploadOpenAIUserFile(openAIFileInput);
        openAIInputFileName = openAIFileInput.fileName;
        openAIInputMimeType = openAIFileInput.mimeType;
        const existingOpenAIFileIds = Array.isArray(sourceMetadata.openaiFileIds)
          ? sourceMetadata.openaiFileIds.filter(
              (fileId): fileId is string => typeof fileId === 'string' && fileId.trim().length > 0,
            )
          : [];
        await prisma.courseSource.update({
          where: { id: source.id },
          data: {
            openaiFileId,
            metadataJson: toPrismaJson({
              ...sourceMetadata,
              openaiFileIds: Array.from(new Set([...existingOpenAIFileIds, openaiFileId])),
              aiInputFileName: openAIFileInput.fileName,
              aiInputMimeType: openAIFileInput.mimeType,
            }),
          },
        });
      }
      const task = await prisma.agentTask.findUniqueOrThrow({
        where: { id: args.taskId },
        select: { result: true, attemptCount: true },
      });
      const checkpointIdentity = createHash('sha256')
        .update(
          JSON.stringify({
            version: 1,
            sourceHash: source.sourceHash,
            model: runtimeConfig.modelId,
          }),
        )
        .digest('hex');
      const previous = jsonRecord(task.result);
      if (previous.checkpointIdentity !== checkpointIdentity) {
        await prisma.agentTask.update({
          where: { id: args.taskId },
          data: { result: toPrismaJson({ checkpointIdentity, checkpoints: {} }) },
        });
      }
      const saved =
        previous.checkpointIdentity === checkpointIdentity ? jsonRecord(previous.checkpoints) : {};
      const persistCheckpoint = async (key: string, value: unknown) => {
        // Atomic JSON updates preserve other batches finishing concurrently.
        const changed = await prisma.$executeRaw`
            UPDATE "AgentTask" SET "result" = jsonb_set("result", ARRAY['checkpoints', ${key}], ${JSON.stringify(toPrismaJson(value))}::jsonb, true), "updatedAt" = CURRENT_TIMESTAMP
            WHERE "id" = ${args.taskId} AND "status" = 'running' AND "attemptCount" = ${task.attemptCount}`;
        if (changed !== 1) throw new Error('处理任务已被替换，已停止本轮处理。');
      };
      const workerSignal = AbortSignal.timeout(Math.max(1, startedAt + 240_000 - Date.now()));
      const checkpoint = createImportCheckpoints({
        saved,
        deadline: startedAt + 150_000,
        signal: workerSignal,
        persist: persistCheckpoint,
      });
      const { model } = getServerOpenAIResponsesModel(
        {
          providerId: 'openai',
          providerType: 'openai',
          modelId: runtimeConfig.modelId,
          apiKey: runtimeConfig.apiKey,
          baseUrl: runtimeConfig.baseUrl,
          requiresApiKey: true,
        },
        {
          // Reserve a minute to save state and finish before Vercel's 300s limit.
          signal: workerSignal,
          loadResponseId: (key) => {
            const id = jsonRecord(saved[key]).responseId;
            if (typeof id !== 'string') return undefined;
            hasSavedResponse = true;
            return id;
          },
          saveResponseId: async (key, responseId) => {
            // Unlike a work checkpoint, save an already-created response even after
            // the launch deadline: losing its ID would duplicate the generation.
            await persistCheckpoint(key, { responseId });
            saved[key] = { responseId };
            hasSavedResponse = true;
          },
        },
      );
      await prisma.agentTask.update({
        where: { id: args.taskId },
        data: { stage: 'extracting_structure', progress: Math.max(30, initialTask.progress) },
      });
      const extractedProblems = openaiFileId
        ? await (async () => {
            return checkpoint('extraction', () =>
              llmExtractProblemDraftsFromOpenAIFile({
                fileId: openaiFileId!,
                checkpoint,
                onProgress: async ({ completed, total, questions }) => {
                  const progress = 40 + Math.floor((30 * completed) / Math.max(1, total));
                  // Parallel batches can finish out of order; never move the display backwards.
                  await prisma.$executeRaw`UPDATE "AgentTask" SET "progress" = ${progress}, "stage" = 'extracting_questions', "result" = jsonb_set("result", '{importProgress}', ${JSON.stringify({ completed, total, questions })}::jsonb, true), "updatedAt" = CURRENT_TIMESTAMP WHERE "id" = ${args.taskId} AND "status" = 'running' AND "attemptCount" = ${task.attemptCount} AND "progress" <= ${progress}`;
                },
                fileName: openAIInputFileName,
                mimeType: openAIInputMimeType,
                source: 'pdf',
                model,
                language: 'zh-CN',
                sourcePdfBuffer:
                  openAIFileInput?.mimeType === 'application/pdf'
                    ? openAIFileInput.buffer
                    : originalFile && sourceKind === 'pdf'
                      ? originalFile
                      : undefined,
              }),
            );
          })()
        : await extractProblemDraftsFromText({
            text,
            source: 'pdf',
            model,
            language: 'zh-CN',
          });
      // Crop real source figures, run deterministic checks and an independent answer
      // check. Problems that fail stay drafts with sourceMeta.importReview issues so the
      // teacher sees why, and bulk publish skips them.
      await prisma.agentTask.update({
        where: { id: args.taskId },
        data: { stage: 'checking_quality', progress: Math.max(75, initialTask.progress) },
      });
      const figureSource =
        openAIFileInput && openAIFileInput.mimeType === 'application/pdf'
          ? { buffer: openAIFileInput.buffer, mimeType: 'application/pdf' }
          : originalFile && sourceKind === 'pdf'
            ? { buffer: originalFile, mimeType: 'application/pdf' }
            : originalFile && sourceKind === 'image'
              ? { buffer: originalFile, mimeType: source.fileMime || 'image/png' }
              : null;
      const qualityBatches = [];
      for (let offset = 0; offset < extractedProblems.drafts.length; offset += 6) {
        qualityBatches.push(
          await checkpoint(`quality:${offset}`, () =>
            finalizeImportedDrafts({
              checkpoint: (key, work) => checkpoint(`quality:${offset}:${key}`, work),
              drafts: extractedProblems.drafts.slice(offset, offset + 6),
              source: figureSource,
              model,
              language: 'zh-CN',
            }),
          ),
        );
        await prisma.agentTask.update({
          where: { id: args.taskId },
          data: {
            stage: 'checking_quality',
            progress: Math.max(
              initialTask.progress,
              75 +
                Math.floor(
                  (20 * Math.min(offset + 6, extractedProblems.drafts.length)) /
                    Math.max(1, extractedProblems.drafts.length),
                ),
            ),
          },
        });
      }
      const finalized = {
        drafts: qualityBatches.flatMap((batch) => batch.drafts),
        skipped: qualityBatches.flatMap((batch) => batch.skipped),
        report: qualityBatches.reduce(
          (report, batch) => ({
            total: report.total + batch.report.total,
            passed: report.passed + batch.report.passed,
            needsReview: report.needsReview + batch.report.needsReview,
            skippedSolutionOnly: report.skippedSolutionOnly + batch.report.skippedSolutionOnly,
            figuresAttached: report.figuresAttached + batch.report.figuresAttached,
            uniqueFigures: report.uniqueFigures + batch.report.uniqueFigures,
            issueCounts: Object.fromEntries(
              [
                ...new Set([
                  ...Object.keys(report.issueCounts),
                  ...Object.keys(batch.report.issueCounts),
                ]),
              ].map((key) => [
                key,
                (report.issueCounts[key] ?? 0) +
                  (Object.entries(batch.report.issueCounts).find(([code]) => code === key)?.[1] ??
                    0),
              ]),
            ),
          }),
          {
            total: 0,
            passed: 0,
            needsReview: 0,
            skippedSolutionOnly: 0,
            figuresAttached: 0,
            uniqueFigures: 0,
            issueCounts: {} as Record<string, number>,
          },
        ),
      };
      await prisma.agentTask.update({
        where: { id: args.taskId },
        data: { stage: 'saving_questions', progress: 97 },
      });
      await createCourseProblemsFromDraftsWithSummary({
        userId: args.ownerId,
        courseId: args.courseId,
        drafts: finalized.drafts.map((draft) => ({
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
      // Re-read: the OpenAI upload step above may have written file IDs into metadata.
      const latestSourceMetadata = jsonRecord(
        (
          await prisma.courseSource.findUnique({
            where: { id: source.id },
            select: { metadataJson: true },
          })
        )?.metadataJson,
      );
      await Promise.all([
        prisma.courseSource.update({
          where: { id: source.id },
          data: {
            ingestStatus: 'ready',
            indexStatus: 'ready',
            ingestedAt: new Date(),
            indexedAt: new Date(),
            errorReason: null,
            metadataJson: toPrismaJson({
              ...latestSourceMetadata,
              importQualityReport: {
                ...finalized.report,
                coverage: summarizeCoverage(
                  'coverage' in extractedProblems
                    ? (extractedProblems.coverage as Parameters<typeof summarizeCoverage>[0])
                    : undefined,
                ),
                generatedAt: new Date().toISOString(),
              },
              importSkipped: finalized.skipped,
            }),
          },
        }),
        prisma.agentTask.update({
          where: { id: args.taskId },
          data: {
            status: 'completed',
            stage: 'completed',
            progress: 100,
            error: null,
            result: toPrismaJson({ importedQuestions: finalized.drafts.length }),
          },
        }),
      ]);
      return;
    }
  } catch (error) {
    if (
      error instanceof ImportContinuationRequired ||
      (hasSavedResponse && error instanceof Error && /^(AbortError|TimeoutError)$/.test(error.name))
    ) {
      await prisma.agentTask.update({
        where: { id: args.taskId },
        data: { status: 'queued', stage: 'awaiting_resume', error: null },
      });
      return;
    }
    const rawMessage = error instanceof Error ? error.message : '源文件处理失败';
    const message = /abort|timeout|timed out/i.test(rawMessage)
      ? 'AI 本轮响应超时，已完成的批次已保存。点击继续处理可接着完成。'
      : rawMessage;
    await Promise.allSettled([
      prisma.courseSource.update({
        where: { id: args.sourceId },
        data: { ingestStatus: 'error', errorReason: message },
      }),
      prisma.agentTask.update({
        where: { id: args.taskId },
        data: { status: 'failed', stage: 'failed', error: message },
      }),
    ]);
  }
}
