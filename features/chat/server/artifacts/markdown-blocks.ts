/**
 * Small Markdown parser shared by the chat document renderers (DOCX and PDF).
 *
 * It intentionally supports only the subset the course assistant is asked to
 * write: headings, paragraphs with emphasis/code/links/math, one level of
 * nested lists, GFM tables, fenced code, rules, blockquotes, display math,
 * images that reference chat assets or data URLs, and explicit page breaks.
 */

export type InlineNode =
  | {
      type: 'text';
      text: string;
      bold?: boolean;
      italic?: boolean;
      strike?: boolean;
      code?: boolean;
      link?: string;
    }
  | { type: 'math'; latex: string; bold?: boolean; italic?: boolean }
  | { type: 'break' };

export type MarkdownImageSource =
  | { kind: 'asset'; assetId: string }
  | { kind: 'data'; mimeType: string; base64: string }
  | { kind: 'url'; url: string };

export type MarkdownListItem = {
  inlines: InlineNode[];
  /** One nested level; deeper nesting is flattened into this level. */
  children?: MarkdownList;
};

export type MarkdownList = {
  ordered: boolean;
  start: number;
  items: MarkdownListItem[];
};

export type TableAlign = 'left' | 'center' | 'right' | null;

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; inlines: InlineNode[] }
  | { type: 'paragraph'; inlines: InlineNode[] }
  | ({ type: 'list' } & MarkdownList)
  | { type: 'table'; align: TableAlign[]; header: InlineNode[][]; rows: InlineNode[][][] }
  | { type: 'code'; language?: string; text: string }
  | { type: 'hr' }
  | { type: 'blockquote'; blocks: MarkdownBlock[] }
  | { type: 'math'; latex: string }
  | { type: 'image'; alt: string; source: MarkdownImageSource }
  | { type: 'pagebreak' };

export type ChatDocumentImage = {
  buffer: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
};

/** Images that `![alt](asset:{id})` blocks resolve to, keyed by asset id. */
export type ChatDocumentImages = Record<string, ChatDocumentImage>;

const PAGEBREAK_RE =
  /^\s*(?:<!--\s*page-?break\s*-->|\\newpage|\\pagebreak|<div[^>]*page-break-(?:after|before)[^>]*>\s*<\/div>)\s*$/i;
const HR_RE = /^\s{0,3}(?:(?:-\s*){3,}|(?:\*\s*){3,}|(?:_\s*){3,})$/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)\s*$/;
const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const TABLE_SEPARATOR_RE = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const IMAGE_LINE_RE = /^\s*!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)\s*$/;
const HTML_COMMENT_RE = /^\s*<!--[\s\S]*?-->\s*$/;

