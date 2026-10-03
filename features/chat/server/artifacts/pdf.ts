/**
 * Render chat-authored Markdown into an A4 PDF with @napi-rs/canvas.
 *
 * Text is laid out by hand: CJK characters break anywhere (with simple
 * kinsoku rules for punctuation), Latin text breaks at spaces, and long words
 * are split by character. Fonts are the bundled Noto Sans SC subsets plus
 * KaTeX fonts for Greek and math symbols, so output does not depend on the
 * fonts installed on the server. Fonts are embedded as TrueType (converted from
 * WOFF, see font-sfnt.ts) so text extraction keeps every character. Math is
 * typeset from KaTeX's box tree (math-canvas.ts); formulas KaTeX cannot parse
 * fall back to linearized text (latex-readable.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GlobalFonts, PDFDocument, loadImage, type Image } from '@napi-rs/canvas';

import { woffToSfnt } from './font-sfnt';
import { latexToMathLines, type MathRun } from './latex-readable';
import { layoutLatex, type MathBox } from './math-canvas';
import {
  extractDocumentTitle,
  parseMarkdownBlocks,
  type ChatDocumentImage,
  type ChatDocumentImages,
  type InlineNode,
  type MarkdownBlock,
  type MarkdownImageSource,
  type MarkdownList,
  type TableAlign,
} from './markdown-blocks';

export type RenderMarkdownPdfInput = {
  title: string;
  markdown: string;
  /** Images referenced as `![alt](asset:{id})`, keyed by asset id. */
  images?: ChatDocumentImages;
  author?: string;
};

type PdfContext = ReturnType<PDFDocument['beginPage']>;

const PAGE = { width: 595, height: 842 } as const;
const MARGIN = { top: 62, bottom: 66, left: 58, right: 58 } as const;
const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;
const CONTENT_BOTTOM = PAGE.height - MARGIN.bottom;

const COLOR = {
  text: '#1f2937',
  muted: '#6b7280',
  heading: '#1e3a8a',
  title: '#111827',
  link: '#1d4ed8',
  rule: '#d1d5db',
  codeBackground: '#f3f4f6',
  inlineCodeBackground: '#eef0f3',
  quoteBar: '#a5b4cb',
  quoteText: '#4b5563',
  tableHeader: '#e8eef7',
  tableBorder: '#9ca3af',
} as const;

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

const FAMILY = {
  latin: 'SyntaraDoc Latin',
  cjk: 'SyntaraDoc CJK',
  mono: 'SyntaraDoc Mono',
  math: 'SyntaraDoc Math',
  greek: 'SyntaraDoc Greek',
  ams: 'SyntaraDoc AMS',
} as const;
// Noto Sans SC unicode-range subsets that carry arrows, math operators,
// circled numbers and geometric shapes missing from the latin/CJK subsets.
const NOTO_SYMBOL_SUBSETS = [87, 88, 89, 90, 91, 99, 100, 104, 105, 106, 109];
const symbolFamily = (subset: number) => `SyntaraDoc Sym${subset}`;

const TEXT_STACK = [
  FAMILY.latin,
  FAMILY.cjk,
  ...NOTO_SYMBOL_SUBSETS.map(symbolFamily),
  FAMILY.math,
  FAMILY.greek,
]
  .map((family) => `"${family}"`)
  .join(', ');
const MONO_STACK = `"${FAMILY.mono}", ${TEXT_STACK}`;
const BLACKBOARD_TO_ASCII: Record<string, string> = {
  ℝ: 'R',
  ℕ: 'N',
  ℤ: 'Z',
  ℚ: 'Q',
  ℂ: 'C',
  ℙ: 'P',
};

let fontsReady = false;

