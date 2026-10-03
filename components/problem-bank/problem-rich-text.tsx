'use client';

import { memo, useMemo, useState } from 'react';
import { Download, Eye, FileImage } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { expandLegacyCodeTables } from '@/lib/problem-bank/markdown-structure';
import { repairMalformedProblemMath } from '@/lib/problem-bank/repair-malformed-math';
import {
  renderHtmlWithLatex,
  renderPlainTitleWithOptionalLatex,
} from '@/lib/render-html-with-latex';
import { parseMathFragments, renderMathToHtml, renderTextWithMathToHtml } from '@/lib/math-engine';
import type { NotebookProblemImageAsset, NotebookProblemPublicContent } from '@/lib/problem-bank';
import { cn } from '@/lib/utils';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

type CodeFenceInfo = {
  marker: string;
  language: string;
};

function parseCodeFenceStart(line: string): CodeFenceInfo | null {
  const match = line.match(/^\s*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_+.-]*)?.*$/);
  if (!match) return null;
  return {
    marker: match[1],
    language: match[2]?.trim() ?? '',
  };
}

function isCodeFenceEnd(line: string, marker: string): boolean {
  const fenceChar = marker[0];
  const trimmed = line.trim();
  const match = fenceChar === '`' ? trimmed.match(/^(`{3,})\s*$/) : trimmed.match(/^(~{3,})\s*$/);
  return Boolean(match && match[1].length >= marker.length);
}

function sanitizeCodeLanguage(language: string): string {
  return language
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-');
}

const PYTHON_KEYWORDS = new Set([
  'and',
  'as',
  'assert',
  'async',
  'await',
  'break',
  'class',
  'continue',
  'def',
  'del',
  'elif',
  'else',
  'except',
  'finally',
  'for',
  'from',
  'global',
  'if',
  'import',
  'in',
  'is',
  'lambda',
  'nonlocal',
  'not',
  'or',
  'pass',
  'raise',
  'return',
  'try',
  'while',
  'with',
  'yield',
]);

const PYTHON_BUILTINS = new Set([
  'bool',
  'dict',
  'float',
  'id',
  'int',
  'len',
  'list',
  'print',
  'range',
  'set',
  'str',
  'tuple',
  'type',
]);

const PYTHON_LITERALS = new Set(['False', 'None', 'True']);

function renderCodeToken(kind: string, text: string): string {
  return `<span class="problem-rich-code-token-${kind}">${escapeHtml(text)}</span>`;
}

function renderHighlightedPythonCode(code: string): string {
  let html = '';
  let cursor = 0;

  while (cursor < code.length) {
    const char = code[cursor];
    const nextTwo = code.slice(cursor, cursor + 2);
    const nextThree = code.slice(cursor, cursor + 3);

    if (char === '#') {
      const end = code.indexOf('\n', cursor);
      const comment = end === -1 ? code.slice(cursor) : code.slice(cursor, end);
      html += renderCodeToken('comment', comment);
      cursor += comment.length;
      continue;
    }

    if (char === '"' || char === "'") {
      const quote = nextThree === char.repeat(3) ? char.repeat(3) : char;
      let index = cursor + quote.length;
      while (index < code.length) {
        if (code[index] === '\\') {
          index += 2;
          continue;
        }
        if (code.slice(index, index + quote.length) === quote) {
          index += quote.length;
          break;
        }
        index += 1;
      }
      html += renderCodeToken('string', code.slice(cursor, index));
      cursor = index;
      continue;
    }

    if (/\d/.test(char) || nextTwo === '-0' || /^-\d$/.test(nextTwo)) {
      const match = code.slice(cursor).match(/^-?\d+(?:\.\d+)?/);
      if (match) {
        html += renderCodeToken('number', match[0]);
        cursor += match[0].length;
        continue;
      }
    }

    if (/[A-Za-z_]/.test(char)) {
      const match = code.slice(cursor).match(/^[A-Za-z_][A-Za-z0-9_]*/);
      if (match) {
        const word = match[0];
        if (PYTHON_KEYWORDS.has(word)) {
          html += renderCodeToken('keyword', word);
        } else if (PYTHON_LITERALS.has(word)) {
          html += renderCodeToken('literal', word);
        } else if (PYTHON_BUILTINS.has(word)) {
          html += renderCodeToken('builtin', word);
        } else {
          html += escapeHtml(word);
        }
        cursor += word.length;
        continue;
      }
    }

    html += escapeHtml(char);
    cursor += 1;
  }

  return html;
}

function renderCodeBlock(lines: string[], language: string): string {
  const normalizedLanguage = sanitizeCodeLanguage(language);
  const className = normalizedLanguage ? ` class="language-${normalizedLanguage}"` : '';
  const code = lines.join('\n');
  const renderedCode =
    normalizedLanguage === 'python' || normalizedLanguage === 'py'
      ? renderHighlightedPythonCode(code)
      : escapeHtml(code);
  return `<pre class="not-prose problem-rich-code-block"><code${className}>${renderedCode}</code></pre>`;
}

function renderInlineFormatting(text: string): string {
  // Keep formulas opaque to Markdown while preserving emphasis around them.
  const formulas: string[] = [];
  const source = parseMathFragments(text)
    .map((fragment) => {
      if (fragment.type === 'text') return fragment.value;
      const index =
        formulas.push(
          renderMathToHtml(fragment.value, {
            displayMode: fragment.displayMode || fragment.complex,
          }),
        ) - 1;
      return `\uE000${index}\uE001`;
    })
    .join('');
  return renderPlainInlineFormatting(source).replace(
    /\uE000(\d+)\uE001/g,
    (match, index) => formulas[Number(index)] ?? match,
  );
}

function renderPlainInlineFormatting(text: string): string {
  return (
    escapeHtml(text)
      // Only attribute-free line breaks are markup; all other HTML stays escaped.
      .replace(/&lt;br\s*\/?&gt;/gi, '<br/>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/(^|[\s（(])\*([^*\n]+)\*(?=$|[\s，。！？；、,.!?)）])/g, '$1<em>$2</em>')
      .replace(/(^|[\s（(])_([^_\n]+)_(?=$|[\s，。！？；、,.!?)）])/g, '$1<em>$2</em>')
      .replace(/\n/g, '<br/>')
  );
}

function renderInlineMarkdown(text: string): string {
  let html = '';
  let cursor = 0;

  while (cursor < text.length) {
    const tickStart = text.indexOf('`', cursor);
    if (tickStart === -1) {
      html += renderInlineFormatting(text.slice(cursor));
      break;
    }

    html += renderInlineFormatting(text.slice(cursor, tickStart));
    const codeStart = tickStart + 1;
    const tickEnd = text.indexOf('`', codeStart);
    if (tickEnd === -1) {
      html += '&#96;';
      cursor = codeStart;
      continue;
    }

    html += `<code class="problem-rich-inline-code">${escapeHtml(
      text.slice(codeStart, tickEnd),
    )}</code>`;
    cursor = tickEnd + 1;
  }

  return html;
}

function protectFencedCodeBlocks(text: string): { text: string; blocks: string[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const fence = parseCodeFenceStart(lines[index]);
    if (!fence) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const blockLines = [lines[index]];
    index += 1;
    while (index < lines.length) {
      blockLines.push(lines[index]);
      if (isCodeFenceEnd(lines[index], fence.marker)) {
        index += 1;
        break;
      }
      index += 1;
    }

    const token = `@@SYNTARA_FENCED_CODE_${blocks.length}@@`;
    blocks.push(blockLines.join('\n'));
    output.push(token);
  }

  return { text: output.join('\n'), blocks };
}

function restoreFencedCodeBlocks(text: string, blocks: string[]): string {
  return blocks.reduce(
    (current, block, index) => current.replaceAll(`@@SYNTARA_FENCED_CODE_${index}@@`, block),
    text,
  );
}

function tableCellCount(row: string): number {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
}

function nextPipeRow(text: string, start: number, columnCount: number) {
  let index = start;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  if (text[index] !== '|') return null;

  let pipeCount = 0;
  for (let cursor = index; cursor < text.length; cursor += 1) {
    if (text[cursor] === '|') pipeCount += 1;
    if (pipeCount === columnCount + 1) {
      return {
        row: text.slice(index, cursor + 1).trim(),
        end: cursor + 1,
      };
    }
  }
  return null;
}

function normalizeInlinePipeTables(text: string): string {
  let output = '';
  let cursor = 0;
  const separatorPattern = /\|(?:\s*:?-{3,}:?\s*\|){2,}/g;
  let match: RegExpExecArray | null;

  while ((match = separatorPattern.exec(text))) {
    const separatorStart = match.index;
    if (separatorStart < cursor) continue;
    const columnCount = tableCellCount(match[0]);
    const before = text.slice(cursor, separatorStart);
    const pipePositions = [...before.matchAll(/\|/g)].map((item) => item.index ?? 0);
    if (pipePositions.length < columnCount + 1) continue;

    const tableStart = cursor + pipePositions[pipePositions.length - (columnCount + 1)];
    let rowCursor = tableStart;
    const rows: string[] = [];
    for (let rowIndex = 0; rowIndex < 40; rowIndex += 1) {
      const row = nextPipeRow(text, rowCursor, columnCount);
      if (!row) break;
      rows.push(row.row);
      rowCursor = row.end;
    }

    if (rows.length < 2 || !rows.some((row) => /^-+$/.test(row.replace(/[|:\s]/g, '')))) {
      continue;
    }

    output += text.slice(cursor, tableStart).trimEnd();
    output += `${output.endsWith('\n') || output.length === 0 ? '' : '\n'}${rows.join('\n')}`;
    cursor = rowCursor;
    separatorPattern.lastIndex = rowCursor;
  }

  const tail = text.slice(cursor);
  if (output && tail.trim()) {
    output += `\n${tail.trimStart()}`;
  } else {
    output += tail;
  }
  return output;
}

function splitQuestionTextAfterInlineList(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (!/^\s*[-*]\s+/.test(line)) return line;
      return line.replace(/(\.)\s+((?:If|Which|Determine|Find|Suppose|Let|For)\b.+)$/i, '$1\n\n$2');
    })
    .join('\n');
}