export function parseImageSource(target: string): MarkdownImageSource | null {
  const value = target.trim();
  const asset = /^asset:([A-Za-z0-9_-]{6,80})$/.exec(value);
  if (asset) return { kind: 'asset', assetId: asset[1] };
  const data = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/.exec(value);
  if (data) return { kind: 'data', mimeType: data[1].toLowerCase(), base64: data[2] };
  if (/^https?:\/\//i.test(value)) return { kind: 'url', url: value };
  return null;
}

function isBlank(line: string): boolean {
  return line.trim() === '';
}

function isTableRowCandidate(line: string): boolean {
  return line.includes('|');
}

/** Split a GFM table row on pipes that are not escaped or inside code/math. */
export function splitTableRow(line: string): string[] {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells: string[] = [];
  let current = '';
  let inCode = false;
  let inMath = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\' && index + 1 < text.length) {
      const next = text[index + 1];
      if (next === '|' && !inMath) {
        current += '|';
      } else {
        current += char + next;
      }
      index += 1;
      continue;
    }
    if (char === '`' && !inMath) inCode = !inCode;
    else if (char === '$' && !inCode) inMath = !inMath;
    if (char === '|' && !inCode && !inMath) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function parseAlign(cell: string): TableAlign {
  const value = cell.trim();
  const left = value.startsWith(':');
  const right = value.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function startsBlock(line: string, nextLine: string | undefined): boolean {
  return (
    PAGEBREAK_RE.test(line) ||
    HEADING_RE.test(line) ||
    FENCE_RE.test(line) ||
    HR_RE.test(line) ||
    LIST_RE.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*(?:\$\$|\\\[)/.test(line) ||
    IMAGE_LINE_RE.test(line) ||
    (isTableRowCandidate(line) && nextLine !== undefined && TABLE_SEPARATOR_RE.test(nextLine))
  );
}

/** Parse block-level Markdown into a typed AST. */
export function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n');
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      index += 1;
      continue;
    }

    if (PAGEBREAK_RE.test(line)) {
      blocks.push({ type: 'pagebreak' });
      index += 1;
      continue;
    }

    if (HTML_COMMENT_RE.test(line)) {
      index += 1;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1];
      const language = fence[2] || undefined;
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith(marker)) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence (or end of input)
      const text = body.join('\n');
      if (language && /^(?:math|latex|tex|katex)$/i.test(language)) {
        if (text.trim()) blocks.push({ type: 'math', latex: text.trim() });
      } else {
        blocks.push({ type: 'code', language, text });
      }
      continue;
    }

    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = Math.min(3, heading[1].length) as 1 | 2 | 3;
      blocks.push({ type: 'heading', level, inlines: parseInlines(heading[2]) });
      index += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    // Display math: $$ ... $$ or \[ ... \] (single or multi-line).
    const mathOpen = /^\s*(\$\$|\\\[)(.*)$/.exec(line);
    if (mathOpen) {
      const close = mathOpen[1] === '$$' ? '$$' : '\\]';
      let rest = mathOpen[2];
      const collected: string[] = [];
      let closed = false;
      let trailing = '';
      for (;;) {
        const closeAt = rest.indexOf(close);
        if (closeAt >= 0) {
          collected.push(rest.slice(0, closeAt));
          trailing = rest.slice(closeAt + close.length).trim();
          closed = true;
          break;
        }
        collected.push(rest);
        index += 1;
        if (index >= lines.length) break;
        rest = lines[index];
      }
      index += 1;
      const latex = collected.join('\n').trim();
      if (latex) blocks.push({ type: 'math', latex });
      if (closed && trailing) blocks.push({ type: 'paragraph', inlines: parseInlines(trailing) });
      continue;
    }

    const image = IMAGE_LINE_RE.exec(line);
    if (image) {
      const source = parseImageSource(image[2]);
      if (source) {
        blocks.push({ type: 'image', alt: image[1].trim(), source });
        index += 1;
        continue;
      }
    }

    if (/^\s*>/.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoted.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'blockquote', blocks: parseMarkdownBlocks(quoted.join('\n')) });
      continue;
    }

    if (
      isTableRowCandidate(line) &&
      index + 1 < lines.length &&
      TABLE_SEPARATOR_RE.test(lines[index + 1])
    ) {
      const headerCells = splitTableRow(line);
      const align = splitTableRow(lines[index + 1]).map(parseAlign);
      const columnCount = Math.max(headerCells.length, 1);
      index += 2;
      const rows: InlineNode[][][] = [];
      while (index < lines.length && !isBlank(lines[index]) && isTableRowCandidate(lines[index])) {
        const cells = splitTableRow(lines[index]);
        const normalized = Array.from({ length: columnCount }, (_, column) =>
          parseInlines(cells[column] ?? ''),
        );
        rows.push(normalized);
        index += 1;
      }
      blocks.push({
        type: 'table',
        align: Array.from({ length: columnCount }, (_, column) => align[column] ?? null),
        header: headerCells.map((cell) => parseInlines(cell)),
        rows,
      });
      continue;
    }

    if (LIST_RE.test(line)) {
      const parsed = parseList(lines, index);
      blocks.push({ type: 'list', ...parsed.list });
      index = parsed.nextIndex;
      continue;
    }

    // Paragraph: consume until a blank line or another block starts.
    const paragraph: string[] = [line];
    index += 1;
    while (
      index < lines.length &&
      !isBlank(lines[index]) &&
      !startsBlock(lines[index], lines[index + 1])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: 'paragraph', inlines: parseParagraphLines(paragraph) });
  }

  return blocks;
}

/** Join paragraph lines; a trailing double space or backslash is a hard break. */
function parseParagraphLines(lines: string[]): InlineNode[] {
  const nodes: InlineNode[] = [];
  lines.forEach((raw, lineIndex) => {
    const hardBreak = / {2,}$/.test(raw) || /(?<!\\)\\$/.test(raw);
    const text = raw
      .replace(/ {2,}$/, '')
      .replace(/(?<!\\)\\$/, '')
      .trim();
    nodes.push(...parseInlines(text));
    if (lineIndex < lines.length - 1) {
      nodes.push(hardBreak ? { type: 'break' } : { type: 'text', text: ' ' });
    }
  });
  return mergeTextNodes(nodes);
}

