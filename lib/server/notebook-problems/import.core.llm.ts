import type { LanguageModel } from 'ai';
import { jsonrepair } from 'jsonrepair';
import { callLLM } from '@/lib/ai/llm';
import type { NotebookProblemImportDraft, NotebookProblemSource } from '@/lib/problem-bank';
import {
  problemStructurePlanSchema,
  type ImportUsageSummary,
  type ProblemStructureItem,
  type ProblemStructurePlan,
} from './import.core.types';
import { normalizeMathMarkdown, stripCodeFences } from './import.core.text';
import {
  normalizeCandidateDraft,
  normalizeDraftMathFields,
  parseProblemDraftArrayFromLLMText,
} from './import.core.drafts';
import { buildProblemImportSystemPrompt } from './import.core.prompts';
import {
  isMissingChoiceAnswerDraft,
  llmUsageFromResult,
  mergeImportUsage,
  parseChoiceAnswerResults,
  removeMissingAnswerValidationErrors,
} from './import.core.usage';

const OPENAI_FILE_PROBLEM_BATCH_SIZE = 8;
const OPENAI_FILE_BATCH_CONCURRENCY = 4;

function usageFromLLMResult(
  model: LanguageModel,
  result: Awaited<ReturnType<typeof callLLM>>,
): ImportUsageSummary | null {
  return llmUsageFromResult({
    model,
    inputTokens: result.usage.inputTokens ?? 0,
    outputTokens: result.usage.outputTokens ?? 0,
    cachedInputTokens: result.usage.cachedInputTokens ?? 0,
  });
}

function parseOpenAIFileStructurePlan(text: string): ProblemStructurePlan | null {
  const stripped = stripCodeFences(text);
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const raw = JSON.parse(jsonrepair(stripped.slice(start, end + 1))) as Record<string, unknown>;
    const parsed =
      raw.structurePlan && typeof raw.structurePlan === 'object'
        ? (raw.structurePlan as Record<string, unknown>)
        : raw;
    const sharedContexts = Array.isArray(parsed.sharedContexts) ? parsed.sharedContexts : [];
    const sharedContextById = new Map(
      sharedContexts.flatMap((context) => {
        if (!context || typeof context !== 'object') return [];
        const record = context as Record<string, unknown>;
        return typeof record.id === 'string' ? [[record.id, record] as const] : [];
      }),
    );
    const topLevelProblems = Array.isArray(parsed.topLevelProblems)
      ? parsed.topLevelProblems.map((problem) => {
          if (!problem || typeof problem !== 'object') return problem;
          const record = problem as Record<string, unknown>;
          const contextBlocks = Array.isArray(record.contextBlocks)
            ? record.contextBlocks.flatMap((context) => {
                if (context && typeof context === 'object') return [context];
                if (typeof context !== 'string') return [];
                const shared = sharedContextById.get(context);
                return [
                  {
                    kind: 'other',
                    title:
                      typeof shared?.title === 'string'
                        ? shared.title
                        : `Shared context ${context}`,
                    summary:
                      typeof shared?.summary === 'string'
                        ? shared.summary
                        : `See shared context ${context}.`,
                  },
                ];
              })
            : [];
          const subparts = Array.isArray(record.subparts)
            ? record.subparts.flatMap((subpart) => {
                if (!subpart || typeof subpart !== 'object') return [];
                const subpartRecord = subpart as Record<string, unknown>;
                const label = String(subpartRecord.label ?? '').trim();
                const prompt = String(
                  subpartRecord.prompt ?? subpartRecord.title ?? `Subpart ${label}`,
                ).trim();
                if (!label || !prompt) return [];
                return [
                  {
                    label,
                    prompt,
                    ...(typeof subpartRecord.points === 'number'
                      ? { points: subpartRecord.points }
                      : {}),
                  },
                ];
              })
            : [];
          return { ...record, contextBlocks, subparts };
        })
      : [];
    return {
      ...problemStructurePlanSchema.parse({ ...parsed, topLevelProblems }),
      generatedBy: 'llm',
    };
  } catch {
    return null;
  }
}

