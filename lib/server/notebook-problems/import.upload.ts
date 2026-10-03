import type { StructureCoverage } from './import.coverage';
import type { LanguageModel } from 'ai';
import { uploadOpenAIUserFile } from '@/lib/server/openai-user-files';
import { llmExtractProblemDraftsFromOpenAIFile } from './import.core.llm';
import { finalizeImportedDrafts } from './import.quality-gates';
import { mergeImportUsage } from './import.core.usage';

/** The file-import pipeline shared by external callers: extraction, then source figures. */
export async function importUploadedProblemFile(args: {
  buffer: Buffer;
  fileName: string;
  model: LanguageModel;
  language: 'zh-CN' | 'en-US';
  verifyAnswers?: boolean;
}) {
  const mimeType = 'application/pdf';
  const fileId = await uploadOpenAIUserFile({
    buffer: args.buffer,
    fileName: args.fileName,
    mimeType,
  });
  const extracted = await llmExtractProblemDraftsFromOpenAIFile({
    fileId,
    fileName: args.fileName,
    mimeType,
    source: 'pdf',
    model: args.model,
    language: args.language,
    sourcePdfBuffer: args.buffer,
  });
  const finalized = await finalizeImportedDrafts({
    drafts: extracted.drafts,
    source: { buffer: args.buffer, mimeType },
    model: args.model,
    language: args.language,
    verifyAnswers: args.verifyAnswers ?? false,
  });
  return {
    fileId,
    firstPass: extracted.drafts,
    ...finalized,
    coverage: summarizeCoverage(extracted.coverage),
    usage: mergeImportUsage(extracted.usage, finalized.usage),
  };
}

/** Compact, client-facing view of printed-question coverage. */
export function summarizeCoverage(coverage: StructureCoverage | undefined) {
  if (!coverage?.checked) return { checked: false as const };
  return {
    checked: true as const,
    printedQuestionCount: coverage.printed.length,
    missingQuestions: coverage.missing.map((label) => label.label),
    mergedItems: coverage.merged.map((item) => ({
      label: item.topLevelLabel,
      covers: item.covers,
    })),
  };
}
