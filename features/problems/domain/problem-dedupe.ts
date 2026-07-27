import { createHash } from 'node:crypto';
import type { NotebookProblemPublicContent } from '@/lib/problem-bank';

const COURSE_PROBLEM_DEDUPE_VERSION = 'v2';
const MEANINGFUL_DOT_TOKEN = '__openmaic_math_dot__';

type StableDedupeValue =
  | null
  | boolean
  | number
  | string
  | StableDedupeValue[]
  | { [key: string]: StableDedupeValue };

type ProblemDedupeInput = {
  title: string;
  type: string;
  publicContent: NotebookProblemPublicContent;
};

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function stableSerialize(value: StableDedupeValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
    .join(',')}}`;
}

function normalizeOptionalText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return normalizeProblemDedupeText(value) || null;
}

function normalizeOptionalCode(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim();
  return normalized || null;
}

function localizedPromptIdentity(content: NotebookProblemPublicContent): StableDedupeValue {
  const translationIdentity = (locale: 'zh-CN' | 'en-US'): StableDedupeValue => {
    const translation = content.translations?.[locale];
    if (!translation) return null;
    return {
      options:
        translation.options?.map((option) => normalizeProblemDedupeText(option.label)) ?? null,
      stem: normalizeOptionalText(translation.stem),
      stemTemplate: normalizeOptionalText(translation.stemTemplate),
    };
  };

  return {
    'en-US': translationIdentity('en-US'),
    'zh-CN': translationIdentity('zh-CN'),
  };
}

function questionAssetIdentity(content: NotebookProblemPublicContent): StableDedupeValue {
  return (content.assets?.images ?? [])
    .filter((image) => image.role !== 'explanation')
    .map((image) => ({
      alt: normalizeOptionalText(image.alt),
      caption: normalizeOptionalText(image.caption),
      role: image.role,
      srcDigest: sha256(image.src.trim()),
    }));
}

function commonQuestionIdentity(content: NotebookProblemPublicContent): {
  assets: StableDedupeValue;
  translations: StableDedupeValue;
} {
  return {
    assets: questionAssetIdentity(content),
    translations: localizedPromptIdentity(content),
  };
}

function publicQuestionIdentity(content: NotebookProblemPublicContent): StableDedupeValue {
  const common = commonQuestionIdentity(content);

  switch (content.type) {
    case 'choice':
      return {
        ...common,
        options: content.options.map((option) => normalizeProblemDedupeText(option.label)),
        selectionMode: content.selectionMode,
        stem: normalizeProblemDedupeText(content.stem),
        type: content.type,
      };
    case 'calculation':
      return {
        ...common,
        stem: normalizeProblemDedupeText(content.stem),
        type: content.type,
        unit: normalizeOptionalText(content.unit),
      };
    case 'fill_blank':
      return {
        ...common,
        blanks: content.blanks.map((blank, index) => ({
          position: index + 1,
          placeholder: normalizeOptionalText(blank.placeholder),
        })),
        stemTemplate: normalizeProblemDedupeText(content.stemTemplate),
        type: content.type,
      };
    case 'code':
      return {
        ...common,
        constraints: content.constraints.map(normalizeProblemDedupeText),
        functionSignature: normalizeOptionalCode(content.functionSignature),
        language: content.language,
        publicTests: content.publicTests.map((test) => ({
          description: normalizeOptionalText(test.description),
          expected: normalizeOptionalCode(test.expected),
          expression: normalizeOptionalCode(test.expression),
        })),
        sampleIO: content.sampleIO.map((sample) => ({
          explanation: normalizeOptionalText(sample.explanation),
          input: normalizeOptionalCode(sample.input),
          output: normalizeOptionalCode(sample.output),
        })),
        starterCode: normalizeOptionalCode(content.starterCode),
        starterCodeDescription: normalizeOptionalText(content.starterCodeDescription),
        statementSections:
          content.statementSections?.map((section) => ({
            body: normalizeOptionalText(section.body),
            code: normalizeOptionalCode(section.code),
            codeLanguage: section.codeLanguage?.trim().toLowerCase() ?? null,
            items: section.items.map(normalizeProblemDedupeText),
            kind: section.kind,
            title: normalizeProblemDedupeText(section.title),
          })) ?? null,
        stem: normalizeProblemDedupeText(content.stem),
        type: content.type,
      };
    case 'proof':
    case 'short_answer':
      return {
        ...common,
        stem: normalizeProblemDedupeText(content.stem),
        type: content.type,
      };
  }
}

function collectSignalStrings(value: StableDedupeValue, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectSignalStrings(item, output);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectSignalStrings(item, output);
  }
}

function problemDedupeSignalText(content: NotebookProblemPublicContent): string {
  const values: string[] = [];
  collectSignalStrings(publicQuestionIdentity(content), values);
  return values.join('\n');
}

export function problemDedupeStem(content: NotebookProblemPublicContent): string {
  return stableSerialize(publicQuestionIdentity(content));
}

export function normalizeProblemDedupeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/\\(?:leq|le)\b/giu, ' <= ')
    .replace(/\\(?:geq|ge)\b/giu, ' >= ')
    .replace(/\\neq\b/giu, ' != ')
    .replace(/\\notin\b/giu, ' ∉ ')
    .replace(/\\in\b/giu, ' ∈ ')
    .replace(/\\subseteq\b/giu, ' ⊆ ')
    .replace(/\\subset\b/giu, ' ⊂ ')
    .replace(/\\supseteq\b/giu, ' ⊇ ')
    .replace(/\\supset\b/giu, ' ⊃ ')
    .replace(/\\setminus\b/giu, ' ∖ ')
    .replace(/\\cup\b/giu, ' ∪ ')
    .replace(/\\cap\b/giu, ' ∩ ')
    .replace(/\\(?:emptyset|varnothing)\b/giu, ' ∅ ')
    .replace(/\\(?:leftrightarrow|iff)\b/giu, ' <-> ')
    .replace(/\\(?:rightarrow|to|implies)\b/giu, ' -> ')
    .replace(/\\leftarrow\b/giu, ' <- ')
    .replace(/\\(?:land|wedge)\b/giu, ' && ')
    .replace(/\\(?:lor|vee)\b/giu, ' || ')
    .replace(/\\(?:neg|lnot|not)\b/giu, ' ! ')
    .replace(/\\forall\b/giu, ' ∀ ')
    .replace(/\\exists\b/giu, ' ∃ ')
    .replace(/\\(?:times|cdot)\b/giu, ' * ')
    .replace(/\\div\b/giu, ' / ')
    .replace(/[≤≦⩽]/gu, '<=')
    .replace(/[≥≧⩾]/gu, '>=')
    .replace(/[≠]/gu, '!=')
    .replace(/[×⋅·]/gu, '*')
    .replace(/[÷]/gu, '/')
    .replace(/[⇔↔⟺]/gu, '<->')
    .replace(/[⇒→⟹]/gu, '->')
    .replace(/[⇐←⟸]/gu, '<-')
    .replace(/[∧⋀]/gu, '&&')
    .replace(/[∨⋁]/gu, '||')
    .replace(/[¬]/gu, '!')
    .replace(
      /(?<=[\p{Letter}\p{Number}_])\.(?=[\p{Letter}\p{Number}_])/gu,
      ` ${MEANINGFUL_DOT_TOKEN} `,
    )
    .replace(/[^\p{Letter}\p{Number}\p{Sm}\s_+\-<>=*\/^%&|!~:()[\]{}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .replaceAll(MEANINGFUL_DOT_TOKEN, '.')
    .trim();
}

export function fullProblemFingerprint(input: {
  title: string;
  type: string;
  publicContent: NotebookProblemPublicContent;
}): string {
  return sha256(
    [
      input.type,
      normalizeProblemDedupeText(input.title),
      problemDedupeStem(input.publicContent),
    ].join('\n'),
  );
}

/**
 * Title-independent supplement for deterministic course-level dedupe.
 *
 * Short generic prompts are deliberately excluded so unrelated questions such
 * as "Solve" or "Choose the correct answer" do not collapse merely because
 * their titles changed. Choice options and code scaffolds are part of the stem.
 */
export function contentOnlyProblemFingerprint(input: {
  type: string;
  publicContent: NotebookProblemPublicContent;
}): string | null {
  const normalizedStem = normalizeProblemDedupeText(problemDedupeSignalText(input.publicContent));
  const compactStem = normalizedStem.replace(/\s+/g, '');
  if (!compactStem) return null;

  const hasHan = /\p{Script=Han}/u.test(compactStem);
  const tokens = normalizedStem.match(/[\p{Letter}\p{Number}_+\-]+/gu) ?? [];
  const uniqueCharacters = new Set(Array.from(compactStem)).size;
  const longEnough = hasHan
    ? compactStem.length >= 18
    : compactStem.length >= 48 && tokens.length >= 7;
  if (!longEnough || uniqueCharacters < 8) return null;

  return sha256(`${input.type}\n${problemDedupeStem(input.publicContent)}`);
}

/**
 * Canonical key persisted under the course-level database uniqueness
 * constraint. Prefer substantive title-independent content; fall back to the
 * title+content fingerprint for short prompts where content-only matching
 * would be unsafe.
 */
export function courseProblemDedupeKey(input: ProblemDedupeInput): string {
  const contentFingerprint = contentOnlyProblemFingerprint(input);
  return contentFingerprint
    ? `${COURSE_PROBLEM_DEDUPE_VERSION}:content:${contentFingerprint}`
    : `${COURSE_PROBLEM_DEDUPE_VERSION}:full:${fullProblemFingerprint(input)}`;
}
