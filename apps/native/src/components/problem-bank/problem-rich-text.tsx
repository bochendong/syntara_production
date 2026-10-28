import { memo, useMemo } from 'react';
import { ZoomableProblemImage } from '../../../../../lib/problem-bank/zoomable-problem-image';
import {
  renderHtmlWithLatex,
  renderPlainTitleWithOptionalLatex,
} from '../../lib/render-html-with-latex';
import { renderMathToHtml, renderTextWithMathToHtml } from '../../lib/math-engine';
import type { NotebookProblemImageAsset, NotebookProblemPublicContent } from './types';
import { cn } from '../../lib/cn';
import {
  protectProblemMath,
  repairProblemProseMath,
} from '../../../../../lib/problem-bank/problem-prose-math';

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
  return (
    escapeHtml(text)
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      // `__init__`、`__len__` 这类 Python 名字不是粗体。
      .replace(/__([^_\n]+)__/g, (match, inner: string) =>
        /^[A-Za-z][A-Za-z0-9_]*$/.test(inner) ? match : `<strong>${inner}</strong>`,
      )
      .replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
      .replace(/(^|[\s（(])\*([^*\n]+)\*(?=$|[\s，。！？；、,.!?)）])/g, '$1<em>$2</em>')
      .replace(/(^|[\s（(])_([^_\n]+)_(?=$|[\s，。！？；、,.!?)）])/g, '$1<em>$2</em>')
      .replace(/\n/g, '<br/>')
  );
}

const INLINE_TOKEN = /@@SYNINLINE(\d+)@@/g;

function safeHref(url: string): string | null {
  return /^(?:https?:\/\/|mailto:)/i.test(url) ? url : null;
}

function renderLink(label: string, url: string): string {
  return `<a class="problem-rich-link" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

/**
 * 行内 Markdown：先把 `代码`、[文字](链接)、裸链接换成占位符，再处理加粗/斜体，
 * 这样 **加粗里有 `code`** 也能成对匹配，链接里的 / 和 _ 不会被当成斜体或公式。
 */
function renderInlineMarkdown(text: string): string {
  const pieces: string[] = [];
  const hold = (html: string) => `@@SYNINLINE${pieces.push(html) - 1}@@`;

  let held = '';
  let cursor = 0;
  while (cursor < text.length) {
    const tickStart = text.indexOf('`', cursor);
    if (tickStart === -1) {
      held += text.slice(cursor);
      break;
    }
    held += text.slice(cursor, tickStart);
    const tickEnd = text.indexOf('`', tickStart + 1);
    if (tickEnd === -1) {
      held += hold('&#96;');
      cursor = tickStart + 1;
      continue;
    }
    held += hold(
      `<code class="problem-rich-inline-code">${escapeHtml(text.slice(tickStart + 1, tickEnd))}</code>`,
    );
    cursor = tickEnd + 1;
  }

  held = held
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
      const href = safeHref(url);
      return href ? hold(renderLink(renderInlineFormatting(label), href)) : match;
    })
    .replace(
      /(^|[^"'(=\w])(https?:\/\/[^\s<>()（）\u4e00-\u9fff，。、；！？]+[^\s<>()（）\u4e00-\u9fff，。、；！？.,;:!?'"])/g,
      (_match, before: string, url: string) => `${before}${hold(renderLink(escapeHtml(url), url))}`,
    );

  return renderInlineFormatting(held).replace(
    INLINE_TOKEN,
    (_match, index: string) => pieces[Number(index)],
  );
}

const DOCTEST_PROMPT = /^\s*>>>(?:\s|$)/;

function dedentLines(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim())
    .map((line) => line.match(/^[ \t]*/)?.[0].length ?? 0);
  const indent = indents.length ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(indent));
}

/**
 * 题目里直接写的 Python 交互示例（`>>> ...` 加输出行，多半是从 docstring 抽出来的）
 * 原样当成 markdown 会被吃掉一个 `>` 变成引用，`a = B(...)` 还会被认成公式。
 * 这里在别的规则之前把它们包成 python 代码块；紧跟着又有一份一模一样的代码块时只留那一份。
 */
