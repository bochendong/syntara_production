/**
 * Typeset LaTeX onto a @napi-rs/canvas context (PDF pages).
 *
 * KaTeX builds the formula (fractions, scripts, radicals, big operators,
 * delimiters, matrices…) as a tree of boxes with explicit vertical offsets and
 * glyph metrics; browsers only add horizontal flow. This module lays out that
 * tree itself and draws glyphs with the KaTeX TrueType fonts, so formulas keep
 * their mathematical structure and their text stays extractable from the PDF.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { GlobalFonts, Path2D, createCanvas } from '@napi-rs/canvas';
import katex from 'katex';

/** The drawing surface: a canvas 2D context or a PDF page context. */
export interface MathDrawContext {
  font: string;
  fillStyle: string | object;
  strokeStyle: string | object;
  lineWidth: number;
  fillText(text: string, x: number, y: number): void;
  fillRect(x: number, y: number, width: number, height: number): void;
  strokeRect(x: number, y: number, width: number, height: number): void;
  save(): void;
  restore(): void;
  beginPath(): void;
  rect(x: number, y: number, width: number, height: number): void;
  clip(): void;
  translate(x: number, y: number): void;
  scale(x: number, y: number): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fill(path: Path2D): void;
}
type Ctx2D = MathDrawContext;
type MeasureContext = ReturnType<ReturnType<typeof createCanvas>['getContext']>;

/** Minimal view of KaTeX's (internal, but stable) virtual DOM nodes. */
type KNode = {
  classes?: string[];
  style?: Record<string, string | undefined>;
  children?: KNode[];
  height?: number;
  depth?: number;
  text?: string;
  italic?: number;
  attributes?: Record<string, string>;
  toMarkup?: () => string;
};

type KatexDomBuilder = (expression: string, options: katex.KatexOptions) => unknown;

export type MathBox = {
  /** Advance width in px. */
  width: number;
  /** Extent above the baseline in px. */
  height: number;
  /** Extent below the baseline in px. */
  depth: number;
  draw(ctx: Ctx2D, x: number, baseline: number): void;
};

export type MathLayoutOptions = {
  display: boolean;
  /** Font size in px for 1em of the formula. */
  fontSize: number;
  color?: string;
  /** CSS font-family list used for characters KaTeX fonts lack (CJK in \text{}). */
  fallbackFamilies?: string;
  bold?: boolean;
};

const FONT_FILES: Record<string, string> = {
  Main: 'KaTeX_Main-Regular.ttf',
  MainBold: 'KaTeX_Main-Bold.ttf',
  MainItalic: 'KaTeX_Main-Italic.ttf',
  MainBoldItalic: 'KaTeX_Main-BoldItalic.ttf',
  Math: 'KaTeX_Math-Italic.ttf',
  MathBold: 'KaTeX_Math-BoldItalic.ttf',
  AMS: 'KaTeX_AMS-Regular.ttf',
  Caligraphic: 'KaTeX_Caligraphic-Regular.ttf',
  Fraktur: 'KaTeX_Fraktur-Regular.ttf',
  SansSerif: 'KaTeX_SansSerif-Regular.ttf',
  SansSerifBold: 'KaTeX_SansSerif-Bold.ttf',
  SansSerifItalic: 'KaTeX_SansSerif-Italic.ttf',
  Script: 'KaTeX_Script-Regular.ttf',
  Typewriter: 'KaTeX_Typewriter-Regular.ttf',
  Size1: 'KaTeX_Size1-Regular.ttf',
  Size2: 'KaTeX_Size2-Regular.ttf',
  Size3: 'KaTeX_Size3-Regular.ttf',
  Size4: 'KaTeX_Size4-Regular.ttf',
};
type FontKey = keyof typeof FONT_FILES;
const family = (key: FontKey) => `SyntaraMath ${key}`;

