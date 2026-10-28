import type {
  NotebookProblemImportDraft,
  NotebookProblemPart,
  NotebookProblemPartGrading,
  NotebookProblemPartPublicContent,
} from '@/lib/problem-bank';
import { extractSubpartSections } from './import.core.drafts';

/**
 * 整理 AI 的输出里，小问要么被拆成几道题（丢了共享题干），要么被挤进一段题面。
 * 这里在补答案之前把两种情况都改成一道 multipart 大题：
 * - 同一大题号（或同一段长题干）的相邻题 → 合并，题干只留一份；
 * - 文字题题面里有 (a)(b)/(i)(ii) → 切成共享题干 + 小问，答案交给后面的补答案步骤。
 */

const MAX_PARTS = 12;
const SHARED_STEM_MIN_CHARS = 120;
const PART_TYPES = new Set([
  'short_answer',
  'choice',
  'proof',
  'calculation',
  'fill_blank',
  'table',
  'code',
]);
const SPLIT_LABEL_RE =
  /^\s*(\d+)\s*[.\-\s]?\s*[(（]?\s*([a-h]|i{1,3}|iv|vi{0,3}|ix|x|\d{1,2})\s*[)）]?\s*$/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stemOf(draft: NotebookProblemImportDraft): string {
  const content = draft.publicContent;
  if (content.type === 'fill_blank') return content.stemTemplate;
  return content.stem;
}

/** 「3(a)」「3 ii」这种拆分标签 → { base: '3', part: 'a' } */
function splitLabelOf(draft: NotebookProblemImportDraft): { base: string; part: string } | null {
  const structure = record(record(draft.sourceMeta).structure);
  const label = typeof structure.topLevelLabel === 'string' ? structure.topLevelLabel : '';
  const match = label.match(SPLIT_LABEL_RE);
  return match ? { base: match[1], part: match[2].toLowerCase() } : null;
}

/** 两段题面的公共开头，截到最后一个段落（或句子）边界。 */
function sharedPrefix(texts: string[]): string {
  if (texts.length < 2) return '';
  let prefix = texts[0];
  for (const text of texts.slice(1)) {
    let index = 0;
    while (index < prefix.length && index < text.length && prefix[index] === text[index])
      index += 1;
    prefix = prefix.slice(0, index);
  }
  const paragraph = prefix.lastIndexOf('\n\n');
  if (paragraph >= SHARED_STEM_MIN_CHARS) return prefix.slice(0, paragraph).trim();
  const sentence = Math.max(
    prefix.lastIndexOf('. '),
    prefix.lastIndexOf('。'),
    prefix.lastIndexOf('：'),
  );
  return sentence >= SHARED_STEM_MIN_CHARS ? prefix.slice(0, sentence + 1).trim() : '';
}

function canBePart(draft: NotebookProblemImportDraft): boolean {
  return (
    PART_TYPES.has(draft.type) &&
    draft.publicContent.type === draft.type &&
    draft.grading.type === draft.type
  );
}

function withPrompt(
  content: NotebookProblemPartPublicContent,
  prompt: string,
): NotebookProblemPartPublicContent {
  return content.type === 'fill_blank'
    ? { ...content, stemTemplate: prompt }
    : { ...content, stem: prompt };
}

/** 代码小问各自的隐藏测试搬到 secretJudge.parts[label]。 */
function mergedPartSecrets(
  group: NotebookProblemImportDraft[],
  labels: string[],
): NotebookProblemImportDraft['secretJudge'] {
  const parts = Object.fromEntries(
    group.flatMap((draft, index) => {
      if (draft.type !== 'code' || !draft.secretJudge) return [];
      const { secretTestCode, secretTests, timeoutMs, files } = draft.secretJudge;
      return [[labels[index], { secretTestCode, secretTests, timeoutMs, files }]];
    }),
  );
  if (Object.keys(parts).length === 0) return undefined;
  const firstCode = group.find((draft) => draft.type === 'code' && draft.secretJudge)?.secretJudge;
  return {
    language: firstCode?.language ?? 'python',
    runnerAdapter: firstCode?.runnerAdapter,
    secretTests: [],
    timeoutMs: 5000,
    parts,
  };
}

