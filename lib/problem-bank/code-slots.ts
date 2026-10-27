import type { NotebookCodeSlot, NotebookProblemPublicCode } from './schema';

/**
 * 带空位的代码题：template 里 {{slot_id}} 以外的部分锁住，学生只填空位。
 * 作答仍以拼好的整段代码存进 answer.code，判分照常跑测试；
 * 需要空位时再从整段代码里按锁住的片段把每个空的内容取回来。
 */

type TemplateSegment =
  | { kind: 'text'; text: string }
  | { kind: 'slot'; slot: NotebookCodeSlot; indent: string };

export type CodeSlotTemplate = {
  template: string;
  slots: NotebookCodeSlot[];
  /// 从旧题的 starterCode 推出来时，空位里原本就有的内容
  initialValues: Record<string, string>;
  derived: boolean;
};

const SLOT_MARKER = /\{\{\s*([\w-]+)\s*\}\}/g;
const EMPTY_BLOCK = 'pass';

export function parseCodeTemplate(
  template: string,
  slots: NotebookCodeSlot[],
): TemplateSegment[] | null {
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  const source = template.trim();
  const segments: TemplateSegment[] = [];
  let last = 0;
  for (const match of source.matchAll(SLOT_MARKER)) {
    const slot = byId.get(match[1]) ?? { id: match[1], kind: 'expr' as const };
    let start = match.index;
    let indent = '';
    if (slot.kind === 'block') {
      const lineStart = source.lastIndexOf('\n', start - 1) + 1;
      const before = source.slice(lineStart, start);
      const lineEnd = source.indexOf('\n', start);
      const after = source.slice(start + match[0].length, lineEnd < 0 ? source.length : lineEnd);
      // 代码块空位必须独占一行，缩进跟着这一行走
      if (before.trim() || after.trim()) return null;
      indent = before;
      start = lineStart;
    }
    const text = source.slice(last, start);
    // 两个空位紧挨着就分不清各自的内容
    if (segments.length > 0 && !text) return null;
    if (text) segments.push({ kind: 'text', text });
    segments.push({ kind: 'slot', slot, indent });
    last = match.index + match[0].length;
    if (slot.kind === 'block') {
      const lineEnd = source.indexOf('\n', last);
      last = lineEnd < 0 ? source.length : lineEnd;
    }
  }
  if (last < source.length) segments.push({ kind: 'text', text: source.slice(last) });
  return segments.some((segment) => segment.kind === 'slot') ? segments : null;
}

function renderSlot(segment: Extract<TemplateSegment, { kind: 'slot' }>, value: string): string {
  if (segment.slot.kind === 'block') {
    const lines = value.replace(/\s+$/, '').split('\n');
    const body = lines.some((line) => line.trim()) ? lines : [EMPTY_BLOCK];
    return body.map((line) => (line.trim() ? `${segment.indent}${line}` : '')).join('\n');
  }
  // 行内空位和单行空位都不能换行
  return value.replace(/\r?\n/g, ' ');
}

export function assembleCodeFromSlots(
  template: string,
  slots: NotebookCodeSlot[],
  values: Record<string, string>,
): string {
  const segments = parseCodeTemplate(template, slots);
  if (!segments) return template;
  return segments
    .map((segment) =>
      segment.kind === 'text' ? segment.text : renderSlot(segment, values[segment.slot.id] ?? ''),
    )
    .join('');
}

/** 从整段代码取回每个空位的内容；锁住的部分被改过就返回 null。 */
export function extractSlotValues(
  template: string,
  slots: NotebookCodeSlot[],
  code: string,
): Record<string, string> | null {
  const segments = parseCodeTemplate(template, slots);
  if (!segments) return null;
  const source = code.trim();
  const values: Record<string, string> = {};
  let pos = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.kind === 'text') {
      if (!source.startsWith(segment.text, pos)) return null;
      pos += segment.text.length;
      continue;
    }
    const next = segments[index + 1];
    let end = source.length;
    if (next?.kind === 'text') {
      const isLast = index + 1 === segments.length - 1;
      end = isLast
        ? source.endsWith(next.text) && source.length - next.text.length >= pos
          ? source.length - next.text.length
          : -1
        : source.indexOf(next.text, pos);
      if (end < 0) return null;
    }
    const raw = source.slice(pos, end);
    if (segment.slot.kind === 'block') {
      const dedented = raw
        .split('\n')
        .map((line) =>
          line.startsWith(segment.indent) ? line.slice(segment.indent.length) : line.trimStart(),
        )
        .join('\n');
      values[segment.slot.id] = dedented.trim() === EMPTY_BLOCK ? '' : dedented.replace(/\s+$/, '');
    } else {
      values[segment.slot.id] = raw;
    }
    pos = end;
  }
  return values;
}