function fenceDoctestBlocks(text: string): string {
  if (!text.includes('>>>')) return text;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  let fence: CodeFenceInfo | null = null;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (fence) {
      output.push(line);
      if (isCodeFenceEnd(line, fence.marker)) fence = null;
      index += 1;
      continue;
    }
    const fenceStart = parseCodeFenceStart(line);
    if (fenceStart) {
      fence = fenceStart;
      output.push(line);
      index += 1;
      continue;
    }
    if (!DOCTEST_PROMPT.test(line)) {
      output.push(line);
      index += 1;
      continue;
    }

    // 一段交互示例：从 >>> 开始，带上后面的输出行；空行后如果还是 >>> 就接着算同一段。
    const block: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      if (current.trim()) {
        if (parseCodeFenceStart(current)) break;
        block.push(current);
        index += 1;
        continue;
      }
      let next = index;
      while (next < lines.length && !lines[next].trim()) next += 1;
      if (next < lines.length && DOCTEST_PROMPT.test(lines[next])) {
        index = next;
        continue;
      }
      break;
    }
    const code = dedentLines(block);

    let next = index;
    while (next < lines.length && !lines[next].trim()) next += 1;
    const nextFence = next < lines.length ? parseCodeFenceStart(lines[next]) : null;
    if (nextFence) {
      const fenced: string[] = [];
      for (let cursor = next + 1; cursor < lines.length; cursor += 1) {
        if (isCodeFenceEnd(lines[cursor], nextFence.marker)) break;
        fenced.push(lines[cursor]);
      }
      const squash = (value: string[]) =>
        value
          .map((item) => item.trim())
          .filter(Boolean)
          .join('\n');
      if (squash(dedentLines(fenced)).includes(squash(code))) continue;
    }

    if (output.length && output[output.length - 1].trim()) output.push('');
    output.push('```python', ...code, '```', '');
  }

  return output.join('\n');
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

    const token = `@@OPENMAIC_FENCED_CODE_${blocks.length}@@`;
    blocks.push(blockLines.join('\n'));
    output.push(token);
  }

  return { text: output.join('\n'), blocks };
}