let fontsReady = false;
function ensureMathFonts(): void {
  if (fontsReady) return;
  const dir = join(process.cwd(), 'node_modules', 'katex', 'dist', 'fonts');
  for (const [key, file] of Object.entries(FONT_FILES)) {
    if (!GlobalFonts.register(readFileSync(join(dir, file)), family(key as FontKey))) {
      throw new Error(`KaTeX font failed to load: ${file}`);
    }
  }
  fontsReady = true;
}

let measureContext: MeasureContext | null = null;
function measurer(): MeasureContext {
  measureContext ??= createCanvas(8, 8).getContext('2d');
  return measureContext;
}

// KaTeX \sizing multipliers (size1 … size11).
const SIZE_MULTIPLIERS = [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.2, 1.44, 1.728, 2.074, 2.488];

function em(value: string | undefined, fontPx: number, fallback = 0): number {
  if (!value) return fallback;
  const number = Number.parseFloat(value);
  if (!Number.isFinite(number)) return fallback;
  if (value.endsWith('em')) return number * fontPx;
  if (value.endsWith('ex')) return number * fontPx * 0.431;
  if (value.endsWith('pt')) return (number * fontPx) / 10;
  if (value.endsWith('px')) return number;
  return number * fontPx;
}

function has(node: KNode, cls: string): boolean {
  return !!node.classes?.includes(cls);
}

type Align = 'left' | 'center' | 'right';
type Env = {
  fontPx: number;
  /** Font-affecting classes from the nearest ancestors (innermost last). */
  fontClasses: string[];
  color: string;
  align: Align;
  fallback: string;
  bold: boolean;
};

const FONT_CLASSES = new Set([
  'mathnormal',
  'mathit',
  'mathrm',
  'mathbf',
  'boldsymbol',
  'amsrm',
  'mathbb',
  'textbb',
  'mathcal',
  'mathfrak',
  'textfrak',
  'mathtt',
  'texttt',
  'mathscr',
  'textscr',
  'mathsf',
  'textsf',
  'mathboldsf',
  'textboldsf',
  'mathitsf',
  'textitsf',
  'textit',
  'textbf',
  'textrm',
  'textup',
  'textmd',
  'delimsizing',
  'size1',
  'size2',
  'size3',
  'size4',
  'delim-size1',
  'delim-size4',
  'small-op',
  'large-op',
]);

function fontKeyFor(classes: string[], bold: boolean): FontKey {
  const set = new Set(classes);
  if (set.has('large-op')) return 'Size2';
  if (set.has('small-op')) return 'Size1';
  if (set.has('delim-size1')) return 'Size1';
  if (set.has('delim-size4')) return 'Size4';
  if (set.has('delimsizing')) {
    for (const size of [1, 2, 3, 4] as const) if (set.has(`size${size}`)) return `Size${size}`;
  }
  // Innermost font command wins.
  for (const cls of [...classes].reverse()) {
    switch (cls) {
      case 'mathnormal':
        return bold ? 'MathBold' : 'Math';
      case 'boldsymbol':
        return 'MathBold';
      case 'mathit':
      case 'textit':
        return bold ? 'MainBoldItalic' : 'MainItalic';
      case 'mathbf':
      case 'textbf':
        return 'MainBold';
      case 'amsrm':
      case 'mathbb':
      case 'textbb':
        return 'AMS';
      case 'mathcal':
        return 'Caligraphic';
      case 'mathfrak':
      case 'textfrak':
        return 'Fraktur';
      case 'mathtt':
      case 'texttt':
        return 'Typewriter';
      case 'mathscr':
      case 'textscr':
        return 'Script';
      case 'mathsf':
      case 'textsf':
        return 'SansSerif';
      case 'mathboldsf':
      case 'textboldsf':
        return 'SansSerifBold';
      case 'mathitsf':
      case 'textitsf':
        return 'SansSerifItalic';
      case 'mathrm':
      case 'textrm':
      case 'textup':
      case 'textmd':
        return bold ? 'MainBold' : 'Main';
    }
  }
  return bold ? 'MainBold' : 'Main';
}