function mergeGroup(
  group: NotebookProblemImportDraft[],
  sharedStem: string,
  labels: string[],
): NotebookProblemImportDraft {
  const first = group[0];
  const localized = group.map((draft) => draft.publicContent.translations?.['zh-CN']);
  const translatedTexts = localized.map((t) => t?.stem ?? t?.stemTemplate ?? '');
  const translatedShared = translatedTexts.every(Boolean) ? sharedPrefix(translatedTexts) : '';
  const parts: NotebookProblemPart[] = group.map((draft, index) => {
    const remainder = stemOf(draft).slice(sharedStem.length).trim() || stemOf(draft);
    return {
      label: labels[index],
      points: draft.points || 1,
      content: {
        ...withPrompt(draft.publicContent as NotebookProblemPartPublicContent, remainder),
        ...(localized[index]
          ? {
              translations: {
                ...draft.publicContent.translations,
                'zh-CN': {
                  ...localized[index],
                  ...(draft.type === 'fill_blank'
                    ? { stemTemplate: translatedTexts[index].slice(translatedShared.length).trim() }
                    : { stem: translatedTexts[index].slice(translatedShared.length).trim() }),
                },
              },
            }
          : {}),
      },
    };
  });
  const gradingParts = group.map((draft, index) => ({
    label: labels[index],
    grading: draft.grading as NotebookProblemPartGrading,
  }));
  const difficultyRank = { easy: 0, medium: 1, hard: 2 } as const;
  const hardest = group.reduce((acc, draft) =>
    difficultyRank[draft.difficulty] > difficultyRank[acc.difficulty] ? draft : acc,
  );
  return {
    ...first,
    title: first.title.replace(/\s*[(（]?[a-h]\s*[)）]\s*$/i, '').trim() || first.title,
    type: 'multipart',
    points: group.reduce((acc, draft) => acc + (draft.points || 0), 0) || first.points,
    difficulty: hardest.difficulty,
    publicContent: {
      type: 'multipart',
      contractVersion: first.publicContent.contractVersion,
      statementFormat: first.publicContent.statementFormat,
      responseKind: 'multipart',
      stem: sharedStem || 'Complete each part.',
      ...(translatedTexts.every(Boolean)
        ? {
            translations: {
              'zh-CN': { ...localized[0], stem: translatedShared || '请分别完成以下小问。' },
            },
          }
        : {}),
      parts,
      ...(first.publicContent.assets ? { assets: first.publicContent.assets } : {}),
    },
    grading: { type: 'multipart', graderKind: 'per_part', parts: gradingParts },
    secretJudge: mergedPartSecrets(group, labels),
    sourceMeta: {
      ...first.sourceMeta,
      multipartRepair: 'merged-split-parts',
      mergedDraftIds: group.map((draft) => draft.draftId),
    },
    validationErrors: Array.from(new Set(group.flatMap((draft) => draft.validationErrors))),
  };
}

/** 相邻的、属于同一大题的几道题合成一道。 */
export function mergeSplitPartDrafts(drafts: NotebookProblemImportDraft[]): {
  drafts: NotebookProblemImportDraft[];
  merged: number;
} {
  const output: NotebookProblemImportDraft[] = [];
  let merged = 0;
  let index = 0;
  while (index < drafts.length) {
    const start = drafts[index];
    let end = index + 1;
    const startLabel = splitLabelOf(start);
    if (canBePart(start)) {
      while (end < drafts.length && end - index < MAX_PARTS && canBePart(drafts[end])) {
        const label = splitLabelOf(drafts[end]);
        const sameNumber = Boolean(startLabel && label && label.base === startLabel.base);
        const sameStem =
          sharedPrefix([stemOf(drafts[end - 1]), stemOf(drafts[end])]).length >=
          SHARED_STEM_MIN_CHARS;
        const aMeta = record(start.sourceMeta),
          bMeta = record(drafts[end].sourceMeta);
        const aTop = record(aMeta.structure).topLevelLabel,
          bTop = record(bMeta.structure).topLevelLabel;
        const differentSource = ['mockPaper', 'sourceFile', 'fileName', 'sourceDocumentId'].some(
          (k) => aMeta[k] && bMeta[k] && aMeta[k] !== bMeta[k],
        );
        const conflictingNumbers =
          typeof aTop === 'string' && typeof bTop === 'string' && aTop !== bTop && !sameNumber;
        if (differentSource || conflictingNumbers || (!sameNumber && !sameStem)) break;
        end += 1;
      }
    }
    const group = drafts.slice(index, end);
    const shared = sharedPrefix(group.map(stemOf));
    const numbered = group.map(splitLabelOf);
    const sameNumber =
      numbered.every(Boolean) && new Set(numbered.map((item) => item?.base)).size === 1;
    if (group.length >= 2 && (shared || sameNumber)) {
      const labels = group.map((_, i) => numbered[i]?.part ?? String.fromCharCode(97 + i));
      if (new Set(labels).size !== labels.length) {
        output.push(...group);
        index = end;
        continue;
      }
      output.push(mergeGroup(group, shared, labels));
      merged += 1;
    } else {
      output.push(...group);
    }
    index = end;
  }
  return { drafts: output, merged };
}