function ensurePdfFonts(): void {
  if (fontsReady) return;
  const root = process.cwd();
  const noto = (name: string) =>
    join(root, 'node_modules', '@fontsource', 'noto-sans-sc', 'files', name);
  const katex = (name: string) => join(root, 'node_modules', 'katex', 'dist', 'fonts', name);
  const register = (path: string, family: string, required: boolean) => {
    try {
      const file = readFileSync(path);
      const font = path.endsWith('.woff') ? woffToSfnt(file, ['GSUB']) : file;
      if (!GlobalFonts.register(font, family) && required) {
        throw new Error(`register returned null for ${path}`);
      }
    } catch (error) {
      if (required) {
        throw new Error(
          `PDF 字体加载失败：${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  };
  register(noto('noto-sans-sc-chinese-simplified-400-normal.woff'), FAMILY.cjk, true);
  register(noto('noto-sans-sc-chinese-simplified-700-normal.woff'), FAMILY.cjk, false);
  register(noto('noto-sans-sc-latin-400-normal.woff'), FAMILY.latin, false);
  register(noto('noto-sans-sc-latin-700-normal.woff'), FAMILY.latin, false);
  for (const subset of NOTO_SYMBOL_SUBSETS) {
    register(noto(`noto-sans-sc-${subset}-400-normal.woff`), symbolFamily(subset), false);
  }
  register(katex('KaTeX_Main-Regular.ttf'), FAMILY.math, false);
  register(katex('KaTeX_Math-Italic.ttf'), FAMILY.greek, false);
  register(katex('KaTeX_Typewriter-Regular.ttf'), FAMILY.mono, false);
  register(katex('KaTeX_AMS-Regular.ttf'), FAMILY.ams, false);
  fontsReady = true;
}

// ---------------------------------------------------------------------------
// Inline layout
// ---------------------------------------------------------------------------

type AtomStyle = {
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
  strike?: boolean;
  link?: boolean;
  color?: string;
  script?: 'sup' | 'sub';
  blackboard?: boolean;
};

type Atom = {
  text: string;
  style: AtomStyle;
  width: number;
  space: boolean;
  /** Closing punctuation: never starts a line. */
  noBreakBefore: boolean;
  /** Opening punctuation: never ends a line. */
  noBreakAfter: boolean;
  hardBreak?: boolean;
  /** Typeset formula (inline math). */
  math?: MathBox;
};

type Line = { atoms: Atom[]; width: number };

/** Formulas are set slightly larger than body text, as KaTeX does on the web. */
const MATH_SCALE = 1.1;

type InlineOptions = {
  size: number;
  maxWidth: number;
  base?: AtomStyle;
  /** Keep leading/repeated spaces (code blocks). */
  preserveSpaces?: boolean;
};

const CLOSING_PUNCTUATION = new Set(Array.from('，。、；：？！）】》」』”’〉〕,.;:?!)]}%…—·'));
const OPENING_PUNCTUATION = new Set(Array.from('（【《「『“‘〈〔([{'));

function isWideCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7af) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xffef) ||
    codePoint >= 0x20000
  );
}

function scaledSize(size: number, style: AtomStyle): number {
  return style.script ? size * 0.7 : style.code ? size * 0.92 : size;
}

function fontFor(size: number, style: AtomStyle): string {
  const actual = scaledSize(size, style).toFixed(2);
  if (style.blackboard) return `${actual}px "${FAMILY.ams}", ${TEXT_STACK}`;
  const weight = style.bold ? 'bold ' : '';
  const slant = style.italic ? 'italic ' : '';
  return `${slant}${weight}${actual}px ${style.code ? MONO_STACK : TEXT_STACK}`;
}

type Segment =
  | { text: string; style: AtomStyle }
  | { latex: string; style: AtomStyle }
  | { hardBreak: true };

function mathRunsToSegments(runs: MathRun[], base: AtomStyle): Segment[] {
  return runs.map((run) => ({ text: run.text, style: { ...base, script: run.script } }));
}

function inlineSegments(nodes: InlineNode[], base: AtomStyle = {}): Segment[] {
  const segments: Segment[] = [];
  for (const node of nodes) {
    if (node.type === 'break') {
      segments.push({ hardBreak: true });
    } else if (node.type === 'math') {
      segments.push({ latex: node.latex, style: { ...base, bold: base.bold || node.bold } });
    } else {
      segments.push({
        text: node.text,
        style: {
          ...base,
          bold: base.bold || node.bold,
          italic: base.italic || node.italic,
          strike: node.strike,
          code: node.code,
          link: !!node.link,
          color: node.link ? COLOR.link : base.color,
        },
      });
    }
  }
  return segments;
}

/** Height and baseline offset of a line; lines holding tall formulas grow to fit them. */
function lineBox(
  line: Line,
  size: number,
  lineHeight: number,
): { height: number; baseline: number } {
  const baseline = lineHeight * 0.5 + size * 0.36;
  let above = baseline;
  let below = lineHeight - baseline;
  const gap = size * 0.2;
  for (const atom of line.atoms) {
    if (!atom.math) continue;
    above = Math.max(above, atom.math.height + gap);
    below = Math.max(below, atom.math.depth + gap);
  }
  return { height: above + below, baseline: above };
}

function scaleMathBox(box: MathBox, factor: number): MathBox {
  return {
    width: box.width * factor,
    height: box.height * factor,
    depth: box.depth * factor,
    draw(ctx, x, baseline) {
      ctx.save();
      ctx.translate(x, baseline);
      ctx.scale(factor, factor);
      box.draw(ctx, 0, 0);
      ctx.restore();
    },
  };
}

class PdfRenderer {
  readonly document: PDFDocument;
  private context: PdfContext | null = null;
  private pageNumber = 0;
  private y: number = MARGIN.top;
  private indent = 0;
  private quoteDepth = 0;
  private readonly measureCache = new Map<string, number>();

  constructor(
    private readonly title: string,
    private readonly images: ChatDocumentImages | undefined,
    author: string,
  ) {
    this.document = new PDFDocument({
      title,
      author,
      creator: 'Syntara',
      producer: 'Syntara',
      compressionLevel: 6,
    });
  }

  // ----- pages -------------------------------------------------------------

  get ctx(): PdfContext {
    if (!this.context) this.newPage();
    return this.context!;
  }

  newPage(): void {
    if (this.context) this.document.endPage();
    this.pageNumber += 1;
    const context = this.document.beginPage(PAGE.width, PAGE.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, PAGE.width, PAGE.height);
    context.textBaseline = 'alphabetic';
    context.textAlign = 'left';
    context.font = fontFor(8.5, {});
    context.fillStyle = '#9ca3af';
    const label = String(this.pageNumber);
    context.fillText(label, (PAGE.width - context.measureText(label).width) / 2, PAGE.height - 34);
    if (this.pageNumber > 1) {
      const shortTitle = this.title.length > 48 ? `${this.title.slice(0, 47)}…` : this.title;
      context.fillText(shortTitle, MARGIN.left, 36);
      context.strokeStyle = '#e5e7eb';
      context.lineWidth = 0.5;
      context.beginPath();
      context.moveTo(MARGIN.left, 42);
      context.lineTo(PAGE.width - MARGIN.right, 42);
      context.stroke();
    }
    this.context = context;
    this.y = MARGIN.top;
  }

  finish(): Buffer {
    if (!this.context) this.newPage();
    this.document.endPage();
    this.context = null;
    return this.document.close();
  }

  /** Start a new page unless `height` still fits on this one. */
  ensureSpace(height: number): void {
    if (!this.context) this.newPage();
    if (this.y + height > CONTENT_BOTTOM && this.y > MARGIN.top + 0.5) this.newPage();
  }

  private get left(): number {
    return MARGIN.left + this.indent;
  }

  private get width(): number {
    return CONTENT_WIDTH - this.indent;
  }

  // ----- measuring and line breaking ---------------------------------------

  private measure(text: string, font: string): number {
    const key = `${font}|${text}`;
    const cached = this.measureCache.get(key);
    if (cached !== undefined) return cached;
    const context = this.ctx;
    context.font = font;
    const width = context.measureText(text).width;
    this.measureCache.set(key, width);
    return width;
  }

  private makeAtom(text: string, style: AtomStyle, size: number, space: boolean): Atom {
    const first = Array.from(text)[0] ?? '';
    const last = Array.from(text).pop() ?? '';
    return {
      text,
      style,
      width: this.measure(text, fontFor(size, style)),
      space,
      noBreakBefore: CLOSING_PUNCTUATION.has(first),
      noBreakAfter: OPENING_PUNCTUATION.has(last),
    };
  }

  private atomize(segments: Segment[], options: InlineOptions): Atom[] {
    const atoms: Atom[] = [];
    for (const segment of segments) {
      if ('hardBreak' in segment) {
        atoms.push({
          text: '',
          style: {},
          width: 0,
          space: false,
          noBreakBefore: false,
          noBreakAfter: false,
          hardBreak: true,
        });
        continue;
      }
      const style = { ...options.base, ...segment.style };
      if (options.base?.color && !segment.style.color) style.color = options.base.color;
      if ('latex' in segment) {
        const box = layoutLatex(segment.latex, {
          display: false,
          fontSize: options.size * MATH_SCALE,
          color: style.color ?? COLOR.text,
          fallbackFamilies: TEXT_STACK,
          bold: style.bold,
        });
        if (box) {
          atoms.push({
            text: segment.latex,
            style,
            width: box.width,
            space: false,
            noBreakBefore: false,
            noBreakAfter: false,
            math: box,
          });
        } else {
          const [runs] = latexToMathLines(segment.latex, { inline: true });
          atoms.push(...this.atomize(mathRunsToSegments(runs ?? [], style), options));
        }
        continue;
      }
      let word = '';
      const flushWord = () => {
        if (word) atoms.push(this.makeAtom(word, style, options.size, false));
        word = '';
      };
      let spaces = '';
      const flushSpaces = () => {
        if (spaces)
          atoms.push(
            this.makeAtom(options.preserveSpaces ? spaces : ' ', style, options.size, true),
          );
        spaces = '';
      };
      for (const char of Array.from(segment.text.replace(/\r/g, ''))) {
        const codePoint = char.codePointAt(0) ?? 0;
        if (char === '\n') {
          flushWord();
          flushSpaces();
          atoms.push({
            text: '',
            style,
            width: 0,
            space: false,
            noBreakBefore: false,
            noBreakAfter: false,
            hardBreak: true,
          });
          continue;
        }
        if (/\s/.test(char)) {
          flushWord();
          spaces += char === '\t' ? '    ' : ' ';
          continue;
        }
        flushSpaces();
        const blackboard = BLACKBOARD_TO_ASCII[char];
        if (blackboard) {
          flushWord();
          atoms.push(
            this.makeAtom(blackboard, { ...style, blackboard: true }, options.size, false),
          );
        } else if (isWideCodePoint(codePoint)) {
          flushWord();
          atoms.push(this.makeAtom(char, style, options.size, false));
        } else {
          word += char;
          // Allow breaks after hyphens and slashes in long tokens such as URLs.
          if ((char === '-' || char === '/') && word.length > 1) flushWord();
        }
      }
      flushWord();
      flushSpaces();
    }
    return atoms;
  }

  /** Split an atom that is wider than the line into character chunks. */
  private splitAtom(atom: Atom, maxWidth: number, size: number): Atom[] {
    const chunks: Atom[] = [];
    let current = '';
    for (const char of Array.from(atom.text)) {
      const candidate = current + char;
      if (current && this.measure(candidate, fontFor(size, atom.style)) > maxWidth) {
        chunks.push(this.makeAtom(current, atom.style, size, false));
        current = char;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(this.makeAtom(current, atom.style, size, false));
    return chunks;
  }

  layoutSegments(segments: Segment[], options: InlineOptions): Line[] {
    const atoms = this.atomize(segments, options);
    const lines: Line[] = [];
    let current: Atom[] = [];
    let width = 0;
    const pushLine = () => {
      if (!options.preserveSpaces) {
        while (current.length && current[current.length - 1].space) {
          width -= current.pop()!.width;
        }
      }
      lines.push({ atoms: current, width: Math.max(0, width) });
      current = [];
      width = 0;
    };
    const queue = [...atoms];
    while (queue.length) {
      const atom = queue.shift()!;
      if (atom.hardBreak) {
        pushLine();
        continue;
      }
      if (atom.space && !current.length && !options.preserveSpaces) continue;
      if (width + atom.width <= options.maxWidth || !current.length) {
        if (!current.length && atom.math && atom.width > options.maxWidth) {
          const fitted = scaleMathBox(atom.math, options.maxWidth / atom.width);
          current.push({ ...atom, math: fitted, width: fitted.width });
          width += fitted.width;
          continue;
        }
        if (!current.length && atom.width > options.maxWidth && !atom.space) {
          const chunks = this.splitAtom(atom, options.maxWidth, options.size);
          queue.unshift(...chunks.slice(1));
          current.push(chunks[0]);
          width += chunks[0].width;
          continue;
        }
        current.push(atom);
        width += atom.width;
        continue;
      }
      if (atom.space) {
        pushLine();
        continue;
      }
      // Closing punctuation may hang a little into the margin instead of
      // starting a new line.
      if (atom.noBreakBefore && width + atom.width <= options.maxWidth + options.size) {
        current.push(atom);
        width += atom.width;
        continue;
      }
      // Opening punctuation moves to the next line together with its word.
      const carried: Atom[] = [];
      while (current.length > 1 && current[current.length - 1].noBreakAfter) {
        const moved = current.pop()!;
        width -= moved.width;
        carried.unshift(moved);
      }
      pushLine();
      queue.unshift(...carried, atom);
    }
    if (current.length || !lines.length) pushLine();
    return lines;
  }

  // ----- drawing -----------------------------------------------------------

  /** Draw one laid-out line with its baseline at `baseline`. */
  drawLine(line: Line, x: number, baseline: number, size: number): void {
    const context = this.ctx;
    let cursor = x;
    for (const atom of line.atoms) {
      if (atom.math) {
        atom.math.draw(context, cursor, baseline);
        cursor += atom.width;
        continue;
      }
      const style = atom.style;
      const actual = scaledSize(size, style);
      const offset =
        style.script === 'sup' ? -size * 0.36 : style.script === 'sub' ? size * 0.2 : 0;
      if (style.code && !atom.space) {
        context.fillStyle = COLOR.inlineCodeBackground;
        context.fillRect(cursor - 1, baseline - actual * 0.95, atom.width + 2, actual * 1.25);
      }
      if (!atom.space) {
        context.font = fontFor(size, style);
        context.fillStyle = style.color ?? COLOR.text;
        context.fillText(atom.text, cursor, baseline + offset);
      }
      if (style.link || style.strike) {
        context.strokeStyle = style.color ?? COLOR.text;
        context.lineWidth = 0.6;
        const lineY = style.strike ? baseline - actual * 0.3 : baseline + 1.6;
        context.beginPath();
        context.moveTo(cursor, lineY);
        context.lineTo(cursor + atom.width, lineY);
        context.stroke();
      }
      cursor += atom.width;
    }
  }

  private drawQuoteBars(top: number, height: number): void {
    if (!this.quoteDepth) return;
    const context = this.ctx;
    context.fillStyle = COLOR.quoteBar;
    for (let depth = 0; depth < this.quoteDepth; depth += 1) {
      context.fillRect(MARGIN.left + depth * 14, top, 2.5, height);
    }
  }

  /** Flow lines down the page, breaking pages between lines. */
  drawLines(
    lines: Line[],
    options: {
      size: number;
      lineHeight: number;
      x?: number;
      width?: number;
      align?: 'left' | 'center' | 'right';
      onFirstLine?: (baseline: number) => void;
    },
  ): void {
    const x = options.x ?? this.left;
    const width = options.width ?? this.width;
    lines.forEach((line, index) => {
      const box = lineBox(line, options.size, options.lineHeight);
      this.ensureSpace(box.height);
      const top = this.y;
      const baseline = top + box.baseline;
      const offset =
        options.align === 'center'
          ? Math.max(0, (width - line.width) / 2)
          : options.align === 'right'
            ? Math.max(0, width - line.width)
            : 0;
      this.drawQuoteBars(top, box.height);
      this.drawLine(line, x + offset, baseline, options.size);
      if (index === 0) options.onFirstLine?.(baseline);
      this.y += box.height;
    });
  }

  // ----- blocks ------------------------------------------------------------

  renderTitle(title: string): void {
    const size = 20;
    const lines = this.layoutSegments(
      [{ text: title, style: { bold: true, color: COLOR.title } }],
      {
        size,
        maxWidth: CONTENT_WIDTH,
      },
    );
    this.drawLines(lines, { size, lineHeight: size * 1.4 });
    this.y += 4;
    const context = this.ctx;
    context.strokeStyle = '#2f5496';
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(MARGIN.left, this.y);
    context.lineTo(PAGE.width - MARGIN.right, this.y);
    context.stroke();
    this.y += 16;
  }

  async renderBlocks(blocks: MarkdownBlock[]): Promise<void> {
    for (const block of blocks) await this.renderBlock(block);
  }

  private bodyStyle(): AtomStyle {
    return this.quoteDepth ? { color: COLOR.quoteText } : {};
  }

  private async renderBlock(block: MarkdownBlock): Promise<void> {
    const bodySize = 10.5;
    const bodyLine = bodySize * 1.65;
    switch (block.type) {
      case 'heading': {
        const size = block.level === 1 ? 16.5 : block.level === 2 ? 14 : 12;
        const before = block.level === 1 ? 14 : block.level === 2 ? 11 : 8;
        const lines = this.layoutSegments(
          inlineSegments(block.inlines, { bold: true, color: COLOR.heading }),
          { size, maxWidth: this.width },
        );
        const lineHeight = size * 1.45;
        if (this.y > MARGIN.top + 0.5) this.y += before;
        // Keep the heading with at least two lines of what follows.
        this.ensureSpace(lines.length * lineHeight + bodyLine * 2);
        this.drawLines(lines, { size, lineHeight });
        this.y += 4;
        return;
      }
      case 'paragraph': {
        const lines = this.layoutSegments(inlineSegments(block.inlines, this.bodyStyle()), {
          size: bodySize,
          maxWidth: this.width,
        });
        this.drawLines(lines, { size: bodySize, lineHeight: bodyLine });
        this.y += 6;
        return;
      }
      case 'list':
        this.renderList(block, 0, bodySize, bodyLine);
        this.y += 4;
        return;
      case 'table':
        this.renderTable(block.header, block.rows, block.align);
        this.y += 10;
        return;
      case 'code':
        this.renderCode(block.text);
        return;
      case 'hr': {
        this.ensureSpace(14);
        const context = this.ctx;
        context.strokeStyle = COLOR.rule;
        context.lineWidth = 0.8;
        context.beginPath();
        context.moveTo(this.left, this.y + 6);
        context.lineTo(this.left + this.width, this.y + 6);
        context.stroke();
        this.y += 14;
        return;
      }
      case 'blockquote':
        this.indent += 14;
        this.quoteDepth += 1;
        await this.renderBlocks(block.blocks);
        this.quoteDepth -= 1;
        this.indent -= 14;
        this.y += 2;
        return;
      case 'math': {
        const size = 11.5;
        this.y += 4;
        const display = layoutLatex(block.latex, {
          display: true,
          fontSize: bodySize * MATH_SCALE,
          color: this.quoteDepth ? COLOR.quoteText : COLOR.text,
          fallbackFamilies: TEXT_STACK,
        });
        if (display) {
          const box =
            display.width > this.width
              ? scaleMathBox(display, this.width / display.width)
              : display;
          const gap = bodySize * 0.45;
          this.ensureSpace(box.height + box.depth + gap * 2);
          this.drawQuoteBars(this.y, box.height + box.depth + gap * 2);
          const baseline = this.y + gap + box.height;
          box.draw(this.ctx, this.left + Math.max(0, (this.width - box.width) / 2), baseline);
          this.y = baseline + box.depth + gap + 6;
          return;
        }
        for (const runs of latexToMathLines(block.latex, { inline: false })) {
          const lines = this.layoutSegments(mathRunsToSegments(runs, this.bodyStyle()), {
            size,
            maxWidth: this.width,
          });
          this.drawLines(lines, { size, lineHeight: size * 1.8, align: 'center' });
        }
        this.y += 6;
        return;
      }
      case 'image':
        await this.renderImage(block.alt, block.source);
        return;
      case 'pagebreak':
        if (this.y > MARGIN.top + 0.5) this.newPage();
        return;
    }
  }

  private renderList(list: MarkdownList, level: number, size: number, lineHeight: number): void {
    const markerX = this.left + 4 + level * 18;
    const textX = this.left + 22 + level * 18;
    const width = this.left + this.width - textX;
    list.items.forEach((item, index) => {
      const marker = list.ordered
        ? level === 0
          ? `${list.start + index}.`
          : `${String.fromCharCode(97 + ((list.start - 1 + index) % 26))})`
        : level === 0
          ? '•'
          : '◦';
      const lines = this.layoutSegments(inlineSegments(item.inlines, this.bodyStyle()), {
        size,
        maxWidth: width,
      });
      this.drawLines(lines, {
        size,
        lineHeight,
        x: textX,
        width,
        onFirstLine: (baseline) => {
          const context = this.ctx;
          context.font = fontFor(size, {});
          context.fillStyle = this.quoteDepth ? COLOR.quoteText : COLOR.text;
          context.fillText(marker, markerX, baseline);
        },
      });
      this.y += 2;
      if (item.children?.items.length) this.renderList(item.children, level + 1, size, lineHeight);
    });
  }

  private renderTable(header: InlineNode[][], rows: InlineNode[][][], align: TableAlign[]): void {
    const size = 9.5;
    const lineHeight = size * 1.5;
    const padding = 5;
    const columns = header.length;
    if (!columns) return;
    const available = this.width;
    const cellSegments = (nodes: InlineNode[], isHeader: boolean) =>
      inlineSegments(nodes, isHeader ? { bold: true } : {});
    const allRows = [header, ...rows];
    const natural = new Array<number>(columns).fill(0);
    const minimum = new Array<number>(columns).fill(0);
    allRows.forEach((row, rowIndex) => {
      for (let column = 0; column < columns; column += 1) {
        const atoms = this.atomize(cellSegments(row[column] ?? [], rowIndex === 0), {
          size,
          maxWidth: Infinity,
        });
        const lines = this.layoutSegments(cellSegments(row[column] ?? [], rowIndex === 0), {
          size,
          maxWidth: Infinity,
        });
        const lineWidth = Math.max(0, ...lines.map((line) => line.width));
        const longestAtom = Math.max(
          0,
          ...atoms.filter((atom) => !atom.space).map((atom) => atom.width),
        );
        natural[column] = Math.max(natural[column], lineWidth + padding * 2);
        minimum[column] = Math.max(minimum[column], Math.min(longestAtom, 120) + padding * 2, 28);
      }
    });
    let widths: number[];
    const naturalTotal = natural.reduce((sum, value) => sum + value, 0);
    const minimumTotal = minimum.reduce((sum, value) => sum + value, 0);
    if (naturalTotal <= available) {
      widths = natural.map((value) => (value / naturalTotal) * available);
    } else if (minimumTotal >= available) {
      widths = minimum.map((value) => (value / minimumTotal) * available);
    } else {
      const extra = available - minimumTotal;
      const flexible = natural.map((value, column) => Math.max(0, value - minimum[column]));
      const flexibleTotal = flexible.reduce((sum, value) => sum + value, 0) || 1;
      widths = minimum.map((value, column) => value + (flexible[column] / flexibleTotal) * extra);
    }

    const drawRow = (row: InlineNode[][], isHeader: boolean) => {
      const cellLines = widths.map((width, column) =>
        this.layoutSegments(cellSegments(row[column] ?? [], isHeader), {
          size,
          maxWidth: Math.max(8, width - padding * 2),
        }),
      );
      const cellHeight = (lines: Line[]) =>
        lines.reduce((sum, line) => sum + lineBox(line, size, lineHeight).height, 0);
      const height = Math.max(...cellLines.map(cellHeight)) + padding * 2;
      return { cellLines, height };
    };
    const paintRow = (row: ReturnType<typeof drawRow>, isHeader: boolean) => {
      const context = this.ctx;
      const top = this.y;
      let x = this.left;
      row.cellLines.forEach((lines, column) => {
        const width = widths[column];
        if (isHeader) {
          context.fillStyle = COLOR.tableHeader;
          context.fillRect(x, top, width, row.height);
        }
        let lineTop = top + padding;
        lines.forEach((line) => {
          const box = lineBox(line, size, lineHeight);
          const cellAlign = align[column];
          const inner = width - padding * 2;
          const offset =
            cellAlign === 'center'
              ? Math.max(0, (inner - line.width) / 2)
              : cellAlign === 'right'
                ? Math.max(0, inner - line.width)
                : 0;
          this.drawLine(line, x + padding + offset, lineTop + box.baseline, size);
          lineTop += box.height;
        });
        context.strokeStyle = COLOR.tableBorder;
        context.lineWidth = 0.6;
        context.strokeRect(x, top, width, row.height);
        x += width;
      });
      this.y += row.height;
    };

    const headerRow = drawRow(header, true);
    this.ensureSpace(headerRow.height + (rows.length ? drawRow(rows[0], false).height : 0));
    paintRow(headerRow, true);
    for (const row of rows) {
      const laidOut = drawRow(row, false);
      if (this.y + laidOut.height > CONTENT_BOTTOM) {
        this.newPage();
        paintRow(headerRow, true); // repeat the header on each page
      }
      paintRow(laidOut, false);
    }
  }

  private renderCode(text: string): void {
    const size = 9;
    const lineHeight = size * 1.55;
    const padding = 6;
    const width = this.width - padding * 2;
    const lines = text
      .replace(/\s+$/, '')
      .split('\n')
      .flatMap((line) =>
        this.layoutSegments([{ text: line || ' ', style: { code: true } }], {
          size: size / 0.92,
          maxWidth: width,
          preserveSpaces: true,
        }),
      );
    const context = () => this.ctx;
    this.ensureSpace(lineHeight + padding * 2);
    context().fillStyle = COLOR.codeBackground;
    context().fillRect(this.left, this.y, this.width, padding);
    this.y += padding;
    for (const line of lines) {
      if (this.y + lineHeight > CONTENT_BOTTOM) {
        this.newPage();
      }
      context().fillStyle = COLOR.codeBackground;
      context().fillRect(this.left, this.y, this.width, lineHeight);
      // Inline-code shading is not wanted inside a code block.
      const plain: Line = {
        width: line.width,
        atoms: line.atoms.map((atom) => ({ ...atom, style: { ...atom.style, code: false } })),
      };
      const baseline = this.y + lineHeight * 0.5 + size * 0.36;
      this.drawCodeLine(plain, this.left + padding, baseline, size);
      this.y += lineHeight;
    }
    context().fillStyle = COLOR.codeBackground;
    context().fillRect(this.left, this.y, this.width, padding);
    this.y += padding + 8;
  }

  private drawCodeLine(line: Line, x: number, baseline: number, size: number): void {
    const context = this.ctx;
    let cursor = x;
    context.font = `${size}px ${MONO_STACK}`;
    context.fillStyle = '#111827';
    for (const atom of line.atoms) {
      if (!atom.space) context.fillText(atom.text, cursor, baseline);
      cursor += atom.width;
    }
  }

  private async renderImage(alt: string, source: MarkdownImageSource): Promise<void> {
    const image = await loadDocumentImage(source, this.images);
    if (!image) {
      const lines = this.layoutSegments(
        [{ text: `[图片${alt ? `：${alt}` : ''}]`, style: { italic: true, color: COLOR.muted } }],
        { size: 10, maxWidth: this.width },
      );
      this.drawLines(lines, { size: 10, lineHeight: 16, align: 'center' });
      this.y += 6;
      return;
    }
    const maxHeight = (CONTENT_BOTTOM - MARGIN.top) * 0.85;
    let width = Math.min(this.width, image.width * 0.75);
    let height = (width / image.width) * image.height;
    if (height > maxHeight) {
      width *= maxHeight / height;
      height = maxHeight;
    }
    this.ensureSpace(height + (alt ? 20 : 8));
    const x = this.left + (this.width - width) / 2;
    // The PDF page context is typed as the DOM context; napi images are drawable.
    (
      this.ctx as unknown as {
        drawImage: (source: Image, x: number, y: number, w: number, h: number) => void;
      }
    ).drawImage(image, x, this.y + 4, width, height);
    this.y += height + 8;
    if (alt) {
      const lines = this.layoutSegments(
        [{ text: alt, style: { italic: true, color: COLOR.muted } }],
        {
          size: 9,
          maxWidth: this.width,
        },
      );
      this.drawLines(lines, { size: 9, lineHeight: 14, align: 'center' });
    }
    this.y += 8;
  }
}

async function loadDocumentImage(
  source: MarkdownImageSource,
  images: ChatDocumentImages | undefined,
): Promise<Image | null> {
  let image: ChatDocumentImage | null = null;
  if (source.kind === 'asset') image = images?.[source.assetId] ?? null;
  else if (source.kind === 'data') {
    image = {
      buffer: Buffer.from(source.base64.replace(/\s+/g, ''), 'base64'),
      mimeType: source.mimeType,
    };
  }
  // Remote URLs are never fetched while rendering (no SSRF from documents).
  if (!image) return null;
  try {
    return await loadImage(image.buffer);
  } catch {
    try {
      const sharp = (await import('sharp')).default;
      return await loadImage(await sharp(image.buffer, { failOn: 'none' }).png().toBuffer());
    } catch {
      return null;
    }
  }
}

/** Render chat Markdown into an A4 PDF. */
export async function renderMarkdownToPdf(input: RenderMarkdownPdfInput): Promise<Buffer> {
  ensurePdfFonts();
  const parsed = extractDocumentTitle(input.title.trim(), parseMarkdownBlocks(input.markdown));
  const title = parsed.title || '文档';
  const renderer = new PdfRenderer(title, input.images, input.author || 'Syntara');
  renderer.renderTitle(title);
  await renderer.renderBlocks(parsed.blocks);
  const buffer = renderer.finish();
  const tail = buffer.subarray(Math.max(0, buffer.length - 1024)).toString('latin1');
  if (buffer.subarray(0, 5).toString('latin1') !== '%PDF-' || !tail.includes('%%EOF')) {
    throw new Error('生成的 PDF 文件不完整');
  }
  return buffer;
}