function fontString(env: Env): string {
  const key = fontKeyFor(env.fontClasses, env.bold);
  return `${env.fontPx.toFixed(3)}px "${family(key)}", ${env.fallback}`;
}

/** Environment for a span's own content (font size, font classes, colour). */
function spanEnv(node: KNode, parent: Env): Env {
  let fontPx = parent.fontPx;
  const classes = node.classes ?? [];
  if (has(node, 'sizing') || has(node, 'fontsize-ensurer')) {
    const reset = classes.find((cls) => cls.startsWith('reset-size'));
    const size = classes.find((cls) => /^size\d+$/.test(cls));
    if (reset && size) {
      const from = SIZE_MULTIPLIERS[Number(reset.slice(10)) - 1] ?? 1;
      const to = SIZE_MULTIPLIERS[Number(size.slice(4)) - 1] ?? 1;
      fontPx = (fontPx * to) / from;
    }
  }
  const fontClasses = classes.some((cls) => FONT_CLASSES.has(cls))
    ? [...parent.fontClasses, ...classes.filter((cls) => FONT_CLASSES.has(cls))]
    : parent.fontClasses;
  let align = parent.align;
  if (has(node, 'mfrac') || has(node, 'op-limits') || has(node, 'accent')) align = 'center';
  if (has(node, 'x-arrow') || has(node, 'mover') || has(node, 'munder')) align = 'center';
  if (has(node, 'col-align-c')) align = 'center';
  if (has(node, 'col-align-l') || has(node, 'msupsub') || has(node, 'svg-align')) align = 'left';
  if (has(node, 'col-align-r')) align = 'right';
  const textBold = has(node, 'textbf') || has(node, 'mathbf') || has(node, 'boldsymbol');
  return {
    ...parent,
    fontPx,
    fontClasses,
    align,
    color: node.style?.color || parent.color,
    bold: parent.bold || textBold,
  };
}

const isSymbol = (node: KNode) => typeof node.text === 'string' && !node.children?.length;
const isSvg = (node: KNode) =>
  !!node.attributes && typeof node.toMarkup === 'function' && 'viewBox' in node.attributes;

/** Width of spans that fill their container (100% wide rules and SVGs). */
const FILL_CLASSES = [
  'frac-line',
  'overline-line',
  'underline-line',
  'hline',
  'hdashline',
  'hide-tail',
  'stretchy',
];
const fills = (node: KNode) => FILL_CLASSES.some((cls) => has(node, cls));
/** Absolutely positioned pieces of stretchy arrows and braces (fractions of the parent width). */
const ABSOLUTE_PIECES = [
  { cls: 'halfarrow-left', left: 0, width: 0.502 },
  { cls: 'halfarrow-right', left: 0.498, width: 0.502 },
  { cls: 'brace-left', left: 0, width: 0.251 },
  { cls: 'brace-center', left: 0.25, width: 0.5 },
  { cls: 'brace-right', left: 0.749, width: 0.251 },
];

class Layout {
  private readonly widths = new WeakMap<KNode, number>();

  // ----- measuring -------------------------------------------------------

  width(node: KNode, env: Env): number {
    const cached = this.widths.get(node);
    if (cached !== undefined) return cached;
    const value = this.computeWidth(node, env);
    this.widths.set(node, value);
    return value;
  }

  /** Margin-box width: what this node advances the pen by. */
  advance(node: KNode, env: Env): number {
    const own = isSymbol(node) ? env : spanEnv(node, env);
    if (ABSOLUTE_PIECES.some((piece) => has(node, piece.cls))) return 0;
    const italic = isSymbol(node) && node.italic && node.italic > 0 ? node.italic * env.fontPx : 0;
    return (
      this.width(node, env) +
      em(node.style?.marginLeft, own.fontPx) +
      (node.style?.marginRight ? em(node.style.marginRight, own.fontPx) : italic)
    );
  }

