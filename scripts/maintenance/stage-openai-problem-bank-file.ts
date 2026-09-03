#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import Module from 'node:module';
import path from 'node:path';

function usage(): never {
  console.error(
    'Usage: jiti scripts/maintenance/stage-openai-problem-bank-file.ts <input.pdf> <output.json>',
  );
  process.exit(1);
}

type ExtractedDraft = Awaited<
  ReturnType<
    (typeof import('../../lib/server/notebook-problems/import.core.llm'))['llmExtractProblemDraftsFromOpenAIFile']
  >
>['drafts'][number];

function hasAnswer(draft: ExtractedDraft): boolean {
  const grading = draft.grading;
  if (grading.type === 'choice') return grading.correctOptionIds.length > 0;
  if (grading.type === 'calculation') {
    return Boolean(grading.referenceAnswer || grading.acceptedForms.length);
  }
  if (grading.type === 'short_answer') return Boolean(grading.referenceAnswer);
  if (grading.type === 'proof') return Boolean(grading.referenceProof);
  if (grading.type === 'fill_blank') {
    return (
      grading.blanks.length > 0 && grading.blanks.every((blank) => blank.acceptedAnswers.length > 0)
    );
  }
  return Boolean(grading.solutionCode || grading.referenceAnswer);
}

async function main() {
  const [, , inputPathArg, outputPathArg] = process.argv;
  if (!inputPathArg || !outputPathArg) usage();

  const root = path.resolve(__dirname, '../..');
  type ResolveFilename = (
    request: string,
    parent: NodeModule | undefined,
    isMain: boolean,
    options?: { paths?: string[] },
  ) => string;
  const commonJsModule = Module as unknown as { _resolveFilename: ResolveFilename };
  const originalResolveFilename = commonJsModule._resolveFilename;
  commonJsModule._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    const resolvedRequest = request.startsWith('@/') ? path.join(root, request.slice(2)) : request;
    return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
  };

  const [serverModel, openAIUserFiles, problemImport] = await Promise.all([
    import('../../lib/ai/server-model'),
    import('../../lib/server/openai-user-files'),
    import('../../lib/server/notebook-problems/import.core.llm'),
  ]);
  const inputPath = path.resolve(inputPathArg);
  const outputPath = path.resolve(outputPathArg);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const modelId = (process.env.DEFAULT_MODEL?.trim() || 'gpt-5.6-luna').replace(/^openai:/, '');
  if (!apiKey) throw new Error('OPENAI_API_KEY is required.');

  const buffer = await readFile(inputPath);
  const existingFileId = process.env.OPENAI_FILE_ID?.trim();
  if (!existingFileId) {
    console.log(
      `Uploading ${path.basename(inputPath)} (${buffer.byteLength} bytes) to OpenAI Files...`,
    );
  }
  const fileId =
    existingFileId ??
    (await openAIUserFiles.uploadOpenAIUserFile({
      buffer,
      fileName: path.basename(inputPath),
      mimeType: 'application/pdf',
    }));
  console.log(`Uploaded file ${fileId}; extracting with ${modelId}...`);

  const { model } = serverModel.getServerOpenAIResponsesModel({
    providerId: 'openai',
    providerType: 'openai',
    modelId,
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
    requiresApiKey: true,
  });
  const extracted = await problemImport.llmExtractProblemDraftsFromOpenAIFile({
    fileId,
    fileName: path.basename(inputPath),
    mimeType: 'application/pdf',
    source: 'pdf',
    model,
    language: 'zh-CN',
  });

  const answerCompleteCount = extracted.drafts.filter(hasAnswer).length;
  const byType = Object.fromEntries(
    [...new Set(extracted.drafts.map((draft) => draft.type))]
      .sort()
      .map((type) => [type, extracted.drafts.filter((draft) => draft.type === type).length]),
  );
  const artifact = {
    generatedAt: new Date().toISOString(),
    sourceFile: inputPath,
    openaiFileId: fileId,
    modelId,
    problemCount: extracted.drafts.length,
    answerCompleteCount,
    byType,
    usage: extracted.usage,
    drafts: extracted.drafts,
  };
  await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  console.log(
    `Wrote ${extracted.drafts.length} drafts (${answerCompleteCount} with answers) to ${outputPath}`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
