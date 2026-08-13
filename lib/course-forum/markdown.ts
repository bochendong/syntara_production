import { normalizeLooseMathDelimiters } from '@/lib/math-engine';

const DISPLAY_ENVIRONMENT_START =
  /^\\begin\{(?:align\*?|aligned|cases|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix)\}/;
const DISPLAY_ENVIRONMENT_END =
  /^\\end\{(?:align\*?|aligned|cases|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix)\}/;
const CODE_FRAGMENT_PATTERN = /(```[\s\S]*?```|~~~[\s\S]*?~~~|`[^`\n]*`)/g;

function balanceDisplayMathBlocks(markdown: string): string {
  const lines = markdown.split('\n');
  const output: string[] = [];
  let displayOpen = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (trimmed === '$$') {
      output.push(line);
      displayOpen = !displayOpen;
      continue;
    }

    if (DISPLAY_ENVIRONMENT_START.test(trimmed) && !displayOpen) {
      output.push('$$');
      displayOpen = true;
    }

    output.push(line);

    if (DISPLAY_ENVIRONMENT_END.test(trimmed) && displayOpen) {
      let nextMeaningfulIndex = index + 1;
      while (nextMeaningfulIndex < lines.length && !lines[nextMeaningfulIndex].trim()) {
        nextMeaningfulIndex += 1;
      }

      if (lines[nextMeaningfulIndex]?.trim() === '$$') {
        for (let blankIndex = index + 1; blankIndex < nextMeaningfulIndex; blankIndex += 1) {
          output.push(lines[blankIndex]);
        }
        output.push(lines[nextMeaningfulIndex]);
        index = nextMeaningfulIndex;
      } else {
        output.push('$$');
      }
      displayOpen = false;
    }
  }

  if (displayOpen) {
    const lastMeaningfulIndex = output.findLastIndex((line) => line.trim());
    if (output[lastMeaningfulIndex]?.trim() === '$$') {
      output.splice(lastMeaningfulIndex, 1);
    } else {
      output.push('$$');
    }
  }

  return output.join('\n');
}

/**
 * Keep the stored forum Markdown untouched while making its rendered form
 * tolerant of common formula-composer boundaries and pasted LaTeX blocks.
 */
function normalizeForumTextSegment(markdown: string): string {
  // `$a$$b$` is two adjacent inline formulas, but Markdown math parsers often
  // interpret the middle `$$` as the start of display math. A single space
  // preserves both formulas and removes that ambiguity.
  const separatedInlineMath = markdown.replace(/(\S)\$\$(?=\S)/g, '$1$ $');
  const balancedDisplayMath = balanceDisplayMathBlocks(separatedInlineMath);

  // The shared math normalizer wraps complete bare environments such as
  // aligned/cases/matrix without changing fenced code blocks or normal prose.
  const normalized = normalizeLooseMathDelimiters(balancedDisplayMath);

  return normalized.replace(/\n{3,}/g, '\n\n');
}

export function normalizeForumMarkdownForDisplay(markdown: string): string {
  if (!markdown) return markdown;

  // Formula repair is display-only and must never rewrite code examples.
  return markdown
    .split(CODE_FRAGMENT_PATTERN)
    .map((fragment, index) => (index % 2 === 1 ? fragment : normalizeForumTextSegment(fragment)))
    .join('');
}
