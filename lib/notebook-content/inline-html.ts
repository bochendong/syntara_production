import { renderInlineMathAwareHtml } from '@/lib/math-engine';

export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function readBalancedBraceArgument(
  source: string,
  openIndex: number,
): { value: string; index: number } | null {
  if (source[openIndex] !== '{') return null;

  let depth = 1;
  let i = openIndex + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
      continue;
    }
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return { value: source.slice(openIndex + 1, i), index: i + 1 };
    }
    i += 1;
  }

  return null;
}

function normalizeEmbeddedSyntaraMathCommands(text: string): string {
  const commandPattern = /\\{1,2}formula\s*\{/g;
  if (!commandPattern.test(text)) return text;

  commandPattern.lastIndex = 0;
  let result = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = commandPattern.exec(text))) {
    const openIndex = match.index + match[0].length - 1;
    const argument = readBalancedBraceArgument(text, openIndex);
    if (!argument) continue;

    result += text.slice(lastIndex, match.index);
    const latex = argument.value.trim();
    if (latex) result += `\\(${latex}\\)`;
    lastIndex = argument.index;
    commandPattern.lastIndex = argument.index;
  }

  if (lastIndex === 0) return text;
  result += text.slice(lastIndex);
  return result;
}

export function renderInlineLatexToHtml(text: string): string {
  const normalizedText = normalizeEmbeddedSyntaraMathCommands(text);
  return renderInlineMathAwareHtml(normalizedText);
}
