import type { LanguageModel } from 'ai';
import { jsonrepair } from 'jsonrepair';
import { callLLM } from '@/lib/ai/llm';
import {
  codeReferenceSolution,
  withoutCodeReadinessErrors,
  type NotebookProblemImportDraft,
  type NotebookProblemSource,
} from '@/lib/problem-bank';
import { verifyNotebookCodeDraftReferenceAnswer } from './judge';
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

export function draftHasCompleteAnswer(draft: NotebookProblemImportDraft): boolean {
  if (draft.validationErrors.some((error) => error.includes('未识别到正确答案'))) return false;
  if (draft.grading.type === 'choice') return draft.grading.correctOptionIds.length > 0;
  if (draft.grading.type === 'calculation') {
    return Boolean(draft.grading.referenceAnswer?.trim() || draft.grading.acceptedForms.length > 0);
  }
  if (draft.grading.type === 'short_answer') {
    return Boolean(
      draft.grading.referenceAnswer?.trim() &&
      (draft.publicContent.contractVersion !== 'syntara.problem.v1' ||
        draft.grading.rubricCriteria?.length),
    );
  }
  if (draft.grading.type === 'proof') {
    return Boolean(
      draft.grading.referenceProof?.trim() &&
      (draft.publicContent.contractVersion !== 'syntara.problem.v1' ||
        draft.grading.rubricCriteria?.length),
    );
  }
  if (draft.grading.type === 'fill_blank') {
    return (
      draft.grading.blanks.length > 0 &&
      draft.grading.blanks.every(
        (blank) =>
          blank.acceptedAnswers.some((answer) => answer.trim()) &&
          blank.acceptedAnswers.every(
            (answer) =>
              !/^(?:canonicalAnswer|acceptedAnswers|answer|[:,\]\[{}])$/i.test(answer.trim()) &&
              !/\.replace\s*\($/.test(answer.trim()),
          ),
      )
    );
  }
  // Batch completeness only establishes that the model solved the problem.
  // Test count, interface shape, and actual execution are enforced by the
  // dedicated code verification/repair pass after all batches are assembled.
  return Boolean(codeReferenceSolution(draft));
}

function promoteFunctionImplementationDraft(
  draft: NotebookProblemImportDraft,
): NotebookProblemImportDraft {
  if (
    draft.type !== 'short_answer' ||
    draft.publicContent.type !== 'short_answer' ||
    draft.grading.type !== 'short_answer'
  ) {
    return draft;
  }
  const solutionCode = draft.grading.referenceAnswer?.trim() || '';
  const asksForFunction =
    /(?:实现|完成|编写|implement|complete|write)\s*(?:一个|the|a)?\s*(?:Python\s*)?(?:函数|function)\b/i.test(
      draft.publicContent.stem,
    ) || /(?:实现|完成|编写)函数/.test(draft.publicContent.stem);
  const signature = solutionCode.match(
    /^\s*(def\s+[A-Za-z_]\w*\s*\([^\n]*?\)(?:\s*->\s*[^:\n]+)?\s*:)/m,
  )?.[1];
  if (!asksForFunction || !signature) return draft;

  return {
    ...draft,
    type: 'code',
    publicContent: {
      type: 'code',
      stem: draft.publicContent.stem,
      assets: draft.publicContent.assets,
      language: 'python',
      functionSignature: signature,
      starterCode: `${signature}\n    pass`,
      constraints: ['输入来自函数参数', '结果通过 return 返回', '不得使用 input、print 或文件读写'],
      publicTests: [],
      sampleIO: [],
      secretConfigPresent: true,
    },
    grading: {
      type: 'code',
      solutionCode,
      analysis: draft.grading.analysis || draft.grading.rubric,
      publishRequirementsMet: false,
    },
    secretJudge: {
      language: 'python',
      secretTests: [],
      timeoutMs: 5000,
    },
    sourceMeta: {
      ...draft.sourceMeta,
      promotedToCode: true,
      promotedFromType: 'short_answer',
    },
  };
}

export function promoteFunctionImplementationDrafts(
  drafts: NotebookProblemImportDraft[],
): NotebookProblemImportDraft[] {
  return drafts.map(promoteFunctionImplementationDraft);
}

export function mergeAnswerRepairDraft(
  original: NotebookProblemImportDraft,
  repaired: NotebookProblemImportDraft,
): NotebookProblemImportDraft {
  return {
    ...repaired,
    draftId: original.draftId,
    notebookId: original.notebookId,
    title: original.title,
    status: original.status,
    source: original.source,
    points: original.points,
    tags: original.tags,
    difficulty: original.difficulty,
    sourceMeta: {
      ...original.sourceMeta,
      ...repaired.sourceMeta,
      answerSource: 'llm-solved',
      answerRepairAttempted: true,
    },
    validationErrors: removeMissingAnswerValidationErrors(repaired.validationErrors),
  };
}

function codeRepairDraftFromRaw(
  raw: unknown,
  original: NotebookProblemImportDraft,
): NotebookProblemImportDraft | null {
  if (
    original.type !== 'code' ||
    original.publicContent.type !== 'code' ||
    original.grading.type !== 'code'
  ) {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const publicPatch =
    record.publicContent && typeof record.publicContent === 'object'
      ? (record.publicContent as Record<string, unknown>)
      : {};
  const gradingPatch =
    record.grading && typeof record.grading === 'object'
      ? (record.grading as Record<string, unknown>)
      : {};
  const secretPatch =
    record.secretJudge && typeof record.secretJudge === 'object'
      ? (record.secretJudge as Record<string, unknown>)
      : {};
  const testsPatch =
    record.tests && typeof record.tests === 'object'
      ? (record.tests as Record<string, unknown>)
      : {};
  const publicTests = Array.isArray(publicPatch.publicTests)
    ? publicPatch.publicTests
    : Array.isArray(record.publicTests)
      ? record.publicTests
      : Array.isArray(testsPatch.public)
        ? testsPatch.public
        : original.publicContent.publicTests;
  const secretTests = Array.isArray(secretPatch.secretTests)
    ? secretPatch.secretTests
    : Array.isArray(record.secretTests)
      ? record.secretTests
      : Array.isArray(testsPatch.secret)
        ? testsPatch.secret
        : (original.secretJudge?.secretTests ?? []);
  const solutionCode =
    (typeof gradingPatch.solutionCode === 'string' && gradingPatch.solutionCode) ||
    (typeof gradingPatch.referenceAnswer === 'string' && gradingPatch.referenceAnswer) ||
    (typeof record.solutionCode === 'string' && record.solutionCode) ||
    (typeof record.referenceAnswer === 'string' && record.referenceAnswer) ||
    codeReferenceSolution(original);
  const functionSignature =
    (typeof publicPatch.functionSignature === 'string' && publicPatch.functionSignature) ||
    (typeof record.functionSignature === 'string' && record.functionSignature) ||
    original.publicContent.functionSignature;
  const starterCode =
    (typeof publicPatch.starterCode === 'string' && publicPatch.starterCode) ||
    (typeof record.starterCode === 'string' && record.starterCode) ||
    original.publicContent.starterCode;
  const statementSections = Array.isArray(publicPatch.statementSections)
    ? publicPatch.statementSections
    : Array.isArray(record.statementSections)
      ? record.statementSections
      : original.publicContent.statementSections;

  const merged = normalizeCandidateDraft(
    {
      ...original,
      publicContent: {
        ...original.publicContent,
        ...publicPatch,
        type: 'code',
        functionSignature,
        starterCode,
        statementSections,
        contractVersion: 'syntara.problem.v1',
        statementFormat: 'syntara-markdown-v1',
        taskKind: 'implementation',
        responseKind: 'code_submission',
        runnerAdapter: 'python-unittest',
        publicTests,
        secretConfigPresent: true,
      },
      grading: {
        ...original.grading,
        ...gradingPatch,
        type: 'code',
        graderKind: 'code_runner',
        solutionCode,
        publishRequirementsMet: false,
      },
      secretJudge: {
        ...original.secretJudge,
        ...secretPatch,
        language: 'python',
        runnerAdapter: 'python-unittest',
        secretTests,
        timeoutMs: original.secretJudge?.timeoutMs ?? 5000,
      },
      validationErrors: withoutCodeReadinessErrors(original.validationErrors),
    },
    original.source,
  );
  return merged.type === 'code' ? merged : null;
}

export async function ensureImportedDraftAnswers(args: {
  drafts: NotebookProblemImportDraft[];
  model?: LanguageModel;
  language: 'zh-CN' | 'en-US';
}): Promise<{ drafts: NotebookProblemImportDraft[]; usage: ImportUsageSummary | null }> {
  const choiceResult = await solveMissingChoiceAnswersWithLLM(args);
  let drafts = choiceResult.drafts;
  const candidates = drafts.filter(
    (draft) => draft.type !== 'code' && !draftHasCompleteAnswer(draft),
  );
  if (!args.model || candidates.length === 0) {
    return { drafts, usage: choiceResult.usage };
  }

  const prompt =
    args.language === 'zh-CN'
      ? `补全下面这些题目的标准答案。只返回与输入顺序一致的完整题目 draft JSON 数组，不要 markdown。

要求：
- 独立解题，不得使用学生手写、圈选、得分或阅卷批注作为答案来源。
- 保持原题考点和大致难度；若当前题型不能稳定判分，可改成等价的受支持题型。
- 保持原题的作答方式与认知要求；只有原交互无法稳定展示或评分时才改成其他题型。
- 每题必须给出对应 grading：choice 给 correctOptionIds；calculation 给 referenceAnswer 和 acceptedForms；short_answer 给 referenceAnswer；proof 给 referenceProof；fill_blank 的每个 blank 给 acceptedAnswers。
- short_answer 和 proof 必须给 rubricCriteria=[{id,description,points}]，每项是可独立核验的得分点，points 总和必须等于题目 points；不能只给一段笼统 rubric。
- fill_blank 必须为每个空格选择 answerKind 与 matcher；数值空格使用 numeric_tolerance，并在需要时给 tolerance。
- fill_blank 的 acceptedAnswers 只能包含可直接接受的学生答案，不能混入 JSON 字段名、标点碎片、序列化辅助表达式或解释文字。
- 保留 draftId、完整题干、选项、sourceMeta 和来源定位。不要要求老师确认。

待补全题目：
${JSON.stringify(candidates)}`
      : `Complete the reference answers for these problems. Return a strict JSON array of complete problem drafts in the same order, without markdown.

Requirements:
- Solve independently. Student handwriting, marked choices, scores, and grader comments are not answer sources.
- Preserve the assessed objective and approximate difficulty. You may choose an equivalent supported type when the current type cannot be graded reliably.
- Preserve the original response demand and cognitive load; change the delivery type only when the original interaction cannot be rendered or graded reliably.
- Every grading object must contain its gradable answer: correctOptionIds for choice, referenceAnswer and acceptedForms for calculation, referenceAnswer for short_answer, referenceProof for proof, and acceptedAnswers for every fill_blank blank.
- short_answer and proof require rubricCriteria=[{id,description,points}] with independently verifiable criteria whose points sum exactly to the problem points; a single vague rubric paragraph is insufficient.
- Every fill_blank blank requires an answerKind and matcher. Use numeric_tolerance for numeric blanks and include tolerance when needed.
- fill_blank acceptedAnswers must contain only answers a student may enter, never JSON keys, punctuation fragments, serialization helper expressions, or explanations.
- Preserve draftId, complete prompt, options, sourceMeta, and source location. Do not request teacher confirmation.

Drafts:
${JSON.stringify(candidates)}`;

  let result: Awaited<ReturnType<typeof callLLM>>;
  try {
    result = await callLLM(
      {
        model: args.model,
        system:
          args.language === 'zh-CN'
            ? '你是运行在 Syntara 题库中的科目无关评测编译器，不是聊天助手。独立解题，并只输出机器可解析 JSON。'
            : 'You are the subject-agnostic assessment compiler inside Syntara, not a chat assistant. Solve independently and output machine-readable JSON only.',
        prompt: prompt.slice(0, 30000),
        maxOutputTokens: 16000,
      },
      'problem-bank-import-answer-repair',
    );
  } catch {
    return { drafts, usage: choiceResult.usage };
  }

  let repairedRaw: unknown[] = [];
  try {
    repairedRaw = parseProblemDraftArrayFromLLMText(result.text);
  } catch {
    repairedRaw = [];
  }
  const repairedByIndex = repairedRaw.map((raw, index) =>
    normalizeCandidateDraft(raw, candidates[index]?.source ?? 'pdf'),
  );
  const repairedByDraftId = new Map(
    repairedByIndex.map((draft) => [draft.draftId, draft] as const),
  );
  const candidatePositionByDraftId = new Map(
    candidates.map((draft, index) => [draft.draftId, index] as const),
  );
  drafts = drafts.map((draft) => {
    const candidatePosition = candidatePositionByDraftId.get(draft.draftId);
    if (candidatePosition == null) return draft;
    const repaired = repairedByDraftId.get(draft.draftId) ?? repairedByIndex[candidatePosition];
    if (!repaired || !draftHasCompleteAnswer(repaired)) return draft;
    return mergeAnswerRepairDraft(draft, repaired);
  });

  return {
    drafts,
    usage: mergeImportUsage(choiceResult.usage, usageFromLLMResult(args.model, result)),
  };
}

async function annotateCodeDraftVerification(
  drafts: NotebookProblemImportDraft[],
): Promise<NotebookProblemImportDraft[]> {
  return Promise.all(
    drafts.map(async (draft) => {
      if (draft.type !== 'code') return draft;
      const verification = await verifyNotebookCodeDraftReferenceAnswer(draft);
      return {
        ...draft,
        status: verification.passed ? draft.status : 'draft',
        grading:
          draft.grading.type === 'code'
            ? { ...draft.grading, publishRequirementsMet: verification.passed }
            : draft.grading,
        sourceMeta: {
          ...draft.sourceMeta,
          codeVerification: {
            passed: verification.passed,
            publicTestCount: verification.publicTestCount,
            secretTestCount: verification.secretTestCount,
            checkedBy: 'python-runner',
          },
        },
        validationErrors: Array.from(
          new Set([...withoutCodeReadinessErrors(draft.validationErrors), ...verification.errors]),
        ),
      } as NotebookProblemImportDraft;
    }),
  );
}

export async function ensureImportedCodeDraftsJudgeReady(args: {
  drafts: NotebookProblemImportDraft[];
  model?: LanguageModel;
  language: 'zh-CN' | 'en-US';
  repairAttempt?: number;
}): Promise<{ drafts: NotebookProblemImportDraft[]; usage: ImportUsageSummary | null }> {
  let drafts = await annotateCodeDraftVerification(
    promoteFunctionImplementationDrafts(args.drafts),
  );
  const failedCodeDrafts = drafts.filter(
    (draft) =>
      draft.type === 'code' &&
      (draft.sourceMeta.codeVerification as { passed?: unknown } | undefined)?.passed !== true,
  );
  if (!args.model || failedCodeDrafts.length === 0) return { drafts, usage: null };

  const prompt =
    args.language === 'zh-CN'
      ? `修复下面这些代码题，使它们符合平台判题契约。只返回严格 JSON 数组，不要 markdown。

返回最小补丁格式：
[{"draftId":"原 draftId","functionSignature":"def name(arg: Type) -> ReturnType:","starterCode":"含类型注解、docstring 和 pass 的代码","statementSections":[{"id":"overview","title":"描述","kind":"overview","body":"..."},{"id":"requirements","title":"要求","kind":"requirements","items":["..."]},{"id":"interface","title":"函数接口","kind":"interface","code":"def name(arg: Type) -> ReturnType:","codeLanguage":"python"},{"id":"examples","title":"示例","kind":"examples","body":"..."},{"id":"constraints","title":"约束","kind":"constraints","items":["..."]}],"solutionCode":"完整 Python 代码","publicTests":[{"id":"有意义的 snake_case 场景名","description":"...","expression":"name(...) ","expected":"JSON 或 Python 字面量"}],"secretTests":[...]}]

平台契约：
- 学生提交一个 Python 函数；输入只能来自函数参数，结果只能通过 return 返回。
- 不支持 input、stdin、print 输出判分或文件读写。如果原题使用这些接口，等价改写函数签名和题面，保留核心考点。
- 每题必须提供完整 solutionCode、有效 functionSignature、至少 2 个 publicTests 和 3 个 secretTests。
- testcase 是固定 unittest 文件的结构化输入：expression 只能是一条目标函数调用，expected 是返回值；不得在测试中使用 assert、print、input、open、导入或多行代码。
- publicTests 会编译为 public_tests.py / PublicTests，secretTests 会编译为 secret_tests.py / SecretTests；两者都使用 from submission import *、self.assertEqual(...) 和 unittest.main()。
- starterCode 必须包含参数与返回类型注解、完整 docstring 和 pass；题面必须使用 LeetCode 式 statementSections，覆盖描述、要求、接口、示例和约束。
- 测试覆盖普通情况、边界情况和容易写错的情况；public 与 secret 不重复。
- 修复后的 solutionCode 必须能通过你返回的全部测试。
- 如果运行错误显示参考实现符合题意而 expected 写错，应修正 testcase；如果实现不符合题意，应修正 solutionCode。不得为了让测试通过而改变考点。
- 保留 draftId、原语言、核心考点和大致难度；不要要求老师确认。

待修复题目与运行错误：
${JSON.stringify(
  failedCodeDrafts.map((draft) => ({
    draft,
    errors: draft.validationErrors,
  })),
)}`
      : `Repair these code problems so they satisfy the platform judging contract. Return a strict JSON array only.

Return minimal patches:
[{"draftId":"original draftId","functionSignature":"def name(arg: Type) -> ReturnType:","starterCode":"annotated signature, complete docstring, and pass","statementSections":[{"id":"overview","title":"Description","kind":"overview","body":"..."},{"id":"requirements","title":"Requirements","kind":"requirements","items":["..."]},{"id":"interface","title":"Function interface","kind":"interface","code":"def name(arg: Type) -> ReturnType:","codeLanguage":"python"},{"id":"examples","title":"Examples","kind":"examples","body":"..."},{"id":"constraints","title":"Constraints","kind":"constraints","items":["..."]}],"solutionCode":"complete Python code","publicTests":[{"id":"meaningful_snake_case_scenario","description":"...","expression":"name(...) ","expected":"JSON or Python literal"}],"secretTests":[...]}]

Contract:
- A student submits a Python function. Inputs come only from function parameters and results are returned with return.
- stdin, input(), print-based grading, and file I/O are unsupported. Adapt those interfaces while preserving the assessed concept.
- Include complete solutionCode, a valid functionSignature, at least 2 publicTests, and at least 3 secretTests.
- Testcases are structured inputs for fixed unittest files. expression is one target-function call and expected is the returned value; do not use assert, print, input, open, imports, or multiline code.
- publicTests compile to public_tests.py / PublicTests and secretTests compile to secret_tests.py / SecretTests using from submission import *, self.assertEqual(...), and unittest.main().
- starterCode must contain annotated parameter and return types, a complete docstring, and pass. Use LeetCode-style statementSections for overview, requirements, interface, examples, and constraints.
- Cover normal, boundary, and plausible wrong-answer cases. Public and secret tests must not duplicate each other.
- The returned solutionCode must pass every returned test.
- If runner evidence shows the implementation matches the prompt but an expected value is wrong, fix the testcase; if the implementation violates the prompt, fix solutionCode. Never change the assessed objective merely to make tests pass.
- Preserve draftId, source language, core objective, and approximate difficulty. No teacher confirmation is required.

Drafts and runner errors:
${JSON.stringify(
  failedCodeDrafts.map((draft) => ({
    draft,
    errors: draft.validationErrors,
  })),
)}`;

  let result: Awaited<ReturnType<typeof callLLM>>;
  try {
    result = await callLLM(
      {
        model: args.model,
        system:
          args.language === 'zh-CN'
            ? '你是运行在 Syntara 题库中的评测编译器和严谨的 Python 出题人，不是聊天助手。只输出机器可解析 JSON。'
            : 'You are the assessment compiler inside Syntara and a rigorous Python problem author, not a chat assistant. Output machine-readable JSON only.',
        prompt: prompt.slice(0, 30000),
        maxOutputTokens: 16000,
      },
      'problem-bank-import-code-repair',
    );
  } catch {
    return { drafts, usage: null };
  }

  let repairedRaw: unknown[] = [];
  try {
    repairedRaw = parseProblemDraftArrayFromLLMText(result.text);
  } catch {
    repairedRaw = [];
  }
  const repairedByIndex = repairedRaw.map((raw, index) => {
    const original = failedCodeDrafts[index];
    return original ? codeRepairDraftFromRaw(raw, original) : null;
  });
  const repairedByDraftId = new Map(
    repairedRaw.flatMap((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
      const draftId =
        typeof (raw as Record<string, unknown>).draftId === 'string'
          ? String((raw as Record<string, unknown>).draftId)
          : '';
      const original =
        failedCodeDrafts.find((draft) => draft.draftId === draftId) ?? failedCodeDrafts[index];
      const repaired = original ? codeRepairDraftFromRaw(raw, original) : null;
      return draftId && repaired ? ([[draftId, repaired]] as const) : [];
    }),
  );
  const failedPositionByDraftId = new Map(
    failedCodeDrafts.map((draft, index) => [draft.draftId, index] as const),
  );
  drafts = drafts.map((draft) => {
    if (draft.type !== 'code') return draft;
    const failedPosition = failedPositionByDraftId.get(draft.draftId);
    if (failedPosition == null) return draft;
    const repaired = repairedByDraftId.get(draft.draftId) ?? repairedByIndex[failedPosition];
    if (!repaired || repaired.type !== 'code') return draft;
    return {
      ...repaired,
      draftId: draft.draftId,
      notebookId: draft.notebookId,
      source: draft.source,
      sourceMeta: {
        ...draft.sourceMeta,
        ...repaired.sourceMeta,
        codeRepairAttempted: true,
      },
    };
  });

  const verifiedDrafts = await annotateCodeDraftVerification(drafts);
  const usage = usageFromLLMResult(args.model, result);
  const stillFailing = verifiedDrafts.some(
    (draft) =>
      draft.type === 'code' &&
      (draft.sourceMeta.codeVerification as { passed?: unknown } | undefined)?.passed !== true,
  );
  if (!stillFailing || (args.repairAttempt ?? 0) >= 1) {
    return { drafts: verifiedDrafts, usage };
  }
  const retry = await ensureImportedCodeDraftsJudgeReady({
    drafts: verifiedDrafts,
    model: args.model,
    language: args.language,
    repairAttempt: (args.repairAttempt ?? 0) + 1,
  });
  return {
    drafts: retry.drafts,
    usage: mergeImportUsage(usage, retry.usage),
  };
}

function enrichFileDraftSourceMeta(
  draft: NotebookProblemImportDraft,
  structureItem: ProblemStructureItem | undefined,
): NotebookProblemImportDraft {
  if (!structureItem) return { ...draft, notebookId: null };
  const structurePoints = resolveStructureItemPoints(structureItem);
  return {
    ...draft,
    notebookId: null,
    points: structurePoints ?? draft.points,
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

export function resolveStructureItemPoints(
  structureItem: ProblemStructureItem,
): number | undefined {
  if (typeof structureItem.points === 'number') return structureItem.points;
  if (
    structureItem.subparts.length > 0 &&
    structureItem.subparts.every((subpart) => typeof subpart.points === 'number')
  ) {
    return structureItem.subparts.reduce((total, subpart) => total + (subpart.points ?? 0), 0);
  }
  return undefined;
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
  const answerResult = await ensureImportedDraftAnswers({
    drafts,
    model: args.model,
    language: args.language,
  });
  const codeResult = await ensureImportedCodeDraftsJudgeReady({
    drafts: answerResult.drafts,
    model: args.model,
    language: args.language,
  });
  return {
    drafts: codeResult.drafts,
    usage: mergeImportUsage(
      llmUsageFromResult({
        model: args.model,
        inputTokens,
        outputTokens,
        cachedInputTokens,
      }),
      mergeImportUsage(answerResult.usage, codeResult.usage),
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
默认按最顶层题号建立条目；共享同一推导的小问放入 subparts。表格逐行作答、逐段代码追踪等彼此独立且独立计分的重复单元，要分别建立 topLevelProblems 条目，并携带原题号与行号。仔细识别原题能力和适合平台交付的题型。
JSON 格式：
{
  "sourceSummary": "...",
  "nonProblemRegions": [{"kind":"cover|instructions|additional_work|blank|header_footer|other","pageNumbers":[1],"reason":"..."}],
  "sharedContexts": [{"id":"...","title":"...","pageNumbers":[1],"summary":"..."}],
  "topLevelProblems": [{"index":1,"topLevelLabel":"1","title":"...","points":3,"problemTypeHint":"choice|proof|calculation|short_answer|code|fill_blank|unknown","pageStart":2,"pageEnd":2,"sourceAnchors":[{"pageNumber":2,"textQuote":"...","role":"problem"}],"subparts":[],"contextBlocks":[],"visualRefs":[],"confidence":0.9}],
  "warnings": [],
  "generatedBy": "llm"
}`
      : `Read every page of the attached file, but in this pass create only a structural problem index; do not solve anything. Return one strict JSON object without markdown.
Separate printed source questions from student handwriting, marked bubbles, grader annotations, scores, and grading feedback. The latter are not problems. Put covers, reference sheets, answer sheets, and blank pages in nonProblemRegions.
Create items by top-level number by default and keep subparts that share one derivation together. Split independently answered and independently scored repeated units, such as table rows and code-tracing rows, into separate topLevelProblems items carrying the original number and row label. Identify both the source capability and the best supported delivery type.
Record the printed total points for every problem as points. Return: {"sourceSummary":"...","nonProblemRegions":[{"kind":"cover|instructions|additional_work|blank|header_footer|other","pageNumbers":[1],"reason":"..."}],"sharedContexts":[],"topLevelProblems":[{"index":1,"topLevelLabel":"1","title":"...","points":3,"problemTypeHint":"choice|proof|calculation|short_answer|code|fill_blank|unknown","pageStart":2,"pageEnd":2,"sourceAnchors":[{"pageNumber":2,"textQuote":"...","role":"problem"}],"subparts":[],"contextBlocks":[],"visualRefs":[],"confidence":0.9}],"warnings":[],"generatedBy":"llm"}`;
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
    const fallbackAnswers = await ensureImportedDraftAnswers({
      drafts: fallbackDrafts,
      model: args.model,
      language: args.language,
    });
    const fallbackCodeResult = await ensureImportedCodeDraftsJudgeReady({
      drafts: fallbackAnswers.drafts,
      model: args.model,
      language: args.language,
    });
    return {
      drafts: fallbackCodeResult.drafts.map((draft) => ({ ...draft, notebookId: null })),
      usage: mergeImportUsage(
        usage,
        mergeImportUsage(fallbackAnswers.usage, fallbackCodeResult.usage),
      ),
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
          points: item.points,
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
必须恰好返回 ${batch.length} 个题目草稿，顺序与目录一致，小问保留在同一道题中。每题 sourceMeta.scaffoldIndex 填对应 index，并保留目录中的原卷分值。
每道题都必须有可判分答案。保持原题的作答方式与认知要求；代码输出预测和报错判断属于 code_reading，不得误做成代码编辑器题。代码题只用于函数实现，必须使用参数输入、return 输出，提供 LeetCode 式题面、带类型注解和 docstring 的 starterCode、完整 solutionCode、functionSignature、至少 2 个 public tests 和 3 个 secret tests，且参考答案能通过全部 unittest。input、stdin、print 判分和文件读写必须等价改写。
只返回严格 JSON 数组。`
          : `Process only these ${batch.length} top-level problems: ${batchOutline}
Return to the cited pages, transcribe the complete printed prompt, and independently solve every problem. Ignore handwriting, marked bubbles, grading marks, scores, and grader feedback; none is an answer source.
Return exactly ${batch.length} drafts in the same order, with subparts kept in their top-level problem. Set sourceMeta.scaffoldIndex to the corresponding index and preserve the printed points from the outline.
Every problem must have a gradable answer. Preserve the original response demand and cognitive load; code-output prediction and error diagnosis are code_reading, not code-editor tasks. Code is only for function implementation with parameter inputs and return output, a LeetCode-style statement, annotated starterCode with a docstring, complete solutionCode, functionSignature, at least 2 public tests and 3 secret tests, and a solution that passes all unittests. Equivalently adapt input(), stdin, print-based grading, and file I/O. Return a strict JSON array only.`;

      let bestDrafts: NotebookProblemImportDraft[] = [];
      let batchUsage: ImportUsageSummary | null = null;
      let retryReason = '';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const retrySuffix =
          attempt === 0
            ? ''
            : args.language === 'zh-CN'
              ? `\n上一次输出无法入库：${retryReason || '缺少题目或标准答案'}。请重新检查 JSON 转义和每题 grading，返回修正后的完整数组。`
              : `\nThe previous output could not be imported: ${retryReason || 'missing problems or reference answers'}. Recheck JSON escaping and every grading object, then return the complete corrected array.`;
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
            maxOutputTokens: 24000,
          },
          attempt === 0
            ? 'problem-bank-import-openai-file-batch'
            : 'problem-bank-import-openai-file-batch-retry',
        );
        batchUsage = mergeImportUsage(batchUsage, usageFromLLMResult(args.model, result));
        let rawDrafts: unknown[];
        try {
          rawDrafts = parseProblemDraftArrayFromLLMText(result.text).slice(0, batch.length);
        } catch (error) {
          retryReason =
            error instanceof Error ? `JSON 解析失败：${error.message}` : 'JSON 解析失败';
          if (attempt === 0) continue;
          throw new Error(
            args.language === 'zh-CN'
              ? `PDF 题目批次 ${batch[0]?.index}-${batch.at(-1)?.index} 连续两次返回无效 JSON：${retryReason}`
              : `PDF batch ${batch[0]?.index}-${batch.at(-1)?.index} returned invalid JSON twice: ${retryReason}`,
          );
        }
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
          normalized.length > bestDrafts.length ||
          (normalized.length === bestDrafts.length &&
            normalized.filter(draftHasCompleteAnswer).length >
              bestDrafts.filter(draftHasCompleteAnswer).length)
        ) {
          bestDrafts = normalized;
        }
        retryReason = `${normalized.length}/${batch.length} 题，${normalized.filter(draftHasCompleteAnswer).length}/${batch.length} 题答案与代码测试完整`;
        if (normalized.length === batch.length) break;
      }
      if (bestDrafts.length !== batch.length) {
        throw new Error(
          args.language === 'zh-CN'
            ? `PDF 题目批次 ${batch[0]?.index}-${batch.at(-1)?.index} 抽取不完整：期望 ${batch.length} 题，实际 ${bestDrafts.length} 题。`
            : `Incomplete PDF batch ${batch[0]?.index}-${batch.at(-1)?.index}: expected ${batch.length} problems, received ${bestDrafts.length}.`,
        );
      }
      return { drafts: bestDrafts, usage: batchUsage };
    },
  );

  let drafts = batchResults.flatMap((result) => result.drafts);
  for (const result of batchResults) usage = mergeImportUsage(usage, result.usage);
  const answerResult = await ensureImportedDraftAnswers({
    drafts,
    model: args.model,
    language: args.language,
  });
  const codeResult = await ensureImportedCodeDraftsJudgeReady({
    drafts: answerResult.drafts,
    model: args.model,
    language: args.language,
  });
  drafts = codeResult.drafts
    .map((draft) => ({ ...draft, notebookId: null }))
    .sort((left, right) => {
      const leftIndex = Number(left.sourceMeta.scaffoldIndex ?? Number.MAX_SAFE_INTEGER);
      const rightIndex = Number(right.sourceMeta.scaffoldIndex ?? Number.MAX_SAFE_INTEGER);
      return leftIndex - rightIndex;
    });
  return {
    drafts,
    usage: mergeImportUsage(usage, mergeImportUsage(answerResult.usage, codeResult.usage)),
  };
}
