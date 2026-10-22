import { Buffer } from 'node:buffer';

import { extractText, getDocumentProxy } from 'unpdf';

import { parseDocxBuffer } from '@/lib/docx/parse-docx-buffer';
import { parsePptxBuffer } from '@/lib/ppt/pptx-parser';

import type { NativeChatRequest } from './schema';

type ChatFile = NativeChatRequest['files'][number];

/** 每个文件、整轮附件分别最多给模型多少字，超出部分截断并注明。 */
const MAX_FILE_CHARS = 40_000;
const MAX_TOTAL_CHARS = 90_000;
/** PDF 抽出的字少于这个数，多半是扫描件，改把原件交给模型看。 */
const SCANNED_PDF_CHARS = 40;

export type NativeChatFilePart =
  | { kind: 'text'; name: string; text: string; truncated: boolean }
  | { kind: 'pdf'; name: string; dataBase64: string }
  | { kind: 'unreadable'; name: string; reason: string };

function extension(name: string): string {
  return /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase() ?? '';
}

async function pdfText(bytes: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages
    .map((page, index) => (page.trim() ? `--- 第 ${index + 1} 页 ---\n${page.trim()}` : ''))
    .filter(Boolean)
    .join('\n\n');
}

async function readFileText(file: ChatFile, bytes: Buffer): Promise<string | 'scanned-pdf'> {
  const ext = extension(file.name);
  if (file.mimeType === 'application/pdf' || ext === 'pdf') {
    const text = await pdfText(bytes);
    return text.replace(/--- 第 \d+ 页 ---/g, '').trim().length < SCANNED_PDF_CHARS
      ? 'scanned-pdf'
      : text;
  }
  if (ext === 'docx' || file.mimeType.includes('wordprocessingml')) {
    return (await parseDocxBuffer({ buffer: bytes, fileName: file.name })).text;
  }
  if (ext === 'pptx' || file.mimeType.includes('presentationml')) {
    return (await parsePptxBuffer({ buffer: bytes, fileName: file.name })).text;
  }
  // 其余都是 App 已经筛过的纯文本（txt / md / csv / json / 代码）。
  return bytes.toString('utf8').replace(/^﻿/, '');
}

/** 把学生这一轮附的文件变成模型能读的内容：能抽字的抽字，扫描版 PDF 交原件。 */
export async function readNativeChatFiles(files: ChatFile[]): Promise<NativeChatFilePart[]> {
  let budget = MAX_TOTAL_CHARS;
  const parts: NativeChatFilePart[] = [];
  for (const file of files) {
    const bytes = Buffer.from(file.dataBase64, 'base64');
    try {
      const text = await readFileText(file, bytes);
      if (text === 'scanned-pdf') {
        parts.push({ kind: 'pdf', name: file.name, dataBase64: file.dataBase64 });
        continue;
      }
      const clean = text.replace(/\r\n?/g, '\n').trim();
      if (!clean) {
        parts.push({ kind: 'unreadable', name: file.name, reason: '文件里没有可读的文字' });
        continue;
      }
      const limit = Math.max(0, Math.min(MAX_FILE_CHARS, budget));
      budget -= Math.min(clean.length, limit);
      parts.push({
        kind: 'text',
        name: file.name,
        text: clean.slice(0, limit),
        truncated: clean.length > limit,
      });
    } catch {
      parts.push({ kind: 'unreadable', name: file.name, reason: '文件无法解析' });
    }
  }
  return parts;
}

export function fileTextBlock(part: Exclude<NativeChatFilePart, { kind: 'pdf' }>): string {
  const name = part.name.replace(/["<>]/g, '');
  if (part.kind === 'unreadable') {
    return `<attached_file name="${name}">（${part.reason}）</attached_file>`;
  }
  return [
    `<attached_file name="${name}">`,
    part.text,
    part.truncated ? '…（文件太长，后面的内容没有发过来）' : '',
    '</attached_file>',
  ]
    .filter(Boolean)
    .join('\n');
}
