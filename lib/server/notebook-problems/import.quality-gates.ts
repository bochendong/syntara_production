import type { LanguageModel } from 'ai';
import { findMathRenderIssues, parseMathFragments } from '@/lib/math-engine';
import { repairMalformedProblemMath } from '@/lib/problem-bank/repair-malformed-math';
import type { NotebookProblemImportDraft } from '@/lib/problem-bank';
import { STANDARD_PROBLEM_POINTS } from '@/lib/problem-bank/scoring-policy';
import {
  attachSourceFiguresToDrafts,
  collectDraftFigureRefs,
  parseJsonObject,
  usageOf,
} from './import.figures';
import { callLLM } from '@/lib/ai/llm';
import type { ImportUsageSummary } from './import.core.types';
import { mergeImportUsage } from './import.core.usage';
import { verifyDraftAnswers, type AnswerVerification } from './import.verify';
import {
  IMPORT_REVIEW_VERSION,
  type ImportReview,
  type ImportReviewIssue,
  type ImportReviewIssueCode,
} from './import.quality-gates.review';

export { IMPORT_REVIEW_VERSION } from './import.quality-gates.review';
export type {
  ImportReview,
  ImportReviewIssue,
  ImportReviewIssueCode,
} from './import.quality-gates.review';

/**
 * Last stage of problem-bank import. Turns "valid JSON with an answer" into an explicit
 * review decision per problem:
 *   - solution-only reconstructions are dropped (and reported),
 *   - real source figures are cropped and attached,
 *   - deterministic checks catch broken math, missing figures, leaked source labels and
 *     downgraded drawing tasks,
 *   - an independent solve checks the stored answer.
 * The outcome is stored in sourceMeta.importReview so it survives persistence; bulk
 * Review findings remain content-quality diagnostics and do not hide imported problems.
 */

export type SkippedImportItem = { title: string; pages: number[]; reason: string };

export type ImportQualityReport = {
  total: number;
  passed: number;
  needsReview: number;
  skippedSolutionOnly: number;
  figuresAttached: number;
  uniqueFigures: number;
  issueCounts: Partial<Record<ImportReviewIssueCode, number>>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function publicTexts(draft: NotebookProblemImportDraft): string[] {
  const content = draft.publicContent;
  const texts: string[] = [draft.title];
  if ('stem' in content && content.stem) texts.push(content.stem);
  if (content.type === 'fill_blank') texts.push(content.stemTemplate);
  if (content.type === 'choice') texts.push(...content.options.map((option) => option.label));
  for (const image of content.assets?.images ?? []) {
    if (image.caption) texts.push(image.caption);
    if (image.alt) texts.push(image.alt);
  }
  return texts;
}

function gradingTexts(draft: NotebookProblemImportDraft): string[] {
  const grading = draft.grading as Record<string, unknown>;
  const texts: string[] = [];
  for (const key of ['referenceAnswer', 'referenceProof', 'rubric', 'analysis']) {
    if (typeof grading[key] === 'string') texts.push(grading[key] as string);
  }
  if (Array.isArray(grading.acceptedForms)) {
    texts.push(
      ...grading.acceptedForms.filter((value): value is string => typeof value === 'string'),
    );
  }
  return texts;
}

const FIGURE_REFERENCE_PATTERNS = [
  /\b(?:[Ff]igure|[Ff]ig\.|[Gg]raph|[Dd]iagram|[Cc]hart|[Ee]xhibit|[Tt]able)\s+(?:[A-Z]\b|\d)/,
  /\b(?:the|this|following|above|below)\s+(?:figure|graph|diagram|chart|plot|picture|image|spreadsheet|screenshot)\b/i,
  /\b(?:shown|depicted|illustrated)\s+(?:below|above|in the (?:figure|graph|diagram))/i,
  /如图|下图|上图|图中|见图|图\s*[0-9一二三四五六七八九十]|示意图|结构式如下|曲线如下/,
];

function stemNeedsFigure(stem: string): boolean {
  return FIGURE_REFERENCE_PATTERNS.some((pattern) => pattern.test(stem));
}

/**
 * LaTeX commands that end up outside any math fragment are shown to students as raw
 * text (for example "$ $\\lim_{x\\to 1} f(x)$。$" where delimiters are doubled).
 */
function hasLatexOutsideMath(text: string): boolean {
  const withoutCode = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`\n]*`/g, '')
    // Display blocks are rendered line-by-line by the renderer, not as inline fragments.
    .replace(/\$\$[\s\S]*?\$\$/g, ' ')
    .replace(/\\\[[\s\S]*?\\\]/g, ' ');
  return parseMathFragments(withoutCode).some(
    (fragment) =>
      (fragment.type === 'text' &&
        /\\(?:frac|lim|sum|int|sqrt|alpha|beta|gamma|delta|theta|lambda|mu|sigma|pi|infty|leq|geq|neq|cdot|times|to|mathrm|text|ce|left|right|begin)\b/.test(
          fragment.value,
        )) ||
      (fragment.type === 'math' && !fragment.value.trim()) ||
      // Prose swallowed by mismatched delimiters, e.g. "$...$ x+5y\\leq30$ ... \n$Also assume
      // the non-negativity constraints$", renders as one run of math italics.
      (fragment.type === 'math' &&
        /[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(
          fragment.value.replace(/\\(?:text|mathrm|operatorname|textbf|mathbf)\{[^}]*\}/g, ' '),
        )),
  );
}