  private computeWidth(node: KNode, env: Env): number {
    if (isSymbol(node)) {
      const text = (node.text ?? '').replace(/​/g, '');
      if (!text) return 0;
      const context = measurer();
      context.font = fontString({
        ...env,
        fontClasses: [...env.fontClasses, ...(node.classes ?? [])],
      });
      return context.measureText(text).width;
    }
    if (isSvg(node)) {
      const widthAttr = node.attributes?.width ?? '';
      const w = em(widthAttr, env.fontPx);
      return widthAttr.endsWith('%') || w > 50 * env.fontPx ? 0 : w;
    }
    const own = spanEnv(node, env);
    const style = node.style ?? {};
    if (has(node, 'accent-body') && !has(node, 'accent-full')) return 0;
    if (has(node, 'llap') || has(node, 'rlap') || has(node, 'clap')) return 0;
    if (style.width) return em(style.width, own.fontPx);
    if (fills(node) && !style.minWidth) return 0;
    if (has(node, 'rule')) return em(style.borderRightWidth, own.fontPx);
    const pad = this.padding(node, own);
    let content = 0;
    if (has(node, 'vlist-t')) {
      for (const wrap of this.vlistChildren(node)) {
        const elem = wrap.children?.[1];
        if (!elem) continue;
        const wrapEnv = spanEnv(wrap, own);
        const offset =
          em(wrap.style?.marginLeft, wrapEnv.fontPx) + em(wrap.style?.left, wrapEnv.fontPx);
        content = Math.max(
          content,
          offset + this.advance(elem, wrapEnv) + em(wrap.style?.marginRight, wrapEnv.fontPx),
        );
      }
    } else {
      for (const child of node.children ?? []) content += this.advance(child, own);
    }
    const width = content + pad.left + pad.right;
    return Math.max(width, em(style.minWidth, own.fontPx));
  }

  private padding(node: KNode, env: Env): { left: number; right: number } {
    const style = node.style ?? {};
    let left = em(style.paddingLeft, env.fontPx);
    let right = em(style.paddingRight, env.fontPx);
    const side = has(node, 'boxpad')
      ? 0.3
      : has(node, 'x-arrow-pad')
        ? 0.5
        : has(node, 'cancel-pad')
          ? 0.2
          : 0;
    left += side * env.fontPx;
    right += side * env.fontPx;
    return { left, right };
  }

  /** The positioned children ([pstrut, elem] wrappers) of a vlist table. */
  private vlistChildren(node: KNode): KNode[] {
    const row = node.children?.find((child) => has(child, 'vlist-r'));
    const vlist = row?.children?.find((child) => has(child, 'vlist'));
    return (vlist?.children ?? []).filter((wrap) => wrap.children && wrap.children.length >= 2);
  }

  // ----- drawing ---------------------------------------------------------