function restoreFencedCodeBlocks(text: string, blocks: string[]): string {
  return blocks.reduce(
    (current, block, index) => current.replaceAll(`@@OPENMAIC_FENCED_CODE_${index}@@`, block),
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
    const separatorLineStart = text.lastIndexOf('\n', separatorStart - 1) + 1;
    if (!text.slice(separatorLineStart, separatorStart).trim()) continue;
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

const ENUM_MARKER =
  /(^|[\s:：;；,，.。])\(((?:i|ii|iii|iv|v|vi|vii|viii|ix|x)|\d{1,2}|[a-h])\)\s+/g;
const ROMAN = ['i', 'ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x'];

function enumerationIndex(marker: string, kind: 'roman' | 'number' | 'letter'): number {
  if (kind === 'roman') return ROMAN.indexOf(marker);
  if (kind === 'number') return Number(marker) - 1;
  return marker.charCodeAt(0) - 97;
}

/**
 * 「(1) … (2) … (3) …」「(i) Left-Total (ii) Symmetric …」挤在一段里时拆成一行一条。
 * 只在编号从 1 / i / a 开始、按顺序连着出现至少两次时才拆，`f(1)` 这种不动。
 */
function splitInlineEnumeration(text: string): string {
  const markers = [...text.matchAll(ENUM_MARKER)];
  if (markers.length < 2) return text;
  const first = markers[0][2].toLowerCase();
  const kind =
    first === 'i' ? 'roman' : /^\d/.test(first) ? 'number' : first === 'a' ? 'letter' : null;
  if (!kind || enumerationIndex(first, kind) !== 0) return text;
  const picked: RegExpMatchArray[] = [];
  for (const match of markers) {
    const marker = match[2].toLowerCase();
    if (enumerationIndex(marker, kind) === picked.length) picked.push(match);
  }
  if (picked.length < 2) return text;
  let output = '';
  let cursor = 0;
  for (const match of picked) {
    const start = (match.index ?? 0) + match[1].length;
    output += `${text.slice(cursor, start).trimEnd()}\n- `;
    cursor = start;
  }
  return output + text.slice(cursor);
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

    if (normalized === value) normalized = splitInlineEnumeration(normalized);
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
  return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
}

function isPipeTableRow(line: string): boolean {
  const trimmed = line.trim();
  return (
    (trimmed.startsWith('|') && trimmed.endsWith('|')) ||
    (trimmed.includes('|') && trimmed.split('|').filter((cell) => cell.trim()).length >= 2)
  );
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((cell) => cell.trim());
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

const LIST_ITEM = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;

function isListItem(line: string): boolean {
  return LIST_ITEM.test(line);
}

interface ListNode {
  ordered: boolean;
  start: number;
  text: string;
  indent: number;
  children: ListNode[];
}

/** 列表块：按缩进套出嵌套列表，有序列表沿用模型写的起始编号（中间隔了空行也不会都变成 1.）。 */
function renderList(lines: string[]): string {
  const roots: ListNode[] = [];
  const stack: ListNode[] = [];
  for (const line of lines) {
    const match = line.match(LIST_ITEM);
    if (!match) continue;
    const node: ListNode = {
      ordered: /\d/.test(match[2]),
      start: Number.parseInt(match[2], 10) || 1,
      text: match[3],
      indent: match[1].replace(/\t/g, '    ').length,
      children: [],
    };
    while (stack.length && stack[stack.length - 1].indent >= node.indent) stack.pop();
    // 至少缩进 2 格才算子项，避免 1 格的随手缩进把列表拆碎。
    const parent = stack[stack.length - 1];
    if (parent && node.indent - parent.indent >= 2) parent.children.push(node);
    else {
      while (stack.length) stack.pop();
      roots.push(node);
    }
    stack.push(node);
  }

  const renderGroup = (nodes: ListNode[]): string => {
    let html = '';
    let index = 0;
    while (index < nodes.length) {
      const ordered = nodes[index].ordered;
      const tag = ordered ? 'ol' : 'ul';
      const start = ordered && nodes[index].start !== 1 ? ` start="${nodes[index].start}"` : '';
      let items = '';
      while (index < nodes.length && nodes[index].ordered === ordered) {
        const node = nodes[index];
        items += `<li>${renderInlineMarkdown(node.text)}${node.children.length ? renderGroup(node.children) : ''}</li>`;
        index += 1;
      }
      html += `<${tag}${start}>${items}</${tag}>`;
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
  const fencedCode = protectFencedCodeBlocks(repairProblemProseMath(fenceDoctestBlocks(text)));
  const protectedMath = protectProblemMath(fencedCode.text, (source) => {
    const display = source.startsWith('$$') || source.startsWith('\\[');
    const width = source.startsWith('\\') || display ? 2 : 1;
    return renderMathToHtml(source.slice(width, -width), { displayMode: display });
  });
  const normalized = restoreFencedCodeBlocks(
    inlineSimpleDisplayMath(normalizeInlineStructuralMarkdown(protectedMath.text)),
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

    if (line.includes('\\begin{cases}')) {
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

    if (isListItem(line)) {
      const listLines: string[] = [];
      while (index < lines.length && isListItem(lines[index])) {
        listLines.push(lines[index]);
        index += 1;
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
      !lines[index].includes('\\begin{cases}') &&
      !renderHeading(lines[index]) &&
      !isHorizontalRule(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !(isPipeTableRow(lines[index]) && lines[index + 1] && isTableSeparator(lines[index + 1])) &&
      !isListItem(lines[index])
    ) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${renderInlineMarkdown(paragraphLines.join('\n'))}</p>`);
  }

  const html = blocks.join('');
  return protectedMath.restore(renderHtmlWithLatex(html));
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
        'prose prose-slate max-w-none text-sm leading-7 dark:prose-invert [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-0 [&_.katex-display]:my-3',
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
}: {
  content?:
    | (Pick<NotebookProblemPublicContent, 'assets'> & { blankLayout?: 'inline' | 'figure' })
    | null;
  images?: NotebookProblemImageAsset[];
  className?: string;
}) {
  const resolvedImages = images || problemImageAssetsFromContent(content);
  if (!resolvedImages.length) return null;

  return (
    <div
      className={cn(
        'problem-image-gallery',
        content?.blankLayout === 'figure' && 'is-figure',
        className,
      )}
    >
      {resolvedImages.map((image) => (
        <figure
          key={image.id}
          className="problem-image-thumbnail-frame overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-900/60"
        >
          <ZoomableProblemImage image={image} />
        </figure>
      ))}
    </div>
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