function normalizeInlineStructuralMarkdown(text: string): string {
  const normalizeProse = (value: string) => {
    let normalized = value;

    if (
      /\b(?:properties|conditions|axioms|assumptions|requirements)\s*:/i.test(normalized) &&
      /\([A-Z]\d+\)/.test(normalized)
    ) {
      normalized = normalized
        .replace(/\s+-\s+(?=\([A-Z]\d+\))/g, '\n')
        .replace(/(\b(?:properties|conditions|axioms|assumptions|requirements)\s*:)\s*/i, '$1\n')
        .replace(/\s*(\([A-Z]\d+\)\s+)/g, '\n- $1');
    }

    normalized = normalized.replace(
      /\s+(\((?:i|ii|iii|iv|v|vi|vii|viii|ix|x)\)\s*(?:(?:\(\d+\s+points?\)\s*)|(?=(?:Prove|Show|Find|Determine|Compute|Calculate|Explain|Give|Describe|Use|Let|Suppose|Define)\b)))/gi,
      '\n\n$1',
    );

    normalized = normalized.replace(/\s+(Hint\s*:)/gi, '\n\n$1');
    return normalized;
  };

  let normalized = text
    .split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g)
    .map((part) => (part.startsWith('$') ? part : normalizeProse(part)))
    .join('');

  if (/\|\s*:?-{3,}:?\s*\|/.test(normalized)) {
    normalized = normalizeInlinePipeTables(normalized);
  }

  if (
    /\b(?:Definitions?|included|We say|We define|defined?|conditions?|steps?)\b[^\n]*\s+-\s+/i.test(
      normalized,
    )
  ) {
    normalized = normalized.replace(/\s+-\s+(?=(?:\$\$)?(?:[A-Z0-9]|\([A-Za-z0-9]))/g, '\n- ');
    normalized = splitQuestionTextAfterInlineList(normalized);
  }

  return normalized
    .replace(/\n{3,}/g, '\n\n')
    .replace(/:\n\n-/g, ':\n-')
    .trim();
}