function draftHasCompleteAnswer(draft: NotebookProblemImportDraft): boolean {
  if (draft.validationErrors.some((error) => error.includes('未识别到正确答案'))) return false;
  if (draft.grading.type === 'choice') return draft.grading.correctOptionIds.length > 0;
  if (draft.grading.type === 'calculation') {
    return Boolean(draft.grading.referenceAnswer?.trim() || draft.grading.acceptedForms.length > 0);
  }
  if (draft.grading.type === 'short_answer') return Boolean(draft.grading.referenceAnswer?.trim());
  if (draft.grading.type === 'proof') return Boolean(draft.grading.referenceProof?.trim());
  if (draft.grading.type === 'fill_blank') {
    return (
      draft.grading.blanks.length > 0 &&
      draft.grading.blanks.every((blank) => blank.acceptedAnswers.some((answer) => answer.trim()))
    );
  }
  return Boolean(draft.grading.solutionCode?.trim() || draft.grading.referenceAnswer?.trim());
}

function enrichFileDraftSourceMeta(
  draft: NotebookProblemImportDraft,
  structureItem: ProblemStructureItem | undefined,
): NotebookProblemImportDraft {
  if (!structureItem) return { ...draft, notebookId: null };
  return {
    ...draft,
    notebookId: null,
    sourceMeta: {
      ...draft.sourceMeta,
      scaffoldIndex: structureItem.index,
      topLevelLabel: structureItem.topLevelLabel,
      pageStart: structureItem.pageStart,
      pageEnd: structureItem.pageEnd,
      sourceAnchors: structureItem.sourceAnchors,
      structureConfidence: structureItem.confidence,
    },
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await mapper(items[index]!, index);
      }
    }),
  );
  return results;
}

