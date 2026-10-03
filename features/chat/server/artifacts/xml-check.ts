/**
 * Strict, dependency-free XML well-formedness checks for generated Office packages.
 *
 * Generated documents are validated before a chat tool reports success, so a
 * renderer or build-time regression surfaces as a tool failure instead of a
 * download that Word refuses to open.
 */
import JSZip from 'jszip';

export class GeneratedFileInvalidError extends Error {
  constructor(
    message: string,
    readonly problems: string[],
  ) {
    super(message);
    this.name = 'GeneratedFileInvalidError';
  }
}

const NAME_START = /[A-Za-z_:À-￯]/;
const NAME_CHAR = /[A-Za-z0-9_:.\-·À-￯]/;
const ENTITY = /^&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);/;
// XML 1.0 forbids most C0 control characters anywhere in a document.
const INVALID_CHAR = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

function lineCol(text: string, index: number): string {
  const before = text.slice(0, index);
  const line = before.split('\n').length;
  return `${line}:${index - before.lastIndexOf('\n')}`;
}

function context(text: string, index: number): string {
  return JSON.stringify(text.slice(Math.max(0, index - 40), index + 40));
}

/** Returns the first well-formedness error, or null when the document is well-formed. */
export function findXmlError(text: string): string | null {
  const fail = (index: number, message: string) =>
    `${message} at ${lineCol(text, index)} near ${context(text, index)}`;
  const bad = INVALID_CHAR.exec(text);
  if (bad) return fail(bad.index, 'invalid control character');

  const stack: string[] = [];
  let roots = 0;
  let i = 0;
  if (text.startsWith('<?xml')) {
    const end = text.indexOf('?>');
    if (end < 0) return fail(0, 'unterminated XML declaration');
    i = end + 2;
  }

  const readName = (start: number): number => {
    if (!NAME_START.test(text[start] || '')) return start;
    let j = start + 1;
    while (j < text.length && NAME_CHAR.test(text[j])) j += 1;
    return j;
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '&') {
      if (!stack.length) return fail(i, 'text outside the root element');
      if (!ENTITY.test(text.slice(i, i + 12))) return fail(i, 'unescaped "&"');
      i += 1;
      continue;
    }
    if (ch === '>') return fail(i, 'unescaped ">" in text');
    if (ch !== '<') {
      if (!stack.length && !/\s/.test(ch)) return fail(i, 'text outside the root element');
      i += 1;
      continue;
    }
    if (text.startsWith('<!--', i)) {
      const end = text.indexOf('-->', i + 4);
      if (end < 0) return fail(i, 'unterminated comment');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', i)) {
      const end = text.indexOf(']]>', i);
      if (end < 0) return fail(i, 'unterminated CDATA');
      i = end + 3;
      continue;
    }
    if (text.startsWith('<?', i)) {
      const end = text.indexOf('?>', i);
      if (end < 0) return fail(i, 'unterminated processing instruction');
      i = end + 2;
      continue;
    }
    if (text[i + 1] === '/') {
      const nameEnd = readName(i + 2);
      const name = text.slice(i + 2, nameEnd);
      let j = nameEnd;
      while (/\s/.test(text[j] || '')) j += 1;
      if (!name || text[j] !== '>') return fail(i, 'malformed end tag');
      const open = stack.pop();
      if (open !== name) return fail(i, `end tag </${name}> does not match <${open ?? ''}>`);
      i = j + 1;
      continue;
    }

    const nameEnd = readName(i + 1);
    const name = text.slice(i + 1, nameEnd);
    if (!name) return fail(i, 'unescaped "<" or malformed start tag');
    if (!stack.length) {
      roots += 1;
      if (roots > 1) return fail(i, 'more than one root element');
    }
    let j = nameEnd;
    const seen = new Set<string>();
    for (;;) {
      const spaceStart = j;
      while (/\s/.test(text[j] || '')) j += 1;
      if (text[j] === '>') {
        stack.push(name);
        j += 1;
        break;
      }
      if (text.startsWith('/>', j)) {
        j += 2;
        break;
      }
      if (j === spaceStart) return fail(j, `missing whitespace or tag end in <${name}>`);
      const attrEnd = readName(j);
      const attr = text.slice(j, attrEnd);
      if (!attr) return fail(j, `malformed attribute in <${name}>`);
      if (seen.has(attr)) return fail(j, `duplicate attribute ${attr} in <${name}>`);
      seen.add(attr);
      j = attrEnd;
      while (/\s/.test(text[j] || '')) j += 1;
      if (text[j] !== '=') return fail(j, `attribute ${attr} has no value in <${name}>`);
      j += 1;
      while (/\s/.test(text[j] || '')) j += 1;
      const quote = text[j];
      if (quote !== '"' && quote !== "'") return fail(j, `unquoted attribute ${attr} in <${name}>`);
      const close = text.indexOf(quote, j + 1);
      if (close < 0) return fail(j, `unterminated attribute ${attr} in <${name}>`);
      const value = text.slice(j + 1, close);
      if (value.includes('<')) return fail(j, `"<" inside attribute ${attr} in <${name}>`);
      const amp = value.search(/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9A-Fa-f]+);)/);
      if (amp >= 0) return fail(j + 1 + amp, `unescaped "&" in attribute ${attr}`);
      j = close + 1;
    }
    i = j;
  }
  if (stack.length) return fail(text.length, `unclosed element <${stack.at(-1)}>`);
  if (!roots) return fail(0, 'no root element');
  return null;
}