function inlineSimpleDisplayMath(text: string): string {
  return text.replace(/\$\$([^$\n]{1,120})\$\$/g, (match, latex: string) => {
    const trimmed = latex.trim();
    if (!trimmed || /\\begin|\\left|\\right|\n/.test(trimmed)) return match;
    return `$${trimmed}$`;
  });
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function isPipeTableRow(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.includes('|') && trimmed.split('|').filter((cell) => cell.trim()).length >= 2;
}

function splitTableRow(line: string): string[] {
  const trimmed = line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '');
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === '\\' && trimmed[index + 1] === '|') {
      // GFM escaped pipe: a literal "|" inside the cell.
      current += '|';
      index += 1;
      continue;
    }
    if (char === '`') inCode = !inCode;
    if (char === '$' && !inCode && trimmed[index - 1] !== '\\') {
      // Keep "$|x|$" in one cell, but "$100 | $200" is currency in two cells.
      const close = trimmed.indexOf('$', index + 1);
      const inner = close > index ? trimmed.slice(index + 1, close) : '';
      const currencyAcrossCells =
        /^\s*\d[\d,.]*\s*\|\s*$/.test(inner) && /\d/.test(trimmed[close + 1] ?? '');
      // Consume every complete math span, including "$0$" and "$b$".
      // Otherwise its closing dollar can pair with the next cell's opener
      // and swallow the real column separator between them.
      if (close > index && !currencyAcrossCells) {
        current += trimmed.slice(index, close + 1);
        index = close;
        continue;
      }
    }
    if (char === '|' && !inCode) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function renderTable(lines: string[]): string {
  const rows = lines.filter((line) => !isTableSeparator(line)).map(splitTableRow);
  const [header, ...bodyRows] = rows;
  if (!header || bodyRows.length === 0) {
    return `<p>${renderInlineMarkdown(lines.join('\n'))}</p>`;
  }

  const renderCells = (cells: string[], tag: 'td' | 'th') =>
    cells.map((cell) => `<${tag}>${renderInlineMarkdown(cell)}</${tag}>`).join('');

  return `<div class="problem-rich-table-wrap"><table><thead><tr>${renderCells(
    header,
    'th',
  )}</tr></thead><tbody>${bodyRows
    .map((row) => `<tr>${renderCells(row, 'td')}</tr>`)
    .join('')}</tbody></table></div>`;
}