export async function solveMissingChoiceAnswersWithLLM(args: {
  drafts: NotebookProblemImportDraft[];
  model?: LanguageModel;
  language: 'zh-CN' | 'en-US';
}): Promise<{ drafts: NotebookProblemImportDraft[]; usage: ImportUsageSummary | null }> {
  if (!args.model) return { drafts: args.drafts, usage: null };
  const candidates = args.drafts.filter(isMissingChoiceAnswerDraft);
  if (candidates.length === 0) return { drafts: args.drafts, usage: null };

  const prompt =
    args.language === 'zh-CN'
      ? `请解答下面这些选择题，并返回严格 JSON，不要 markdown。
返回格式：
[
  {
    "draftId": "原 draftId",
    "correctOptionIds": ["A"],
    "analysis": "简短说明为什么选择这些选项",
    "confidence": 0.0 到 1.0
  }
]
要求：
- 必须只使用题干和选项中已有的信息作答。
- 如果是多选题，可以返回多个选项 id。
- 如果缺少图、表、front page、Diagram、Table 等关键上下文，无法可靠解答，则不要返回该题的答案。
- 不要为了满足格式而猜测。

题目：
${JSON.stringify(
  candidates.map((draft) => ({
    draftId: draft.draftId,
    title: draft.title,
    stem: draft.publicContent.type === 'choice' ? draft.publicContent.stem : '',
    selectionMode:
      draft.publicContent.type === 'choice' ? draft.publicContent.selectionMode : 'single',
    options:
      draft.publicContent.type === 'choice'
        ? draft.publicContent.options.map((option) => ({
            id: option.id,
            label: option.label,
          }))
        : [],
  })),
)}`.slice(0, 24000)
      : `Solve the following multiple-choice questions and return strict JSON only.
Return shape:
[
  {
    "draftId": "original draftId",
    "correctOptionIds": ["A"],
    "analysis": "brief reason for the selected option ids",
    "confidence": 0.0 to 1.0
  }
]
Rules:
- Use only the information already present in the stem and options.
- Return multiple option ids for multiple-select questions when appropriate.
- If critical context is missing, such as a table, diagram, front page, or referenced visual, do not return an answer for that question.
- Do not guess just to satisfy the schema.

Questions:
${JSON.stringify(
  candidates.map((draft) => ({
    draftId: draft.draftId,
    title: draft.title,
    stem: draft.publicContent.type === 'choice' ? draft.publicContent.stem : '',
    selectionMode:
      draft.publicContent.type === 'choice' ? draft.publicContent.selectionMode : 'single',
    options:
      draft.publicContent.type === 'choice'
        ? draft.publicContent.options.map((option) => ({
            id: option.id,
            label: option.label,
          }))
        : [],
  })),
)}`.slice(0, 24000);

  let result: Awaited<ReturnType<typeof callLLM>>;
  try {
    result = await callLLM(
      {
        model: args.model,
        system:
          args.language === 'zh-CN'
            ? '你是严谨的大学数学/计算机课程助教。你的任务是解选择题并返回机器可解析 JSON。'
            : 'You are a rigorous university math/computer-science teaching assistant. Solve multiple-choice questions and return machine-readable JSON.',
        prompt,
      },
      'problem-bank-import-answer-solve',
    );
  } catch {
    return { drafts: args.drafts, usage: null };
  }

  let answers: ReturnType<typeof parseChoiceAnswerResults>;
  try {
    answers = parseChoiceAnswerResults(result.text);
  } catch {
    answers = [];
  }
  if (answers.length === 0) {
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    const cachedInputTokens = result.usage.cachedInputTokens ?? 0;
    return {
      drafts: args.drafts,
      usage: llmUsageFromResult({
        model: args.model,
        inputTokens,
        outputTokens,
        cachedInputTokens,
      }),
    };
  }

  const answerByDraftId = new Map(answers.map((answer) => [answer.draftId, answer]));
  const solvedDrafts = args.drafts.map((draft) => {
    if (
      draft.type !== 'choice' ||
      draft.publicContent.type !== 'choice' ||
      draft.grading.type !== 'choice'
    ) {
      return draft;
    }
    const answer = answerByDraftId.get(draft.draftId);
    if (!answer) return draft;
    const validOptionIds = new Set(draft.publicContent.options.map((option) => option.id));
    const correctOptionIds = answer.correctOptionIds.filter((optionId) =>
      validOptionIds.has(optionId),
    );
    if (correctOptionIds.length === 0) return draft;
    return normalizeDraftMathFields({
      ...draft,
      publicContent: {
        ...draft.publicContent,
        selectionMode: correctOptionIds.length > 1 ? 'multiple' : draft.publicContent.selectionMode,
      },
      grading: {
        ...draft.grading,
        correctOptionIds,
        analysis: answer.analysis ? normalizeMathMarkdown(answer.analysis) : draft.grading.analysis,
      },
      sourceMeta: {
        ...draft.sourceMeta,
        answerSource: 'llm-solved',
        answerConfidence: answer.confidence ?? null,
      },
      validationErrors: removeMissingAnswerValidationErrors(draft.validationErrors),
    });
  });

  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  const cachedInputTokens = result.usage.cachedInputTokens ?? 0;
  return {
    drafts: solvedDrafts,
    usage: llmUsageFromResult({
      model: args.model,
      inputTokens,
      outputTokens,
      cachedInputTokens,
    }),
  };
}

export async function llmExtractProblemDrafts(args: {
  text: string;
  source: NotebookProblemSource;
  model: LanguageModel;
  language: 'zh-CN' | 'en-US';
}): Promise<{
  drafts: NotebookProblemImportDraft[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    estimatedCostCredits: number | null;
  } | null;
}> {
  const system = buildProblemImportSystemPrompt(args.language);

  const prompt = `${args.language === 'zh-CN' ? '来源类型' : 'Source'}: ${args.source}

${args.language === 'zh-CN' ? '原始材料' : 'Raw material'}:
${args.text}`.slice(0, 24000);

  const result = await callLLM(
    {
      model: args.model,
      system,
      prompt,
      maxOutputTokens: 16000,
    },
    'problem-bank-import-preview',
  );
  const parsed = parseProblemDraftArrayFromLLMText(result.text);
  const inputTokens = result.usage.inputTokens ?? 0;
  const outputTokens = result.usage.outputTokens ?? 0;
  const cachedInputTokens = result.usage.cachedInputTokens ?? 0;
  const drafts = parsed.map((item) => normalizeCandidateDraft(item, args.source));
  const answerResult = await solveMissingChoiceAnswersWithLLM({
    drafts,
    model: args.model,
    language: args.language,
  });
  return {
    drafts: answerResult.drafts,
    usage: mergeImportUsage(
      llmUsageFromResult({
        model: args.model,
        inputTokens,
        outputTokens,
        cachedInputTokens,
      }),
      answerResult.usage,
    ),
  };
}