/** Unescaped single "$" that is not money ("$100") left unbalanced in one text. */
function hasUnbalancedDollar(text: string): boolean {
  const withoutEscaped = text.replace(/\\\$/g, '').replace(/\$\$/g, '');
  const singles = withoutEscaped.match(/\$/g)?.length ?? 0;
  if (singles % 2 === 0) return false;
  const moneyLike =
    withoutEscaped.match(/\$\s?\d[\d,]*(?:\.\d+)?(?![\d.]*\s*[=+\-*/^_\\])/g)?.length ?? 0;
  return (singles - moneyLike) % 2 !== 0;
}

const SOURCE_LABEL_PATTERNS = [
  /\b(?:source|original figure|from the original)\s*:/i,
  /\.(?:pdf|docx?|pptx?|png|jpe?g)\b/i,
  /\b(?:on\s+)?page\s+\d+\s+of\s+the\s+(?:source|original|pdf)/i,
  /原(?:卷|文件|资料)第\s*\d+\s*页|来源[:：]|原图[:：]/,
];

const DRAWING_DOWNGRADE_PATTERNS = [
  /(?:describe|description)\s+(?:is\s+)?(?:acceptable|sufficient|instead)/i,
  /\b(?:or|instead of drawing)\s+describe\b/i,
  /equivalent\s+(?:verbal|written|text(?:ual)?)\s+description/i,
  /(?:文字|语言)(?:描述|说明)(?:即可|代替|替代)|描述或(?:绘|画)图|可用文字代替/,
];

const DRAWING_REQUEST_PATTERN =
  /\b(?:draw\w*|sketch\w*|plot\w*|graph\w*|label\w*|diagram\w*|illustrat\w*|annotat\w*|shade\w*|curved arrows?|resonance (?:structures?|contributors?)|mechanism\w*|provide (?:the |a |an |another )?(?:\w+ ){0,3}structures?|show\b.*\bon\b)|画|绘|作图|标出|标示|标注|结构式|机理|弯箭头/i;

/** Formulas students would see broken: KaTeX failures, unpaired or swallowed delimiters. */
function mathFormattingIssues(draft: NotebookProblemImportDraft, zh: boolean): ImportReviewIssue[] {
  const issues: ImportReviewIssue[] = [];
  // Check what the renderer will actually parse: it repairs common delimiter slips
  // (for example escaped currency inside math) before rendering.
  const allTexts = [...publicTexts(draft), ...gradingTexts(draft)].map((text) =>
    repairMalformedProblemMath(text),
  );
  const mathProblems = allTexts.flatMap((text) => findMathRenderIssues(text));
  if (mathProblems.length > 0) {
    issues.push({
      code: 'math_render',
      message: `${zh ? '公式无法渲染' : 'Formula fails to render'}: ${mathProblems
        .slice(0, 3)
        .map((issue) => `${issue.latex.slice(0, 60)} (${issue.message.slice(0, 80)})`)
        .join('; ')}`,
    });
  }
  // Raw text too: the renderer's repair hides some slips but not prose swallowed into math.
  const studentTexts = publicTexts(draft).flatMap((text) => [
    text,
    repairMalformedProblemMath(text),
  ]);
  if (allTexts.some(hasUnbalancedDollar) || studentTexts.some(hasLatexOutsideMath)) {
    issues.push({
      code: 'math_delimiter',
      message: zh
        ? '数学定界符不配对或把普通文字包进了公式，学生会看到原始 LaTeX 或错乱的公式。'
        : 'Math delimiters are unpaired or wrap ordinary prose; students would see raw or garbled math.',
    });
  }
  return issues;
}