/** 文字题（简答、证明、计算）题面里挤着几个小问 → 切成大题；每问的答案由补答案步骤生成。 */
export function splitCrammedPartDraft(
  draft: NotebookProblemImportDraft,
): NotebookProblemImportDraft | null {
  if (draft.type !== 'short_answer' && draft.type !== 'proof' && draft.type !== 'calculation') {
    return null;
  }
  const stem = stemOf(draft);
  const sections = extractSubpartSections(stem);
  if (sections.length < 2 || sections.length > MAX_PARTS) return null;
  const labels = sections.map((section) => section.label);
  if (new Set(labels).size !== labels.length) return null;
  const prefix = stem.slice(0, stem.indexOf(sections[0].text)).trim().replace(/\*\*$/, '').trim();
  const shared =
    prefix || (/[\u4e00-\u9fff]/.test(stem) ? '请分别完成以下小问。' : 'Complete each part.');
  const type = draft.type;
  const translation = draft.publicContent.translations?.['zh-CN'];
  const translatedStem = translation?.stem ?? '';
  const translatedSections = extractSubpartSections(translatedStem);
  const translatedPrefix =
    translatedSections.length === sections.length
      ? translatedStem
          .slice(0, translatedStem.indexOf(translatedSections[0].text))
          .trim()
          .replace(/\*\*$/, '')
          .trim()
      : '';
  const parts: NotebookProblemPart[] = sections.map((section) => {
    const prompt = section.text
      .replace(/^\s*\([^)]+\)\s*/, '')
      .replace(/^\*\*\s*/, '')
      .replace(/\n\s*\*\*\s*$/, '')
      .replace(/^(\([^\n]*?(?:points?|pts?|分)[^\n]*?\))\*\*\s*/i, '$1 ')
      .trim();
    const points = Number(prompt.match(/\((\d+)\s*(?:points?|pts?|分)\)/i)?.[1] ?? 1);
    const translated = translatedSections.find((p) => p.label === section.label);
    const translatedPrompt = translated?.text
      .replace(/^\s*\([^)]+\)\s*/, '')
      .replace(/^\*\*\s*/, '')
      .replace(/\n\s*\*\*\s*$/, '')
      .replace(/^([（(][^\n]*?(?:points?|pts?|分)[^\n]*?[)）])\*\*\s*/i, '$1 ')
      .trim();
    return {
      label: section.label,
      points,
      content: {
        type,
        stem: prompt,
        ...(translatedPrompt ? { translations: { 'zh-CN': { stem: translatedPrompt } } } : {}),
      },
    };
  });
  const original = draft.grading;
  const reference =
    original.type === 'proof'
      ? original.referenceProof
      : original.type === 'short_answer' || original.type === 'calculation'
        ? original.referenceAnswer
        : undefined;
  return {
    ...draft,
    type: 'multipart',
    publicContent: {
      type: 'multipart',
      contractVersion: draft.publicContent.contractVersion,
      statementFormat: draft.publicContent.statementFormat,
      responseKind: 'multipart',
      stem: shared,
      ...(translation && translatedSections.length === sections.length
        ? {
            translations: {
              'zh-CN': { ...translation, stem: translatedPrefix || '请分别完成以下小问。' },
            },
          }
        : {}),
      parts,
      ...(draft.publicContent.assets ? { assets: draft.publicContent.assets } : {}),
    },
    // 每问的答案留空，交给补答案步骤；原来的整题答案放进解析当参考
    grading: {
      type: 'multipart',
      graderKind: 'per_part',
      parts: parts.map((part) => ({
        label: part.label,
        grading: { type } as NotebookProblemPartGrading,
      })),
      ...(reference || original.analysis
        ? { analysis: [reference, original.analysis].filter(Boolean).join('\n\n').slice(0, 12000) }
        : {}),
    },
    sourceMeta: { ...draft.sourceMeta, multipartRepair: 'split-crammed-parts' },
  };
}

export function restructureMultipartDrafts(drafts: NotebookProblemImportDraft[]): {
  drafts: NotebookProblemImportDraft[];
  warnings: string[];
} {
  const merged = mergeSplitPartDrafts(drafts);
  let split = 0;
  const output = merged.drafts.map((draft) => {
    const next = splitCrammedPartDraft(draft);
    if (next) split += 1;
    return next ?? draft;
  });
  const warnings = [
    merged.merged ? `合并了 ${merged.merged} 组被拆开的小问。` : '',
    split ? `把 ${split} 道挤在一起的小问切成了大题。` : '',
  ].filter(Boolean);
  return { drafts: output, warnings };
}