const LIST_ITEM_PATTERN = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;

function isListItemLine(line: string): boolean {
  return LIST_ITEM_PATTERN.test(line);
}

function listIndentWidth(indent: string): number {
  return indent.replace(/\t/g, '    ').length;
}

type ListNode = {
  indent: number;
  ordered: boolean;
  start: number;
  text: string;
  children: ListNode[];
};

/**
 * Renders a run of Markdown list lines as nested <ul>/<ol>. Indentation creates
 * sub-lists, an ordered list keeps its first number (a list that starts at "3." must
 * not be shown as 1), and indented non-marker lines continue the previous item.
 */
function renderList(lines: string[]): string {
  const roots: ListNode[] = [];
  const stack: ListNode[] = [];
  for (const line of lines) {
    const match = line.match(LIST_ITEM_PATTERN);
    if (!match) {
      const last = stack.at(-1);
      if (last) last.text += `\n${line.trim()}`;
      continue;
    }
    const node: ListNode = {
      indent: listIndentWidth(match[1] ?? ''),
      ordered: !match[2],
      start: match[3] ? Number(match[3]) : 1,
      text: match[4] ?? '',
      children: [],
    };
    while (stack.length && stack.at(-1)!.indent >= node.indent) stack.pop();
    const parent = stack.at(-1);
    if (parent && node.indent >= parent.indent + 2) parent.children.push(node);
    else roots.push(node);
    stack.push(node);
  }

  const renderGroup = (nodes: ListNode[]): string => {
    let html = '';
    let index = 0;
    while (index < nodes.length) {
      const ordered = nodes[index].ordered;
      const group: ListNode[] = [];
      while (index < nodes.length && nodes[index].ordered === ordered) {
        group.push(nodes[index]);
        index += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered && group[0].start !== 1 ? ` start="${group[0].start}"` : '';
      html += `<${tag}${start}>${group
        .map(
          (node) =>
            `<li>${renderInlineMarkdown(node.text)}${
              node.children.length ? renderGroup(node.children) : ''
            }</li>`,
        )
        .join('')}</${tag}>`;
    }
    return html;
  };
  return renderGroup(roots);
}

function renderHeading(line: string): string | null {
  const match = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
  if (!match) return null;
  const level = Math.min(6, match[1].length);
  return `<h${level}>${renderInlineMarkdown(match[2])}</h${level}>`;
}

function isHorizontalRule(line: string): boolean {
  return /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);
}

