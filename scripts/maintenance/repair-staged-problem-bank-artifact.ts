#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';
import Module from 'node:module';
import path from 'node:path';
import type { NotebookProblemImportDraft } from '../../lib/problem-bank';

function usage(): never {
  console.error(
    'Usage: jiti scripts/maintenance/repair-staged-problem-bank-artifact.ts <input.json> <output.json>',
  );
  process.exit(1);
}

function hasAnswer(draft: NotebookProblemImportDraft): boolean {
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

  const [serverModel, problemImport, requestContext] = await Promise.all([
    import('../../lib/ai/server-model'),
    import('../../lib/server/notebook-problems/import.core'),
    import('../../lib/server/request-context'),
  ]);
  const inputPath = path.resolve(inputPathArg);
  const outputPath = path.resolve(outputPathArg);
  const artifact = JSON.parse(await readFile(inputPath, 'utf8')) as {
    drafts: NotebookProblemImportDraft[];
    usage?: unknown;
    [key: string]: unknown;
  };
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  const modelId = (process.env.DEFAULT_MODEL?.trim() || 'gpt-5.6-luna').replace(/^openai:/, '');
  if (!apiKey) throw new Error('OPENAI_API_KEY is required.');

  const { model } = serverModel.getServerOpenAIResponsesModel({
    providerId: 'openai',
    providerType: 'openai',
    modelId,
    apiKey,
    baseUrl: process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1',
    requiresApiKey: true,
  });
  const repaired = await requestContext.withRequestContext(
    {
      route: 'maintenance:repair-staged-problem-bank-artifact',
      skipCreditCharge: true,
    },
    async () => {
      const answerResult = await problemImport.ensureImportedDraftAnswers({
        drafts: artifact.drafts,
        model,
        language: 'zh-CN',
      });
      const codeResult = await problemImport.ensureImportedCodeDraftsJudgeReady({
        drafts: answerResult.drafts,
        model,
        language: 'zh-CN',
      });
      return {
        drafts: codeResult.drafts,
        usage: problemImport.mergeImportUsage(answerResult.usage, codeResult.usage),
      };
    },
  );

  const byType = Object.fromEntries(
    [...new Set(repaired.drafts.map((draft) => draft.type))]
      .sort()
      .map((type) => [type, repaired.drafts.filter((draft) => draft.type === type).length]),
  );
  const output = {
    ...artifact,
    postProcessedAt: new Date().toISOString(),
    problemCount: repaired.drafts.length,
    answerCompleteCount: repaired.drafts.filter(hasAnswer).length,
    byType,
    postProcessUsage: repaired.usage,
    drafts: repaired.drafts,
  };
  await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(
    `Wrote ${repaired.drafts.length} repaired drafts (${output.answerCompleteCount} with answers) to ${outputPath}`,
  );
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