function parseList(lines: string[], startIndex: number): { list: MarkdownList; nextIndex: number } {
  const first = LIST_RE.exec(lines[startIndex])!;
  const baseIndent = first[1].length;
  const ordered = /\d/.test(first[2]);
  const list: MarkdownList = {
    ordered,
    start: ordered ? Number.parseInt(first[2], 10) || 1 : 1,
    items: [],
  };
  let index = startIndex;
  let currentText: string[] | null = null;
  let current: MarkdownListItem | null = null;
  let childTexts: string[] | null = null;
  let child: MarkdownList | null = null;

  const flushChild = () => {
    if (child && childTexts) {
      child.items.push({ inlines: parseParagraphLines(childTexts) });
    }
    childTexts = null;
  };
  const flushItem = () => {
    flushChild();
    if (current && currentText) {
      current.inlines = parseParagraphLines(currentText);
      if (child && child.items.length) current.children = child;
      list.items.push(current);
    }
    current = null;
    currentText = null;
    child = null;
  };

  while (index < lines.length) {
    const line = lines[index];
    if (isBlank(line)) {
      // A blank line ends the list unless the next line continues it.
      const next = lines[index + 1];
      const nextMatch = next !== undefined ? LIST_RE.exec(next) : null;
      if (nextMatch && nextMatch[1].length >= baseIndent) {
        index += 1;
        continue;
      }
      if (next !== undefined && /^\s{2,}\S/.test(next) && !startsBlock(next.trim(), undefined)) {
        index += 1;
        continue;
      }
      break;
    }
    const match = LIST_RE.exec(line);
    if (match) {
      const indent = match[1].length;
      if (indent < baseIndent) break;
      const markerOrdered = /\d/.test(match[2]);
      if (indent <= baseIndent + 1) {
        if (markerOrdered !== ordered && current) break; // different list type at same level
        flushItem();
        current = { inlines: [] };
        currentText = [match[3]];
      } else {
        if (!current) {
          current = { inlines: [] };
          currentText = [''];
        }
        flushChild();
        if (!child) {
          child = {
            ordered: markerOrdered,
            start: markerOrdered ? Number.parseInt(match[2], 10) || 1 : 1,
            items: [],
          };
        }
        childTexts = [match[3]];
      }
      index += 1;
      continue;
    }
    // Continuation line (lazy or indented) of the current item.
    if (!current || (startsBlock(line, lines[index + 1]) && !/^\s{2,}/.test(line))) break;
    if (childTexts) (childTexts as string[]).push(line.trim());
    else (currentText as string[] | null)?.push(line.trim());
    index += 1;
  }
  flushItem();
  return { list, nextIndex: index };
}

function mergeTextNodes(nodes: InlineNode[]): InlineNode[] {
  const merged: InlineNode[] = [];
  for (const node of nodes) {
    const last = merged[merged.length - 1];
    if (
      node.type === 'text' &&
      last?.type === 'text' &&
      !!last.bold === !!node.bold &&
      !!last.italic === !!node.italic &&
      !!last.strike === !!node.strike &&
      !!last.code === !!node.code &&
      last.link === node.link
    ) {
      last.text += node.text;
    } else if (node.type !== 'text' || node.text) {
      merged.push(node.type === 'text' ? { ...node } : node);
    }
  }
  return merged;
}

type InlineStyle = { bold?: boolean; italic?: boolean; strike?: boolean; link?: string };

const ESCAPABLE = '\\`*_{}[]()#+-.!|$~<>';

function isWordChar(char: string | undefined): boolean {
  return !!char && /[\p{L}\p{N}]/u.test(char);
}

/** Find the closing `$` of inline math that opened at `start` (pointing at `$`). */
function findInlineMathEnd(text: string, start: number): number {
  const after = text[start + 1];
  if (!after || /\s/.test(after) || after === '$') return -1;
  for (let index = start + 1; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\') {
      index += 1;
      continue;
    }
    if (char === '$') {
      if (/\s/.test(text[index - 1])) return -1;
      if (/\d/.test(text[index + 1] ?? '')) return -1; // "$5 and $10" is currency
      return index;
    }
  }
  return -1;
}

function findClosing(text: string, start: number, marker: string): number {
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1;
      continue;
    }
    if (text[index] === '`') {
      const end = text.indexOf('`', index + 1);
      if (end > 0) index = end;
      continue;
    }
    if (text.startsWith(marker, index)) {
      if (marker.length === 1 && text[index + 1] === marker) {
        index += 1;
        continue;
      }
      if (/\s/.test(text[index - 1] ?? '')) continue;
      if (marker.startsWith('_') && isWordChar(text[index + marker.length])) continue;
      return index;
    }
  }
  return -1;
}