  draw(
    ctx: Ctx2D,
    node: KNode,
    env: Env,
    x: number,
    baseline: number,
    containerWidth: number,
  ): void {
    if (isSymbol(node)) {
      const text = (node.text ?? '').replace(/​/g, '');
      if (!text) return;
      ctx.font = fontString({ ...env, fontClasses: [...env.fontClasses, ...(node.classes ?? [])] });
      ctx.fillStyle = node.style?.color || env.color;
      ctx.fillText(
        text,
        x + em(node.style?.left, env.fontPx),
        baseline + em(node.style?.top, env.fontPx),
      );
      return;
    }
    if (isSvg(node)) {
      this.drawSvg(ctx, node, env, x, baseline, containerWidth);
      return;
    }
    const own = spanEnv(node, env);
    const style = node.style ?? {};
    let base = baseline;
    if (style.top && !has(node, 'pstrut')) base += em(style.top, own.fontPx);
    if (style.verticalAlign && !has(node, 'strut')) base -= em(style.verticalAlign, own.fontPx);
    if (style.bottom && has(node, 'rule')) base -= em(style.bottom, own.fontPx);
    if (style.left) x += em(style.left, own.fontPx);
    const width = fills(node)
      ? Math.max(this.width(node, env), containerWidth)
      : this.width(node, env) || containerWidth;

    if (style.borderBottomWidth && (fills(node) || has(node, 'sout'))) {
      const thickness = Math.max(em(style.borderBottomWidth, own.fontPx), 0.5);
      ctx.fillStyle = own.color;
      ctx.fillRect(x, base - thickness, width, thickness);
    }
    if (has(node, 'rule')) {
      const w = em(style.borderRightWidth, own.fontPx);
      const h = em(style.borderTopWidth, own.fontPx);
      ctx.fillStyle = own.color;
      ctx.fillRect(x, base - h, w, h);
      return;
    }
    if (has(node, 'fbox') || has(node, 'fcolorbox')) {
      const line = 0.04 * own.fontPx;
      ctx.strokeStyle = style.borderColor || own.color;
      ctx.lineWidth = line;
      const h = (node.height ?? 0) * env.fontPx;
      const d = (node.depth ?? 0) * env.fontPx;
      ctx.strokeRect(x + line / 2, base - h + line / 2, width - line, h + d - line);
    }

    const pad = this.padding(node, own);
    if (has(node, 'vlist-t')) {
      const inner = width - pad.left - pad.right;
      for (const wrap of this.vlistChildren(node)) {
        const [pstrut, elem] = wrap.children as [KNode, KNode];
        const wrapEnv = spanEnv(wrap, own);
        const shift =
          em(wrap.style?.top, wrapEnv.fontPx) + em(pstrut.style?.height, wrapEnv.fontPx);
        const fill = fills(elem);
        const elemWidth = fill ? inner : this.advance(elem, wrapEnv);
        let offset =
          em(wrap.style?.marginLeft, wrapEnv.fontPx) + em(wrap.style?.left, wrapEnv.fontPx);
        if (!fill && own.align === 'center') offset += (inner - elemWidth) / 2;
        else if (!fill && own.align === 'right') offset += inner - elemWidth;
        const elemMargin = isSymbol(elem)
          ? 0
          : em(elem.style?.marginLeft, spanEnv(elem, wrapEnv).fontPx);
        this.draw(ctx, elem, wrapEnv, x + pad.left + offset + elemMargin, base + shift, elemWidth);
      }
      return;
    }

    if (has(node, 'llap') || has(node, 'rlap') || has(node, 'clap')) {
      const innerNode = node.children?.find((child) => has(child, 'inner'));
      if (!innerNode) return;
      const innerWidth = this.width(innerNode, own);
      const start = has(node, 'llap') ? x - innerWidth : has(node, 'clap') ? x - innerWidth / 2 : x;
      this.draw(ctx, innerNode, own, start, base, innerWidth);
      return;
    }

    let cursor = x + pad.left;
    const inner = width - pad.left - pad.right;
    for (const child of node.children ?? []) {
      const piece = ABSOLUTE_PIECES.find((candidate) => has(child, candidate.cls));
      if (piece) {
        this.draw(ctx, child, own, x + pad.left + inner * piece.left, base, inner * piece.width);
        continue;
      }
      const childEnv = isSymbol(child) ? own : spanEnv(child, own);
      cursor += em(child.style?.marginLeft, childEnv.fontPx);
      const childWidth = this.width(child, own);
      this.draw(ctx, child, own, cursor, base, fills(child) || isSvg(child) ? inner : childWidth);
      cursor += this.advance(child, own) - em(child.style?.marginLeft, childEnv.fontPx);
    }
  }