/** Child-order rules Word enforces (and reports as "unreadable content") that matter here. */
const ORDER_RULES: Array<{ part: string; before: string; after: string }> = [
  { part: 'word/settings.xml', before: '<w:compat>', after: '<m:mathPr>' },
  { part: 'word/document.xml', before: '<w:pgSz ', after: '<w:pgMar ' },
];

/**
 * Validate every XML part of a generated .docx and its package wiring. Throws
 * GeneratedFileInvalidError listing every problem found.
 */
export async function assertValidDocxPackage(buffer: Buffer): Promise<void> {
  const problems: string[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer);
  } catch (error) {
    throw new GeneratedFileInvalidError('生成的 Word 文件不是有效的压缩包', [
      error instanceof Error ? error.message : String(error),
    ]);
  }
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
  const parts = new Map<string, string>();
  for (const name of names) {
    if (!/\.(xml|rels)$/.test(name)) continue;
    const text = await zip.files[name].async('string');
    parts.set(name, text);
    const error = findXmlError(text);
    if (error) problems.push(`${name}: ${error}`);
  }
  for (const required of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml']) {
    if (!parts.has(required)) problems.push(`missing ${required}`);
  }
  const contentTypes = parts.get('[Content_Types].xml') || '';
  for (const match of contentTypes.matchAll(/PartName="\/([^"]+)"/g)) {
    if (!names.includes(match[1]))
      problems.push(`[Content_Types].xml lists missing part ${match[1]}`);
  }
  const documentRels = parts.get('word/_rels/document.xml.rels') || '';
  for (const match of documentRels.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const attrs = match[1];
    if (/TargetMode="External"/.test(attrs)) continue;
    const target = /Target="([^"]+)"/.exec(attrs)?.[1];
    if (target && !names.includes(`word/${target}`))
      problems.push(`relationship target missing: word/${target}`);
  }
  for (const rule of ORDER_RULES) {
    const text = parts.get(rule.part);
    if (!text) continue;
    const before = text.indexOf(rule.before);
    const after = text.indexOf(rule.after);
    if (before >= 0 && after >= 0 && after < before) {
      problems.push(`${rule.part}: ${rule.before} must come before ${rule.after}`);
    }
  }
  if (problems.length) {
    throw new GeneratedFileInvalidError(`生成的 Word 文件校验失败：${problems[0]}`, problems);
  }
}