function renderBlockquote(lines: string[]): string {
  const content = lines.map((line) => line.replace(/^\s*>\s?/, '')).join('\n');
  return `<blockquote>${renderInlineMarkdown(content)}</blockquote>`;
}

function normalizeCasesRows(body: string): string {
  return body
    .replace(/\${1,2}/g, '')
    .replace(/,\s*(\\{1,2})\s*(?=([^,&]+,\s*&))/g, (_match, _slashes, nextRow: string) => {
      const trimmedNextRow = nextRow.trim();
      const commandPrefix = /^(?:tan|sin|cos|log|ln|sqrt|frac|lim|int|sum|prod)\b/.test(
        trimmedNextRow,
      )
        ? '\\'
        : '';
      return `,\\\\\n${commandPrefix}`;
    })
    .replace(/\\{2,}\s*(?=[^,&]+,\s*&)/g, '\\\\\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function normalizeDisplayMathLatex(latex: string): string {
  if (!latex.includes('\\begin{cases}')) return latex;
  return latex.replace(
    /\\begin\{cases\}([\s\S]*?)\\end\{cases\}/g,
    (_match, body: string) => `\\begin{cases}\n${normalizeCasesRows(body)}\n\\end{cases}`,
  );
}

function renderCasesDisplayMath(latex: string): string | null {
  const match = latex.match(/^\s*([\s\S]*?)\\begin\{cases\}([\s\S]*?)\\end\{cases\}\s*$/);
  if (!match) return null;

  const lhs = match[1].trim();
  const rows = normalizeCasesRows(match[2])
    .split(/\\\\\s*/g)
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const [value, condition = ''] = row.split('&');
      return {
        value: value.trim().replace(/,\s*$/, ''),
        condition: condition.trim(),
      };
    });

  if (rows.length === 0) return null;

  const lhsHtml = lhs
    ? `<span class="problem-rich-cases-lhs">${escapeHtml(`$${lhs}$`)}</span>`
    : '';

  return `<div class="problem-rich-cases">${lhsHtml}<span class="problem-rich-cases-brace">{</span><span class="problem-rich-cases-rows">${rows
    .map(
      (row) =>
        `<span class="problem-rich-cases-row"><span>${escapeHtml(
          `$${row.value}$`,
        )}</span><span>${escapeHtml(row.condition ? `$${row.condition}$` : '')}</span></span>`,
    )
    .join('')}</span></div>`;
}

function isBracketDisplayMathStart(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === String.raw`\[` || trimmed === String.raw`\\[`;
}

function isBracketDisplayMathEnd(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === String.raw`\]` || trimmed === String.raw`\\]`;
}

function stripDisplayMathDelimiters(latex: string): string {
  return latex
    .replace(/^\s*\\{1,2}\[\s*/, '')
    .replace(/\s*\\{1,2}\]\s*$/, '')
    .replace(/\${2,}/g, '')
    .trim();
}

function renderDisplayMath(lines: string[]): string {
  const latex = normalizeDisplayMathLatex(stripDisplayMathDelimiters(lines.join('\n')));
  if (!latex) return '';

  const renderedMath = renderMathToHtml(latex, { displayMode: true });
  if (renderedMath.includes('data-syntara-math')) {
    return `<div class="problem-rich-display-math">${renderedMath}</div>`;
  }

  const casesHtml = renderCasesDisplayMath(latex);
  if (casesHtml) return casesHtml;

  return `<div class="problem-rich-display-math">${escapeHtml(`$$\n${latex}\n$$`)}</div>`;
}