  private drawSvg(
    ctx: Ctx2D,
    node: KNode,
    env: Env,
    x: number,
    baseline: number,
    containerWidth: number,
  ): void {
    const markup = node.toMarkup?.() ?? '';
    const attrs = node.attributes ?? {};
    const [vx, vy, vw, vh] = (attrs.viewBox ?? '0 0 0 0').split(/\s+/).map(Number);
    if (!vw || !vh) return;
    const height = em(attrs.height, env.fontPx) || env.fontPx;
    const declaredWidth = attrs.width?.endsWith('%') ? 0 : em(attrs.width, env.fontPx);
    const boxWidth =
      declaredWidth && declaredWidth < 50 * env.fontPx ? declaredWidth : containerWidth;
    const aspect = attrs.preserveAspectRatio ?? 'xMidYMid meet';
    let sx: number;
    let sy: number;
    if (aspect === 'none') {
      sx = boxWidth / vw;
      sy = height / vh;
    } else {
      const scale = aspect.includes('slice')
        ? Math.max((declaredWidth || boxWidth) / vw, height / vh)
        : Math.min(boxWidth / vw, height / vh);
      sx = scale;
      sy = scale;
    }
    const top = baseline - height;
    const drawnWidth = vw * sx;
    const alignX = aspect.startsWith('xMax')
      ? boxWidth - drawnWidth
      : aspect.startsWith('xMid')
        ? (boxWidth - drawnWidth) / 2
        : 0;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, top, boxWidth, height);
    ctx.clip();
    ctx.translate(x + alignX - vx * sx, top - vy * sy);
    ctx.scale(sx, sy);
    ctx.fillStyle = env.color;
    ctx.strokeStyle = env.color;
    for (const match of markup.matchAll(/<path\b[^>]*\sd=['"]([^'"]+)['"]/g)) {
      ctx.fill(new Path2D(match[1]));
    }
    for (const match of markup.matchAll(/<line\b([^>]*)>/g)) {
      const attr = (name: string) =>
        Number(new RegExp(`${name}=['"]([^'"]+)['"]`).exec(match[1])?.[1] ?? 0);
      ctx.lineWidth = attr('stroke-width') || 1;
      ctx.beginPath();
      ctx.moveTo(attr('x1'), attr('y1'));
      ctx.lineTo(attr('x2'), attr('y2'));
      ctx.stroke();
    }
    ctx.restore();
  }
}

/**
 * Lay out a LaTeX formula. Returns null when KaTeX cannot parse it, so callers
 * can fall back to readable plain text.
 */
export function layoutLatex(latex: string, options: MathLayoutOptions): MathBox | null {
  ensureMathFonts();
  let tree: KNode;
  try {
    tree = (katex as unknown as { __renderToDomTree: KatexDomBuilder }).__renderToDomTree(latex, {
      displayMode: options.display,
      output: 'html',
      throwOnError: true,
      strict: 'ignore',
      trust: false,
    }) as unknown as KNode;
  } catch {
    return null;
  }
  const findHtml = (node: KNode): KNode | null => {
    if (has(node, 'katex-html')) return node;
    for (const child of node.children ?? []) {
      const found = findHtml(child);
      if (found) return found;
    }
    return null;
  };
  const html = findHtml(tree);
  if (!html) return null;
  const env: Env = {
    fontPx: options.fontSize * 1.0,
    fontClasses: [],
    color: options.color ?? '#000000',
    align: 'left',
    fallback: options.fallbackFamilies || 'sans-serif',
    bold: !!options.bold,
  };
  const layout = new Layout();
  const bases = (html.children ?? []).filter(
    (child) => !has(child, 'newline') && !has(child, 'tag'),
  );
  const width = bases.reduce((sum, base) => sum + layout.advance(base, env), 0);
  const height = Math.max(0, ...bases.map((base) => (base.height ?? 0) * env.fontPx));
  const depth = Math.max(0, ...bases.map((base) => (base.depth ?? 0) * env.fontPx));
  if (!Number.isFinite(width) || width <= 0) return null;
  return {
    width,
    height,
    depth,
    draw(ctx, x, baseline) {
      let cursor = x;
      for (const base of bases) {
        const w = layout.width(base, env);
        layout.draw(ctx, base, env, cursor, baseline, w);
        cursor += layout.advance(base, env);
      }
    },
  };
}