/**
 * 旧的 docstring 代码题：只有一个顶层函数、函数头 + docstring 后面是函数体时，
 * 把函数体当成一个代码块空位。其它形状（多个函数、class）返回 null，照旧整段可改。
 */
export function deriveTemplateFromStarter(
  starterCode: string | undefined,
): CodeSlotTemplate | null {
  const source = (starterCode ?? '').replace(/\r\n/g, '\n').trim();
  if (!source) return null;
  const lines = source.split('\n');
  const topLevel = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^(def|class|async def)\s/.test(line));
  if (topLevel.length !== 1 || !topLevel[0].line.startsWith('def ')) return null;
  const defIndex = topLevel[0].index;
  // 函数头可能跨行，找到以冒号结尾的那一行
  let headerEnd = defIndex;
  while (headerEnd < lines.length && !/\)\s*(->[^:]*)?:\s*(#.*)?$/.test(lines[headerEnd])) {
    headerEnd += 1;
  }
  if (headerEnd >= lines.length) return null;
  let cursor = headerEnd + 1;
  while (cursor < lines.length && !lines[cursor].trim()) cursor += 1;
  const docLine = lines[cursor] ?? '';
  const quote = docLine.trim().match(/^[rRuU]?("""|''')/)?.[1];
  if (!quote) return null;
  const indent = docLine.match(/^\s*/)?.[0] ?? '';
  if (!indent) return null;
  let docEnd = cursor;
  const opened = docLine.trim().replace(/^[rRuU]?("""|''')/, '');
  if (!opened.includes(quote)) {
    docEnd += 1;
    while (docEnd < lines.length && !lines[docEnd].includes(quote)) docEnd += 1;
    if (docEnd >= lines.length) return null;
  }
  let bodyEnd = docEnd + 1;
  while (bodyEnd < lines.length && (!lines[bodyEnd].trim() || /^\s/.test(lines[bodyEnd]))) {
    bodyEnd += 1;
  }
  const body = lines
    .slice(docEnd + 1, bodyEnd)
    .map((line) => (line.startsWith(indent) ? line.slice(indent.length) : line.trim()))
    .join('\n')
    .trim();
  const initial =
    /^(pass|\.\.\.)?$/.test(body) ||
    body.split('\n').every((line) => !line.trim() || /^(#|pass$|\.\.\.$)/.test(line.trim()))
      ? ''
      : body;
  const before = lines.slice(0, docEnd + 1).join('\n');
  const after = lines.slice(bodyEnd).join('\n').trim();
  const template = `${before}\n${indent}{{body}}${after ? `\n\n\n${after}` : ''}`;
  return {
    template,
    slots: [{ id: 'body', kind: 'block' }],
    initialValues: { body: initial },
    derived: true,
  };
}

/** 这道代码题的空位：老师写了 template 用 template，否则尝试从 starterCode 推。 */
export function codeSlotTemplateFor(
  content: Pick<NotebookProblemPublicCode, 'template' | 'slots' | 'starterCode'>,
): CodeSlotTemplate | null {
  if (content.template?.trim() && content.slots?.length) {
    if (!parseCodeTemplate(content.template, content.slots)) return null;
    return {
      template: content.template.trim(),
      slots: content.slots,
      initialValues: {},
      derived: false,
    };
  }
  return deriveTemplateFromStarter(content.starterCode);
}

/** 新开一道题时编辑器里的初始代码。 */
export function initialCodeForSlots(slotTemplate: CodeSlotTemplate): string {
  return assembleCodeFromSlots(
    slotTemplate.template,
    slotTemplate.slots,
    slotTemplate.initialValues,
  );
}

/** 作答还没动过时编辑器里的代码：有空位用空位版本，否则就是 starterCode。 */
export function defaultCodeAnswerFor(
  content: Pick<NotebookProblemPublicCode, 'template' | 'slots' | 'starterCode'> | null | undefined,
): string {
  if (!content) return '';
  const slotTemplate = codeSlotTemplateFor(content);
  return slotTemplate ? initialCodeForSlots(slotTemplate) : (content.starterCode ?? '');
}