function textToHtml(text: string): string {
  const fencedCode = protectFencedCodeBlocks(
    expandLegacyCodeTables(repairMalformedProblemMath(text)),
  );
  const normalized = restoreFencedCodeBlocks(
    inlineSimpleDisplayMath(normalizeInlineStructuralMarkdown(fencedCode.text)),
    fencedCode.blocks,
  );
  const lines = normalized.replace(/\r\n?/g, '\n').split('\n');
  const blocks: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const codeFence = parseCodeFenceStart(line);
    if (codeFence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !isCodeFenceEnd(lines[index], codeFence.marker)) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && isCodeFenceEnd(lines[index], codeFence.marker)) {
        index += 1;
      }
      blocks.push(renderCodeBlock(codeLines, codeFence.language));
      continue;
    }

    if (line.trim() === '$$' || isBracketDisplayMathStart(line)) {
      const endMatcher =
        line.trim() === '$$' ? (value: string) => value.trim() === '$$' : isBracketDisplayMathEnd;
      const mathLines: string[] = [];
      index += 1;
      while (index < lines.length && !endMatcher(lines[index])) {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length && endMatcher(lines[index])) {
        index += 1;
      }
      const displayMath = renderDisplayMath(mathLines);
      if (displayMath) blocks.push(displayMath);
      continue;
    }

    if (line.includes('\\begin{cases}') && !line.includes('\\end{cases}')) {
      const mathLines: string[] = [line];
      index += 1;
      while (index < lines.length && !lines[index].includes('\\end{cases}')) {
        mathLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        mathLines.push(lines[index]);
        index += 1;
      }
      const displayMath = renderDisplayMath(mathLines);
      if (displayMath) blocks.push(displayMath);
      continue;
    }

    const heading = renderHeading(line);
    if (heading) {
      blocks.push(heading);
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push('<hr/>');
      index += 1;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderBlockquote(quoteLines));
      continue;
    }

    if (isPipeTableRow(line) && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const tableLines: string[] = [];
      while (index < lines.length && lines[index].trim() && isPipeTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderTable(tableLines));
      continue;
    }

    if (isListItemLine(line)) {
      const listLines: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        if (isListItemLine(current)) {
          listLines.push(current);
          index += 1;
          continue;
        }
        // An indented, non-empty line directly after an item continues that item.
        if (current.trim() && /^\s{2,}\S/.test(current) && !parseCodeFenceStart(current)) {
          listLines.push(current);
          index += 1;
          continue;
        }
        // A blank line followed by an indented item keeps a loose nested list together.
        if (
          !current.trim() &&
          lines[index + 1] &&
          /^\s{2,}/.test(lines[index + 1]) &&
          isListItemLine(lines[index + 1])
        ) {
          index += 1;
          continue;
        }
        break;
      }
      blocks.push(renderList(listLines));
      continue;
    }

    const paragraphLines: string[] = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !parseCodeFenceStart(lines[index]) &&
      lines[index].trim() !== '$$' &&
      !isBracketDisplayMathStart(lines[index]) &&
      !(lines[index].includes('\\begin{cases}') && !lines[index].includes('\\end{cases}')) &&
      !renderHeading(lines[index]) &&
      !isHorizontalRule(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !(isPipeTableRow(lines[index]) && lines[index + 1] && isTableSeparator(lines[index + 1])) &&
      !isListItemLine(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join('\n'))}</p>`);
  }

  const html = blocks.join('');
  return renderHtmlWithLatex(html);
}

export function renderProblemRichTextHtml(content: string): string {
  return content.trim() ? textToHtml(content) : '';
}

export const ProblemRichText = memo(function ProblemRichText({
  content,
  className,
}: {
  content?: string;
  className?: string;
}) {
  const html = useMemo(
    () => (content?.trim() ? renderProblemRichTextHtml(content) : ''),
    [content],
  );
  if (!html) return null;
  return (
    <div
      className={cn(
        'prose prose-slate min-w-0 max-w-full text-sm leading-7 dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-0 [&_.katex-display]:my-3',
        '[&_.math-engine-inline]:inline-block [&_.math-engine-inline]:max-w-full [&_.math-engine-inline]:overflow-x-auto [&_.math-engine-inline]:py-1 [&_.math-engine-inline]:align-middle [&_.math-engine-display]:max-w-full [&_.math-engine-display]:overflow-x-auto [&_.math-engine-display]:py-1 [&_.katex-display>.katex]:min-w-max',
        '[&_.problem-rich-display-math]:my-3 [&_.problem-rich-display-math]:overflow-x-auto',
        '[&_.problem-rich-cases]:my-3 [&_.problem-rich-cases]:flex [&_.problem-rich-cases]:items-center [&_.problem-rich-cases]:justify-center [&_.problem-rich-cases]:gap-2 [&_.problem-rich-cases]:overflow-x-auto',
        '[&_.problem-rich-cases-lhs]:whitespace-nowrap [&_.problem-rich-cases-brace]:text-5xl [&_.problem-rich-cases-brace]:font-light [&_.problem-rich-cases-brace]:leading-none',
        '[&_.problem-rich-cases-rows]:grid [&_.problem-rich-cases-rows]:gap-1 [&_.problem-rich-cases-row]:grid [&_.problem-rich-cases-row]:grid-cols-[auto_auto] [&_.problem-rich-cases-row]:gap-3 [&_.problem-rich-cases-row]:whitespace-nowrap',
        '[&_.problem-rich-table-wrap]:my-3 [&_.problem-rich-table-wrap]:overflow-x-auto [&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_td]:border [&_td]:border-slate-200 [&_td]:px-3 [&_td]:py-2 [&_td]:align-top [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold [&_th]:text-slate-900',
        '[&_.problem-rich-code-block]:my-3 [&_.problem-rich-code-block]:overflow-x-auto [&_.problem-rich-code-block]:rounded-lg [&_.problem-rich-code-block]:border [&_.problem-rich-code-block]:border-slate-200 [&_.problem-rich-code-block]:bg-white [&_.problem-rich-code-block]:p-4 [&_.problem-rich-code-block]:font-mono [&_.problem-rich-code-block]:text-[13px] [&_.problem-rich-code-block]:leading-6 [&_.problem-rich-code-block]:text-slate-900 [&_.problem-rich-code-block]:shadow-sm dark:[&_.problem-rich-code-block]:border-slate-700 dark:[&_.problem-rich-code-block]:bg-white dark:[&_.problem-rich-code-block]:text-slate-900',
        '[&_.problem-rich-code-token-builtin]:text-sky-700 [&_.problem-rich-code-token-comment]:text-slate-500 [&_.problem-rich-code-token-keyword]:font-semibold [&_.problem-rich-code-token-keyword]:text-violet-700 [&_.problem-rich-code-token-literal]:font-semibold [&_.problem-rich-code-token-literal]:text-rose-700 [&_.problem-rich-code-token-number]:text-amber-700 [&_.problem-rich-code-token-string]:text-emerald-700',
        '[&_.problem-rich-inline-code]:rounded [&_.problem-rich-inline-code]:border [&_.problem-rich-inline-code]:border-slate-200 [&_.problem-rich-inline-code]:bg-slate-100 [&_.problem-rich-inline-code]:px-1.5 [&_.problem-rich-inline-code]:py-0.5 [&_.problem-rich-inline-code]:font-mono [&_.problem-rich-inline-code]:text-[0.9em] [&_.problem-rich-inline-code]:font-medium [&_.problem-rich-inline-code]:text-slate-950 dark:[&_.problem-rich-inline-code]:border-slate-700 dark:[&_.problem-rich-inline-code]:bg-slate-800 dark:[&_.problem-rich-inline-code]:text-slate-100',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-5 [&_li]:my-1 [&_li]:pl-1',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

export function problemImageAssetsFromContent(
  content?: Pick<NotebookProblemPublicContent, 'assets'> | null,
): NotebookProblemImageAsset[] {
  return (content?.assets?.images || []).filter((image) => image.src?.trim());
}

export function ProblemImageAssets({
  content,
  images,
  className,
  locale = 'zh-CN',
}: {
  content?: Pick<NotebookProblemPublicContent, 'assets'> | null;
  images?: NotebookProblemImageAsset[];
  className?: string;
  locale?: 'zh-CN' | 'en-US';
}) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const resolvedImages = (images || problemImageAssetsFromContent(content)).filter((image) =>
    image.src?.trim(),
  );
  const preview = resolvedImages.find((image) => image.src === previewSrc);
  const label = (image: NotebookProblemImageAsset, index: number) =>
    image.caption ||
    image.alt ||
    (locale === 'zh-CN' ? `题图 ${index + 1}` : `Figure ${index + 1}`);
  if (!resolvedImages.length) return null;

  return (
    <>
      <div className={cn('mt-4 flex flex-wrap gap-2.5', className)}>
        {resolvedImages.map((image, index) => (
          <figure
            key={image.id}
            className="group w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60"
          >
            <button
              type="button"
              onClick={() => setPreviewSrc(image.src)}
              aria-label={
                locale === 'zh-CN'
                  ? `放大查看 ${label(image, index)}`
                  : `Enlarge ${label(image, index)}`
              }
              className="flex w-full items-center justify-center overflow-hidden bg-white p-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-500 dark:bg-slate-950"
            >
              <img
                src={image.src}
                alt={image.alt || label(image, index)}
                width={image.width || undefined}
                height={image.height || undefined}
                loading="lazy"
                decoding="async"
                className="h-auto max-h-[65dvh] w-full object-contain"
              />
            </button>
            <figcaption className="flex items-center gap-1.5 px-2 py-1.5 text-[11px] text-slate-600 dark:text-slate-300">
              <FileImage className="size-3 shrink-0 text-slate-400" aria-hidden="true" />
              <span className="min-w-0 flex-1 break-words" title={label(image, index)}>
                {label(image, index)}
              </span>
              <Eye className="size-3 shrink-0 text-slate-400" aria-hidden="true" />
            </figcaption>
          </figure>
        ))}
      </div>
      <Dialog open={Boolean(preview)} onOpenChange={(open) => !open && setPreviewSrc(null)}>
        <DialogContent className="flex max-h-[92dvh] w-[min(94vw,1100px)] max-w-none flex-col overflow-hidden p-0">
          <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-14 dark:border-slate-700">
            <DialogTitle>
              {preview ? label(preview, resolvedImages.indexOf(preview)) : ''}
            </DialogTitle>
            <DialogDescription>
              {locale === 'zh-CN'
                ? '查看题图，可滚动查看完整内容或保存图片。'
                : 'View the full figure, scroll, or save the image.'}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto bg-slate-100 p-4 dark:bg-slate-950">
            {preview ? (
              <img
                src={preview.src}
                alt={preview.alt || label(preview, resolvedImages.indexOf(preview))}
                className="mx-auto h-auto max-w-full rounded-lg bg-white"
              />
            ) : null}
          </div>
          <DialogFooter className="border-t border-slate-200 px-5 py-3 dark:border-slate-700">
            {preview ? (
              <Button asChild>
                <a href={preview.src} download>
                  <Download className="mr-1.5 size-4" />
                  {locale === 'zh-CN' ? '保存图片' : 'Save image'}
                </a>
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export const ProblemTitleText = memo(function ProblemTitleText({
  content,
  className,
  forceInlineMath = false,
}: {
  content?: string;
  className?: string;
  forceInlineMath?: boolean;
}) {
  const html = useMemo(
    () =>
      content?.trim()
        ? forceInlineMath
          ? renderTextWithMathToHtml(content, { forceInline: true, rawFallback: true }) || ''
          : renderPlainTitleWithOptionalLatex(content)
        : '',
    [content, forceInlineMath],
  );
  if (!html) return null;
  return (
    <span
      className={cn(
        'inline [&_.katex]:text-[1em] [&_.katex]:leading-none [&_.math-engine-inline]:align-baseline',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