/** Letters and digits outside LaTeX commands, used to prove a formatting repair kept the wording. */
function wordingFingerprint(text: string): string {
  return text
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[^A-Za-z0-9\u4e00-\u9fff]/g, '')
    .toLowerCase();
}

/**
 * One formatting-only model pass for drafts whose formulas would render broken. The
 * wording must survive unchanged (checked by fingerprint), otherwise the original stays
 * and the issue is reported for review.
 */
async function repairMathFormatting(args: {
  drafts: NotebookProblemImportDraft[];
  model: LanguageModel;
}): Promise<{
  drafts: NotebookProblemImportDraft[];
  usage: ImportUsageSummary | null;
  repaired: number;
}> {
  let usage: ImportUsageSummary | null = null;
  let repaired = 0;
  const drafts = await Promise.all(
    args.drafts.map(async (draft) => {
      if (mathFormattingIssues(draft, false).length === 0) return draft;
      const content = draft.publicContent as Record<string, unknown>;
      const fields: Record<string, unknown> = {};
      if (typeof content.stem === 'string') fields.stem = content.stem;
      if (typeof content.stemTemplate === 'string') fields.stemTemplate = content.stemTemplate;
      const gradingRecord = draft.grading as Record<string, unknown>;
      if (typeof gradingRecord.referenceAnswer === 'string') {
        fields.referenceAnswer = gradingRecord.referenceAnswer;
      }
      if (Array.isArray(gradingRecord.acceptedForms))
        fields.acceptedForms = gradingRecord.acceptedForms;
      if (Array.isArray(content.options)) {
        fields.options = (content.options as Array<{ id: string; label: string }>).map(
          (option) => ({ id: option.id, label: option.label }),
        );
      }
      try {
        const result = await callLLM(
          {
            model: args.model,
            system: 'You fix Markdown and LaTeX formatting. Output strict JSON only.',
            messages: [
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Fix only the math formatting of this student-facing problem text. Wrap each formula or inequality in its own $...$ (or $$...$$ on its own line), keep ordinary words outside math, put separate constraints on separate lines or separate them with semicolons, and keep {{blank}} markers, Markdown tables, lists and code blocks intact. Do not change, add, translate, or remove any words, numbers, or options. Return the same JSON shape.\n\n${JSON.stringify(fields)}`,
                  },
                ],
              },
            ],
            maxOutputTokens: 6000,
          },
          'problem-bank-import-math-format-repair',
        );
        usage = mergeImportUsage(usage, usageOf(args.model, result));
        const fixed = parseJsonObject(result.text);
        if (!fixed) return draft;
        const next: Record<string, unknown> = { ...content };
        for (const key of ['stem', 'stemTemplate'] as const) {
          const before = fields[key];
          const after = fixed[key];
          if (typeof before !== 'string' || typeof after !== 'string') continue;
          if (wordingFingerprint(before) !== wordingFingerprint(after)) return draft;
          next[key] = after;
        }
        if (Array.isArray(fields.options) && Array.isArray(fixed.options)) {
          const original = fields.options as Array<{ id: string; label: string }>;
          const updated = new Map(
            (fixed.options as Array<{ id?: unknown; label?: unknown }>).map((option) => [
              String(option.id),
              typeof option.label === 'string' ? option.label : '',
            ]),
          );
          const options = (content.options as Array<{ id: string; label: string }>).map(
            (option) => {
              const label = updated.get(option.id);
              return label && wordingFingerprint(label) === wordingFingerprint(option.label)
                ? { ...option, label }
                : option;
            },
          );
          if (options.length === original.length) next.options = options;
        }
        const nextGrading: Record<string, unknown> = { ...gradingRecord };
        if (
          typeof fields.referenceAnswer === 'string' &&
          typeof fixed.referenceAnswer === 'string' &&
          wordingFingerprint(fields.referenceAnswer) === wordingFingerprint(fixed.referenceAnswer)
        ) {
          nextGrading.referenceAnswer = fixed.referenceAnswer;
        }
        if (Array.isArray(fields.acceptedForms) && Array.isArray(fixed.acceptedForms)) {
          const before = fields.acceptedForms as unknown[];
          const after = fixed.acceptedForms as unknown[];
          if (
            before.length === after.length &&
            after.every(
              (value, index) =>
                typeof value === 'string' &&
                wordingFingerprint(value) === wordingFingerprint(String(before[index])),
            )
          ) {
            nextGrading.acceptedForms = after;
          }
        }
        const candidate = {
          ...draft,
          publicContent: next as NotebookProblemImportDraft['publicContent'],
          grading: nextGrading as NotebookProblemImportDraft['grading'],
        };
        if (mathFormattingIssues(candidate, false).length > 0) return draft;
        repaired += 1;
        return candidate;
      } catch {
        return draft;
      }
    }),
  );
  return { drafts, usage, repaired };
}

function deterministicIssues(draft: NotebookProblemImportDraft): ImportReviewIssue[] {
  const issues: ImportReviewIssue[] = [];
  const meta = asRecord(draft.sourceMeta);
  const zh = /[一-鿿]/.test(publicTexts(draft).join(' '));
  const content = draft.publicContent;
  const stem =
    'stem' in content && content.stem
      ? content.stem
      : content.type === 'fill_blank'
        ? content.stemTemplate
        : '';
  const images = (content.assets?.images ?? []).filter((image) => image.role !== 'explanation');

  for (const error of draft.validationErrors) issues.push({ code: 'model_flag', message: error });

  if (meta.promptStatus === 'incomplete') {
    issues.push({
      code: 'prompt_incomplete',
      message: zh
        ? '原题的共享条件、前文、图或表不完整，需要补齐原资料。'
        : 'The source prompt is missing shared givens, context, a figure, or a table.',
    });
  }

  const figureIssues = Array.isArray(meta.figureIssues)
    ? meta.figureIssues.filter((value): value is string => typeof value === 'string')
    : [];
  for (const message of figureIssues) {
    issues.push({
      code: /未能|could not|不符|not attached|无法|not cropped/i.test(message)
        ? 'figure_missing'
        : 'figure_quality',
      message,
    });
  }
  const expectsFigure = collectDraftFigureRefs(draft, zh ? 'zh-CN' : 'en-US').length > 0;
  if (
    images.length === 0 &&
    !figureIssues.length &&
    (expectsFigure ||
      // "Sketch the graph of f" asks for a drawing; it does not reference a given figure.
      (meta.responseMode !== 'student_draws' &&
        stem &&
        stemNeedsFigure(stem) &&
        !/^\s*\|.*\|\s*$/m.test(stem)))
  ) {
    issues.push({
      code: 'figure_missing',
      message: zh
        ? '题干引用了图/图表，但题目没有原图。'
        : 'The stem refers to a figure, but no source figure is attached.',
    });
  }

  issues.push(...mathFormattingIssues(draft, zh));

  if (publicTexts(draft).some((text) => SOURCE_LABEL_PATTERNS.some((p) => p.test(text)))) {
    issues.push({
      code: 'source_label_leak',
      message: zh
        ? '学生可见的标题、题干或图注包含来源文件名、页码或“原图/Source”等维护信息。'
        : 'Student-facing text contains source filenames, page numbers, or "Source"/"Original figure" labels.',
    });
  }

  if (meta.responseMode === 'student_draws') {
    const downgraded = [stem, ...gradingTexts(draft)].some((text) =>
      DRAWING_DOWNGRADE_PATTERNS.some((pattern) => pattern.test(text)),
    );
    if (downgraded || (stem && !DRAWING_REQUEST_PATTERN.test(stem))) {
      issues.push({
        code: 'drawing_downgraded',
        message: zh
          ? '原题要求学生作图，但题干或评分允许用文字替代或未要求提交图。'
          : 'The source asks students to draw, but the stem or grading lets text replace the drawing.',
      });
    }
  }
  return issues;
}

export function buildImportReview(
  draft: NotebookProblemImportDraft,
  verification: AnswerVerification | null,
): ImportReview {
  const zh = /[一-鿿]/.test(publicTexts(draft).join(' '));
  const issues = deterministicIssues(draft);
  if (verification) {
    for (const message of verification.issues) {
      issues.push({
        code:
          verification.verdict === 'unsolvable' && !/透露|give away/.test(message)
            ? 'answer_unsolvable'
            : /透露|give away/.test(message)
              ? 'answer_leak'
              : 'answer_disagree',
        message,
      });
    }
    if (verification.verdict === 'error') {
      issues.push({
        code: 'answer_disagree',
        message: zh
          ? '独立复算未能完成，参考答案尚未经过二次核验。'
          : 'The independent answer check could not run; the reference answer is unverified.',
      });
    }
  }
  const unique = new Map(issues.map((issue) => [`${issue.code}:${issue.message}`, issue]));
  const deduped = [...unique.values()].slice(0, 20);
  return {
    version: IMPORT_REVIEW_VERSION,
    status: deduped.length ? 'needs_review' : 'passed',
    issues: deduped,
    answerCheck: verification?.verdict ?? 'not_run',
    independentAnswer: verification?.independentAnswer,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Saved problems are always scored out of STANDARD_PROBLEM_POINTS, while models copy the
 * printed points (often 1–10) into rubrics. Rescale the rubric proportionally instead of
 * flagging every open problem for a points mismatch the persistence layer resolves anyway.
 */
export function normalizeRubricPoints(
  draft: NotebookProblemImportDraft,
): NotebookProblemImportDraft {
  const grading = draft.grading;
  if (grading.type !== 'short_answer' && grading.type !== 'proof') return draft;
  const rawCriteria = grading.rubricCriteria ?? [];
  if (!rawCriteria.length) return draft;
  // All-zero weights mean the model omitted them; weight criteria equally.
  const criteria = rawCriteria.every((criterion) => criterion.points <= 0)
    ? rawCriteria.map((criterion) => ({ ...criterion, points: 1 }))
    : rawCriteria;
  const total = criteria.reduce((sum, criterion) => sum + criterion.points, 0);
  let assigned = 0;
  const scaled = criteria.map((criterion, index) => {
    const points =
      index === criteria.length - 1
        ? Math.round((STANDARD_PROBLEM_POINTS - assigned) * 10) / 10
        : Math.round((criterion.points / total) * STANDARD_PROBLEM_POINTS * 10) / 10;
    assigned += points;
    return { ...criterion, points };
  });
  return {
    ...draft,
    points: STANDARD_PROBLEM_POINTS,
    grading: { ...grading, rubricCriteria: scaled },
    validationErrors: draft.validationErrors.filter(
      (error) =>
        !/^评分量表总分 .* 必须等于题目分值|rubric (?:criteria )?(?:total|points).*must equal|^开放题必须提供结构化 rubricCriteria/i.test(
          error,
        ),
    ),
  };
}

// Point values are normalized to STANDARD_PROBLEM_POINTS on save, so model notes about a
// missing or defaulted printed point value are not review issues.
const POINT_VALUE_NOTE =
  /(?:point value|points?\b.*(?:default|assigned|not (?:printed|shown|specified))|分值|points 暂记)/i;

/** "$ $x=1$" (an empty math pair glued to a formula) → "$x=1$". */
function repairDoubledDollar(text: string): string {
  const count = (value: string) =>
    (value.replace(/\\\$/g, '').replace(/\$\$/g, '').match(/\$/g) ?? []).length;
  if (count(text) % 2 === 0) return text;
  const repaired = text.replace(/\$\s+\$(?=\S)/, '$');
  return count(repaired) % 2 === 0 ? repaired : text;
}

/** "Select all" choice drafts with several correct options are multiple-selection. */
function normalizeChoiceSelection(draft: NotebookProblemImportDraft): NotebookProblemImportDraft {
  if (draft.publicContent.type !== 'choice' || draft.grading.type !== 'choice') return draft;
  if (
    draft.grading.correctOptionIds.length <= 1 ||
    draft.publicContent.selectionMode === 'multiple'
  ) {
    return draft;
  }
  return {
    ...draft,
    publicContent: { ...draft.publicContent, selectionMode: 'multiple' },
    validationErrors: draft.validationErrors.filter(
      (error) => !/^单选题必须且只能有一个正确选项|single[- ]choice .*exactly one/i.test(error),
    ),
  };
}

function repairDraftDelimiters(draft: NotebookProblemImportDraft): NotebookProblemImportDraft {
  const grading = draft.grading as Record<string, unknown>;
  const fixedGrading: Record<string, unknown> = { ...grading };
  for (const key of ['referenceAnswer', 'referenceProof', 'rubric', 'analysis']) {
    if (typeof grading[key] === 'string')
      fixedGrading[key] = repairDoubledDollar(grading[key] as string);
  }
  if (Array.isArray(grading.acceptedForms)) {
    fixedGrading.acceptedForms = grading.acceptedForms.map((value) =>
      typeof value === 'string' ? repairDoubledDollar(value) : value,
    );
  }
  const content = draft.publicContent as Record<string, unknown>;
  const fixedContent: Record<string, unknown> = { ...content };
  for (const key of ['stem', 'stemTemplate']) {
    if (typeof content[key] === 'string')
      fixedContent[key] = repairDoubledDollar(content[key] as string);
  }
  return {
    ...draft,
    publicContent: fixedContent as NotebookProblemImportDraft['publicContent'],
    grading: fixedGrading as NotebookProblemImportDraft['grading'],
    validationErrors: draft.validationErrors.filter((error) => !POINT_VALUE_NOTE.test(error)),
  };
}

export async function finalizeImportedDrafts(args: {
  drafts: NotebookProblemImportDraft[];
  source: { buffer: Buffer; mimeType: string } | null;
  model: LanguageModel;
  language: 'zh-CN' | 'en-US';
  verifyAnswers?: boolean;
  checkpoint?: <T>(key: string, work: () => Promise<T>) => Promise<T>;
}): Promise<{
  drafts: NotebookProblemImportDraft[];
  skipped: SkippedImportItem[];
  report: ImportQualityReport;
  usage: ImportUsageSummary | null;
}> {
  const checkpoint = args.checkpoint ?? (async <T>(_key: string, work: () => Promise<T>) => work());
  let usage: ImportUsageSummary | null = null;
  const skipped: SkippedImportItem[] = [];
  const kept = args.drafts.filter((draft) => {
    const meta = asRecord(draft.sourceMeta);
    if (meta.promptStatus !== 'solution_only') return true;
    skipped.push({
      title: draft.title,
      pages: [meta.pageStart, meta.pageEnd].filter(
        (value): value is number => typeof value === 'number',
      ),
      reason:
        args.language === 'zh-CN'
          ? '原页只有解答，没有题干；未导入。'
          : 'Source page has a solution only, no prompt; not imported.',
    });
    return false;
  });

  let drafts = kept.map((draft) =>
    repairDraftDelimiters(normalizeChoiceSelection(normalizeRubricPoints(draft))),
  );
  const formatted = await checkpoint('format', () =>
    repairMathFormatting({ drafts, model: args.model }),
  );
  drafts = formatted.drafts;
  usage = mergeImportUsage(usage, formatted.usage);
  let figuresAttached = 0;
  let uniqueFigures = 0;
  const source = args.source;
  if (source) {
    const figures = await checkpoint('figures', () =>
      attachSourceFiguresToDrafts({
        drafts,
        sourceBuffer: source.buffer,
        sourceMimeType: source.mimeType,
        model: args.model,
        language: args.language,
      }),
    );
    drafts = figures.drafts;
    figuresAttached = figures.attachedCount;
    uniqueFigures = figures.uniqueFigureCount;
    usage = mergeImportUsage(usage, figures.usage);
  }

  let verifications: Array<AnswerVerification | null> = drafts.map(() => null);
  if (args.verifyAnswers !== false && drafts.length > 0) {
    const verified = await checkpoint('answers', () =>
      verifyDraftAnswers({
        drafts,
        model: args.model,
        language: args.language,
      }),
    );
    verifications = verified.results;
    usage = mergeImportUsage(usage, verified.usage);
  }

  const issueCounts: ImportQualityReport['issueCounts'] = {};
  drafts = drafts.map((draft, index) => {
    const review = buildImportReview(draft, verifications[index] ?? null);
    for (const issue of review.issues) {
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    }
    return {
      ...draft,
      sourceMeta: { ...draft.sourceMeta, importReview: review },
      validationErrors: review.issues.map((issue) => issue.message.slice(0, 500)),
    };
  });

  const needsReview = drafts.filter(
    (draft) => asRecord(asRecord(draft.sourceMeta).importReview).status === 'needs_review',
  ).length;
  return {
    drafts,
    skipped,
    usage,
    report: {
      total: drafts.length,
      passed: drafts.length - needsReview,
      needsReview,
      skippedSolutionOnly: skipped.length,
      figuresAttached,
      uniqueFigures,
      issueCounts,
    },
  };
}
