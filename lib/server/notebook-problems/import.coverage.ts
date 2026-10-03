import type { ProblemStructurePlan } from './import.core.types';

/**
 * Deterministic coverage check for problem extraction. Printed question numbers are read
 * from the PDF text layer and compared with the model's structure plan, so merged
 * questions ("Questions 3–7" turned into one bundle) and silently dropped questions are
 * detected instead of trusted. Scanned PDFs without a text layer yield no labels and the
 * check is skipped.
 */

export type PrintedQuestionLabel = { number: number; label: string; pageNumber: number };

export type StructureCoverage = {
  checked: boolean;
  printed: PrintedQuestionLabel[];
  missing: PrintedQuestionLabel[];
  merged: Array<{ index: number; topLevelLabel: string; covers: number[] }>;
};

const LINE_LABEL_PATTERNS: RegExp[] = [
  /^\s*(?:question|problem|exercise|q)\s*#?\s*(\d{1,3})\s*([a-z])?\s*(?:[:.)：]|$|\s)/i,
  /^\s*第\s*(\d{1,3})\s*题/,
  /^\s*题目\s*(\d{1,3})/,
];
const RANGE_PATTERN =
  /\b(?:for\s+)?(?:questions?|problems?|q)\s*(\d{1,3})\s*(?:–|—|-|to|through)\s*(\d{1,3})\b|第\s*(\d{1,3})\s*[-–—至到]\s*(\d{1,3})\s*题/i;

export async function detectPrintedQuestionLabels(
  pdfBuffer: Buffer,
): Promise<PrintedQuestionLabel[]> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const seen = new Map<number, PrintedQuestionLabel>();
  pages.forEach((pageText, pageIndex) => {
    const pageNumber = pageIndex + 1;
    for (const line of String(pageText).split('\n')) {
      for (const pattern of LINE_LABEL_PATTERNS) {
        const match = line.match(pattern);
        if (!match) continue;
        const number = Number(match[1]);
        if (number > 0 && !seen.has(number)) {
          seen.set(number, { number, label: `${number}${match[2] ?? ''}`, pageNumber });
        }
        break;
      }
      const range = line.match(RANGE_PATTERN);
      if (range) {
        const start = Number(range[1] ?? range[3]);
        const end = Number(range[2] ?? range[4]);
        if (start > 0 && end > start && end - start <= 30) {
          for (let number = start; number <= end; number += 1) {
            if (!seen.has(number)) seen.set(number, { number, label: String(number), pageNumber });
          }
        }
      }
    }
  });
  return [...seen.values()].sort((left, right) => left.number - right.number);
}

/** Question numbers a structure item claims, e.g. "9a" → [9], "3–7" → [3..7], "16, 17" → [16, 17]. */
export function structureItemNumbers(topLevelLabel: string): number[] {
  const label = topLevelLabel.trim();
  const range = label.match(/(\d{1,3})\s*(?:–|—|-|~|to|至|到)\s*(\d{1,3})/i);
  if (range) {
    const start = Number(range[1]);
    const end = Number(range[2]);
    if (end > start && end - start <= 30) {
      return Array.from({ length: end - start + 1 }, (_, offset) => start + offset);
    }
  }
  // "16, 17 & 18" lists several questions; "2a-1" or "Q3(b)(ii)" is one question.
  const list = label.match(/^\D*(\d{1,3}(?:\s*(?:,|，|、|&|and|和)\s*\d{1,3})+)\b/i);
  if (list) return [...new Set((list[1].match(/\d{1,3}/g) ?? []).map(Number))];
  const leading = label.match(/\d{1,3}/);
  return leading ? [Number(leading[0])] : [];
}