export async function llmExtractProblemDraftsFromOpenAIFile(args: {
  fileId: string;
  fileName: string;
  mimeType: string;
  source: NotebookProblemSource;
  model: LanguageModel;
  language: 'zh-CN' | 'en-US';
}): Promise<{
  drafts: NotebookProblemImportDraft[];
  usage: ImportUsageSummary | null;
}> {
  const system = buildProblemImportSystemPrompt(args.language);
  const structureInstruction =
    args.language === 'zh-CN'
      ? `请通读附件的每一页，但本轮只生成题目结构目录，不要解题。返回严格 JSON 对象，不要 markdown。
必须区分印刷的原始题面与学生手写答案、圈选气泡、阅卷批注、得分和评分反馈。后五者都不是题目。封面、参考页、答题卡和空白页必须放入 nonProblemRegions。
每个最顶层题号只生成一个 topLevelProblems 条目，小问放入 subparts，不要把小问拆成新的顶层题。仔细识别选择题、填空题、计算题、简答题、证明题和代码题。
JSON 格式：
{
  "sourceSummary": "...",
  "nonProblemRegions": [{"kind":"cover|instructions|additional_work|blank|header_footer|other","pageNumbers":[1],"reason":"..."}],
  "sharedContexts": [{"id":"...","title":"...","pageNumbers":[1],"summary":"..."}],
  "topLevelProblems": [{"index":1,"topLevelLabel":"1","title":"...","problemTypeHint":"choice|proof|calculation|short_answer|code|fill_blank|unknown","pageStart":2,"pageEnd":2,"sourceAnchors":[{"pageNumber":2,"textQuote":"...","role":"problem"}],"subparts":[],"contextBlocks":[],"visualRefs":[],"confidence":0.9}],
  "warnings": [],
  "generatedBy": "llm"
}`
      : `Read every page of the attached file, but in this pass create only a structural problem index; do not solve anything. Return one strict JSON object without markdown.
Separate printed source questions from student handwriting, marked bubbles, grader annotations, scores, and grading feedback. The latter are not problems. Put covers, reference sheets, answer sheets, and blank pages in nonProblemRegions.
Create exactly one topLevelProblems item per top-level question number. Keep its subparts inside subparts rather than splitting them into separate top-level questions. Distinguish choice, fill_blank, calculation, short_answer, proof, and code.
Return: {"sourceSummary":"...","nonProblemRegions":[{"kind":"cover|instructions|additional_work|blank|header_footer|other","pageNumbers":[1],"reason":"..."}],"sharedContexts":[],"topLevelProblems":[{"index":1,"topLevelLabel":"1","title":"...","problemTypeHint":"choice|proof|calculation|short_answer|code|fill_blank|unknown","pageStart":2,"pageEnd":2,"sourceAnchors":[{"pageNumber":2,"textQuote":"...","role":"problem"}],"subparts":[],"contextBlocks":[],"visualRefs":[],"confidence":0.9}],"warnings":[],"generatedBy":"llm"}`;
  const structureResult = await callLLM(
    {
      model: args.model,
      system:
        args.language === 'zh-CN'
          ? '你是严谨的试卷结构分析器，只输出机器可解析的 JSON。'
          : 'You are a rigorous exam structure analyzer. Output machine-readable JSON only.',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: structureInstruction },
            {
              type: 'file',
              data: args.fileId,
              mediaType: args.mimeType,
              filename: args.fileName,
            },
          ],
        },
      ],
      maxOutputTokens: 10000,
    },
    'problem-bank-import-openai-file-structure',
  );
  let usage = usageFromLLMResult(args.model, structureResult);
  const structurePlan = parseOpenAIFileStructurePlan(structureResult.text);

  // A malformed structure response should not make ordinary, short documents unimportable.
  // Fall back to the former single pass, while retaining the answer-complete contract.
  if (!structurePlan || structurePlan.topLevelProblems.length === 0) {
    const fallbackInstruction =
      args.language === 'zh-CN'
        ? '请直接阅读附加的原始文件，识别全部印刷题目，独立解出每题并为每道题生成可判分的标准答案。忽略学生手写和阅卷批注。返回严格 JSON 数组，题目不归入任何笔记本。'
        : 'Read the original file, extract every printed problem, independently solve each one, and generate a gradable reference answer for every problem. Ignore student handwriting and grader annotations. Return a strict JSON array without notebook assignment.';
    const fallbackResult = await callLLM(
      {
        model: args.model,
        system,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: fallbackInstruction },
              {
                type: 'file',
                data: args.fileId,
                mediaType: args.mimeType,
                filename: args.fileName,
              },
            ],
          },
        ],
        maxOutputTokens: 32000,
      },
      'problem-bank-import-openai-file-fallback',
    );
    usage = mergeImportUsage(usage, usageFromLLMResult(args.model, fallbackResult));
    const fallbackDrafts = parseProblemDraftArrayFromLLMText(fallbackResult.text).map((item) => ({
      ...normalizeCandidateDraft(item, args.source),
      notebookId: null,
    }));
    const fallbackAnswers = await solveMissingChoiceAnswersWithLLM({
      drafts: fallbackDrafts,
      model: args.model,
      language: args.language,
    });
    return {
      drafts: fallbackAnswers.drafts.map((draft) => ({ ...draft, notebookId: null })),
      usage: mergeImportUsage(usage, fallbackAnswers.usage),
    };
  }

  const batches: ProblemStructureItem[][] = [];
  for (
    let index = 0;
    index < structurePlan.topLevelProblems.length;
    index += OPENAI_FILE_PROBLEM_BATCH_SIZE
  ) {
    batches.push(
      structurePlan.topLevelProblems.slice(index, index + OPENAI_FILE_PROBLEM_BATCH_SIZE),
    );
  }

  const batchResults = await mapWithConcurrency(
    batches,
    OPENAI_FILE_BATCH_CONCURRENCY,
    async (batch) => {
      const batchOutline = JSON.stringify(
        batch.map((item) => ({
          index: item.index,
          topLevelLabel: item.topLevelLabel,
          title: item.title,
          problemTypeHint: item.problemTypeHint,
          pageStart: item.pageStart,
          pageEnd: item.pageEnd,
          subparts: item.subparts,
          contextBlocks: item.contextBlocks,
          visualRefs: item.visualRefs,
        })),
      );
      const baseInstruction =
        args.language === 'zh-CN'
          ? `现在只处理下列 ${batch.length} 道顶层题：${batchOutline}
请回到附件指定页面，完整转写印刷题面，并独立解出每道题。忽略学生手写、勾选、阅卷痕迹、得分和评分反馈；不得把它们当成标准答案。
必须恰好返回 ${batch.length} 个题目草稿，顺序与目录一致，小问保留在同一道题中。每题 sourceMeta.scaffoldIndex 填对应 index。
每道题都必须有可判分答案：选择题填 correctOptionIds；计算题填 referenceAnswer 和 acceptedForms；填空题逐空填 acceptedAnswers；简答题填 referenceAnswer；证明题填 referenceProof；代码题填 solutionCode/referenceAnswer 并生成测试。
只返回严格 JSON 数组。`
          : `Process only these ${batch.length} top-level problems: ${batchOutline}
Return to the cited pages, transcribe the complete printed prompt, and independently solve every problem. Ignore handwriting, marked bubbles, grading marks, scores, and grader feedback; none is an answer source.
Return exactly ${batch.length} drafts in the same order, with subparts kept in their top-level problem. Set sourceMeta.scaffoldIndex to the corresponding index.
Every problem must have a gradable answer: correctOptionIds for choice; referenceAnswer and acceptedForms for calculation; acceptedAnswers for every fill blank; referenceAnswer for short answer; referenceProof for proof; solutionCode/referenceAnswer plus tests for code. Return a strict JSON array only.`;

      let bestDrafts: NotebookProblemImportDraft[] = [];
      let batchUsage: ImportUsageSummary | null = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const retrySuffix =
          attempt === 0
            ? ''
            : args.language === 'zh-CN'
              ? '\n上一次输出缺少题目或标准答案。请重新检查每题的 grading，返回修正后的完整数组。'
              : '\nThe previous output omitted problems or reference answers. Recheck every grading object and return the complete corrected array.';
        const result = await callLLM(
          {
            model: args.model,
            system,
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'text', text: `${baseInstruction}${retrySuffix}` },
                  {
                    type: 'file',
                    data: args.fileId,
                    mediaType: args.mimeType,
                    filename: args.fileName,
                  },
                ],
              },
            ],
            maxOutputTokens: 16000,
          },
          attempt === 0
            ? 'problem-bank-import-openai-file-batch'
            : 'problem-bank-import-openai-file-batch-retry',
        );
        batchUsage = mergeImportUsage(batchUsage, usageFromLLMResult(args.model, result));
        const rawDrafts = parseProblemDraftArrayFromLLMText(result.text).slice(0, batch.length);
        const normalized = rawDrafts.map((item, index) =>
          enrichFileDraftSourceMeta(
            normalizeCandidateDraft(item, args.source),
            batch.find(
              (structureItem) =>
                typeof item === 'object' &&
                item !== null &&
                typeof (item as { sourceMeta?: { scaffoldIndex?: unknown } }).sourceMeta
                  ?.scaffoldIndex === 'number' &&
                (item as { sourceMeta: { scaffoldIndex: number } }).sourceMeta.scaffoldIndex ===
                  structureItem.index,
            ) ?? batch[index],
          ),
        );
        if (
          bestDrafts.length === 0 ||
          normalized.filter(draftHasCompleteAnswer).length >
            bestDrafts.filter(draftHasCompleteAnswer).length
        ) {
          bestDrafts = normalized;
        }
        if (normalized.length === batch.length && normalized.every(draftHasCompleteAnswer)) break;
      }
      if (bestDrafts.length !== batch.length || !bestDrafts.every(draftHasCompleteAnswer)) {
        const completeCount = bestDrafts.filter(draftHasCompleteAnswer).length;
        throw new Error(
          args.language === 'zh-CN'
            ? `PDF 题目批次 ${batch[0]?.index}-${batch.at(-1)?.index} 抽取不完整：期望 ${batch.length} 题，实际 ${bestDrafts.length} 题，其中 ${completeCount} 题有标准答案。`
            : `Incomplete PDF batch ${batch[0]?.index}-${batch.at(-1)?.index}: expected ${batch.length} problems, received ${bestDrafts.length}, with ${completeCount} complete answers.`,
        );
      }
      return { drafts: bestDrafts, usage: batchUsage };
    },
  );

  let drafts = batchResults.flatMap((result) => result.drafts);
  for (const result of batchResults) usage = mergeImportUsage(usage, result.usage);
  const answerResult = await solveMissingChoiceAnswersWithLLM({
    drafts,
    model: args.model,
    language: args.language,
  });
  drafts = answerResult.drafts
    .map((draft) => ({ ...draft, notebookId: null }))
    .sort((left, right) => {
      const leftIndex = Number(left.sourceMeta.scaffoldIndex ?? Number.MAX_SAFE_INTEGER);
      const rightIndex = Number(right.sourceMeta.scaffoldIndex ?? Number.MAX_SAFE_INTEGER);
      return leftIndex - rightIndex;
    });
  return {
    drafts,
    usage: mergeImportUsage(usage, answerResult.usage),
  };
}