/** Parse inline Markdown (emphasis, code, links, inline math, <br>). */
export function parseInlines(source: string, style: InlineStyle = {}): InlineNode[] {
  const nodes: InlineNode[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) nodes.push({ type: 'text', text: buffer, ...style });
    buffer = '';
  };
  const text = source;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '\\' && next === '(') {
      const end = text.indexOf('\\)', index + 2);
      if (end > 0) {
        flush();
        nodes.push({
          type: 'math',
          latex: text.slice(index + 2, end).trim(),
          bold: style.bold,
          italic: style.italic,
        });
        index = end + 2;
        continue;
      }
    }
    if (char === '\\' && next && ESCAPABLE.includes(next)) {
      buffer += next;
      index += 2;
      continue;
    }
    if (char === '$') {
      if (next === '$') {
        const end = text.indexOf('$$', index + 2);
        if (end > index + 2) {
          flush();
          nodes.push({ type: 'math', latex: text.slice(index + 2, end).trim(), bold: style.bold });
          index = end + 2;
          continue;
        }
      } else {
        const end = findInlineMathEnd(text, index);
        if (end > 0) {
          flush();
          nodes.push({
            type: 'math',
            latex: text.slice(index + 1, end).trim(),
            bold: style.bold,
            italic: style.italic,
          });
          index = end + 1;
          continue;
        }
      }
    }
    if (char === '`') {
      let ticks = 1;
      while (text[index + ticks] === '`') ticks += 1;
      const marker = '`'.repeat(ticks);
      const end = text.indexOf(marker, index + ticks);
      if (end > 0) {
        flush();
        const code = text.slice(index + ticks, end);
        nodes.push({ type: 'text', text: code.trim() || code, code: true, ...style });
        index = end + ticks;
        continue;
      }
    }
    if (/^<br\s*\/?>/i.test(text.slice(index, index + 6))) {
      flush();
      nodes.push({ type: 'break' });
      index = text.indexOf('>', index) + 1;
      continue;
    }
    if (char === '!' && next === '[') {
      const image = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(text.slice(index));
      if (image) {
        buffer += image[1] ? `[${image[1]}]` : '';
        index += image[0].length;
        continue;
      }
    }
    if (char === '[') {
      const link = /^\[([^\]]+)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/.exec(text.slice(index));
      if (link) {
        flush();
        const url = /^(?:https?:|mailto:)/i.test(link[2]) ? link[2] : undefined;
        nodes.push(...parseInlines(link[1], { ...style, link: url ?? style.link }));
        index += link[0].length;
        continue;
      }
    }
    if (char === '~' && next === '~') {
      const end = findClosing(text, index + 2, '~~');
      if (end > index + 2) {
        flush();
        nodes.push(...parseInlines(text.slice(index + 2, end), { ...style, strike: true }));
        index = end + 2;
        continue;
      }
    }
    if ((char === '*' || char === '_') && !(char === '_' && isWordChar(text[index - 1]))) {
      const triple = text.startsWith(char.repeat(3), index);
      const double = text.startsWith(char.repeat(2), index);
      const markerLength = triple ? 3 : double ? 2 : 1;
      const marker = char.repeat(markerLength);
      const contentStart = index + markerLength;
      if (text[contentStart] && !/\s/.test(text[contentStart])) {
        const end = findClosing(text, contentStart, marker);
        if (end > contentStart) {
          flush();
          const inner = text.slice(contentStart, end);
          const nextStyle: InlineStyle = {
            ...style,
            bold: style.bold || markerLength >= 2,
            italic: style.italic || markerLength !== 2,
          };
          nodes.push(...parseInlines(inner, nextStyle));
          index = end + markerLength;
          continue;
        }
      }
    }
    buffer += char;
    index += 1;
  }
  flush();
  return mergeTextNodes(nodes);
}

/** Plain text of inline nodes (math kept as its LaTeX source). */
export function inlinesToPlainText(nodes: InlineNode[]): string {
  return nodes
    .map((node) =>
      node.type === 'text' ? node.text : node.type === 'math' ? `$${node.latex}$` : '\n',
    )
    .join('');
}

/** Every `asset:{id}` image referenced by the document. */
export function collectImageAssetIds(blocks: MarkdownBlock[]): string[] {
  const ids = new Set<string>();
  const visit = (items: MarkdownBlock[]) => {
    for (const block of items) {
      if (block.type === 'image' && block.source.kind === 'asset') ids.add(block.source.assetId);
      if (block.type === 'blockquote') visit(block.blocks);
    }
  };
  visit(blocks);
  return Array.from(ids);
}

/**
 * Split off a leading level-1 heading that repeats (or replaces) the document
 * title so renderers do not print the title twice.
 */
export function extractDocumentTitle(
  title: string,
  blocks: MarkdownBlock[],
): { title: string; blocks: MarkdownBlock[] } {
  const first = blocks[0];
  if (first?.type === 'heading' && first.level === 1) {
    const headingText = inlinesToPlainText(first.inlines).trim();
    return { title: headingText || title, blocks: blocks.slice(1) };
  }
  return { title, blocks };
}