export function analyzeStructureCoverage(
  plan: ProblemStructurePlan | null,
  printed: PrintedQuestionLabel[],
): StructureCoverage {
  // Too few labels means the numbering style was not recognized; do not guess.
  if (printed.length < 3) return { checked: false, printed, missing: [], merged: [] };
  if (!plan) return { checked: true, printed, missing: printed, merged: [] };
  const printedNumbers = new Set(printed.map((label) => label.number));
  const covered = new Set<number>();
  const merged: StructureCoverage['merged'] = [];
  for (const item of plan.topLevelProblems) {
    const numbers = structureItemNumbers(item.topLevelLabel).filter((number) =>
      printedNumbers.has(number),
    );
    numbers.forEach((number) => covered.add(number));
    if (numbers.length > 1) {
      merged.push({ index: item.index, topLevelLabel: item.topLevelLabel, covers: numbers });
    }
  }
  return {
    checked: true,
    printed,
    missing: printed.filter((label) => !covered.has(label.number)),
    merged,
  };
}

export function coverageScore(coverage: StructureCoverage): number {
  return (
    coverage.missing.length +
    coverage.merged.reduce((total, item) => total + item.covers.length - 1, 0)
  );
}

export function coverageRetryInstruction(
  coverage: StructureCoverage,
  language: 'zh-CN' | 'en-US',
): string {
  const list = coverage.printed.map((label) => `${label.label}(p${label.pageNumber})`).join(', ');
  const missing = coverage.missing.map((label) => label.label).join(', ');
  const merged = coverage.merged.map((item) => item.topLevelLabel).join('; ');
  return language === 'zh-CN'
    ? `\n\n上一次目录没有覆盖原卷的全部题号。原卷文字层识别到这些印刷题号（括号内为物理页）：${list}。
${missing ? `漏掉的题号：${missing}。` : ''}${merged ? `被合并的条目：${merged}。` : ''}
请重新生成完整目录：每个印刷题号至少一个 topLevelProblems 条目；独立计分的小问可拆成“1a”“1b”等条目，但一个条目不能包含多个不同题号。即使多道题共用同一段材料、同一张图或同一张表，也必须分开建立条目，并在 sharedContexts 中记录共享材料；不要把连续的判断题、选择题或表格行合并成一道题，也不要改写成组合选择题。若某题号确实不是题目（例如只是页眉或答案），放入 nonProblemRegions 并说明原因。`
    : `\n\nThe previous outline did not cover every printed question. The PDF text layer shows these printed question numbers (physical page in parentheses): ${list}.
${missing ? `Missing: ${missing}. ` : ''}${merged ? `Merged items: ${merged}.` : ''}
Regenerate the full outline with at least one topLevelProblems item per printed question number; independently scored subparts may be separate items labelled "1a", "1b", but no item may contain two different question numbers. Questions that share one passage, figure, or table still get separate items, with the shared material recorded in sharedContexts. Never merge consecutive true/false, multiple-choice, or table-row questions into one problem, and never rewrite them as a combined choice question. If a number is not actually a question (a header or an answer), list it in nonProblemRegions with the reason.`;
}

/** Tells the outline pass which printed numbers exist, so it can produce one item each. */
export function printedLabelsHint(
  printed: PrintedQuestionLabel[],
  language: 'zh-CN' | 'en-US',
): string {
  if (printed.length < 3) return '';
  const list = printed.map((label) => `${label.label}(p${label.pageNumber})`).join(', ');
  return language === 'zh-CN'
    ? `\n原卷文字层识别到这些印刷题号（括号内为物理页）：${list}。每个题号至少建立一个条目，不同题号不能合并。`
    : `\nThe PDF text layer shows these printed question numbers (physical page in parentheses): ${list}. Create at least one item per number and never merge different numbers.`;
}

/**
 * Language of the source text layer. Prompts written in the wrong language leak that
 * language into stems (e.g. Chinese hints inside an English exam), so the outline and
 * transcription passes follow the source. Returns null when there is no usable text.
 */
export async function detectSourceLanguage(pdfBuffer: Buffer): Promise<'zh-CN' | 'en-US' | null> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const { text } = await extractText(pdf, { mergePages: true });
  const content = Array.isArray(text) ? text.join('\n') : String(text);
  const cjk = content.match(/[\u4e00-\u9fff]/g)?.length ?? 0;
  const latinWords = content.match(/[A-Za-z]{2,}/g)?.length ?? 0;
  if (cjk + latinWords < 40) return null;
  // A Chinese character carries roughly a word; headers in the other language are common.
  return cjk > latinWords ? 'zh-CN' : 'en-US';
}
