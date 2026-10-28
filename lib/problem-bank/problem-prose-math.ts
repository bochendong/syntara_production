import { repairMalformedProblemMath } from './repair-malformed-math';

const INLINE_TOKEN =
  /(`+)([^\n]*?)\1|(?<!\\)\$\$(?:\\[\s\S]|[^\\])*?\$\$|(?<!\\)\$(?:\\[\s\S]|[^$\\])+?\$|\\\([\s\S]*?\\\)|\\\[[\s\S]*?\\\]/g;
const LATEX_COMMAND =
  /\\(?:d?frac|tfrac|sqrt|log|ln|sin|cos|tan|lim|sum|prod|int|mathbb|mathbf|cdot|times|left|right)(?![A-Za-z])/;

function repairProse(text: string): string {
  // Keep the existing legacy dollar-run repair without rewriting valid formulas
  // that contain escaped currency symbols. Fenced programs are handled separately.
  text = text
    .split('\n')
    .map((line) =>
      /\${3,}|\$[\u3400-\u9fff]/u.test(line) ? repairMalformedProblemMath(line) : line,
    )
    .join('\n');
  const graphContext = /图[像象形]|变换|\b(?:graphs?|transformations?)\b/i.test(text);
  const numbers = (value: string) => value.replace(/(?<=\d)\{\s*,\s*\}(?=\d{3}(?:\D|$))/g, ',');
  let result = '';
  let cursor = 0;
  for (const match of text.matchAll(INLINE_TOKEN)) {
    result += numbers(text.slice(cursor, match.index));
    const value = match[2]?.trim();
    const isCode = value && /["']|\b(?:print|return|def|import|lambda)\b/.test(value);
    const graphIdentity = graphContext && value && /^[a-z]\s*=\s*[A-Z]\([a-z]\)$/.test(value);
    const inlineMath =
      match[1] === '`' && value && !isCode && (LATEX_COMMAND.test(value) || graphIdentity);
    result += inlineMath
      ? value.startsWith('$') && value.endsWith('$')
        ? value
        : `$${value}$`
      : match[0];
    cursor = match.index + match[0].length;
  }
  return result + numbers(text.slice(cursor));
}

/** Repair legacy prose markup only; never rewrite stored data or fenced program code. */
export function repairProblemProseMath(text: string): string {
  let result = '';
  let prose = '';
  let fence: { character: string; length: number } | null = null;
  for (const line of text.split(/(?<=\n)/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})([^\r\n]*)/);
    if (fence) {
      result += line;
      if (
        marker &&
        marker[1][0] === fence.character &&
        marker[1].length >= fence.length &&
        !marker[2].trim()
      )
        fence = null;
    } else if (marker) {
      result += repairProse(prose) + line;
      prose = '';
      fence = { character: marker[1][0], length: marker[1].length };
    } else {
      prose += line;
    }
  }
  return result + repairProse(prose);
}

/** Keep explicit math intact while the Markdown parser handles tables, lists and emphasis. */
export function protectProblemMath(text: string, render: (source: string) => string) {
  const expressions: string[] = [];
  const protectedText = text.replace(
    /(`+)[^\n]*?\1|(?<!\\)\$\$(?:\\[\s\S]|[^\\])*?\$\$|(?<!\\)\$(?:\\[\s\S]|[^$\\])+?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)/g,
    (source) => {
      if (source.includes('`')) return source;
      const token = `SYNPROTECTEDMATH${expressions.length}TOKEN`;
      expressions.push(render(source));
      return token;
    },
  );
  return {
    text: protectedText,
    restore: (html: string) =>
      html.replace(
        /SYNPROTECTEDMATH(\d+)TOKEN/g,
        (token, index: string) => expressions[Number(index)] ?? token,
      ),
  };
}
