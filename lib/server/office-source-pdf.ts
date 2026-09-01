import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { GlobalFonts, PDFDocument, loadImage } from '@napi-rs/canvas';

import { parseDocxBuffer } from '@/lib/docx/parse-docx-buffer';
import { parsePptxBuffer, type ParsedPptxImage } from '@/lib/ppt/pptx-parser';
import { prisma } from '@/lib/server/prisma';

const PREVIEW_PATH_PREFIX = '/course-source-previews/';
const PORTRAIT_PAGE = { width: 595, height: 842 } as const;
const SLIDE_PAGE = { width: 960, height: 540 } as const;
const OFFICE_PDF_FONT_FAMILY = 'Syntara CJK';
const OFFICE_PDF_FONT = `"${OFFICE_PDF_FONT_FAMILY}"`;
const require = createRequire(import.meta.url);
let officePdfFontReady = false;

type PdfContext = ReturnType<PDFDocument['beginPage']>;

export type OfficeSourcePdf = {
  pdf: Buffer;
  text: string;
  pageCount: number;
};

function ensureOfficePdfFont() {
  if (officePdfFontReady || GlobalFonts.has(OFFICE_PDF_FONT_FAMILY)) {
    officePdfFontReady = true;
    return;
  }
  const fontPath = join(
    dirname(require.resolve('@fontsource/noto-sans-sc/package.json')),
    'files',
    'noto-sans-sc-chinese-simplified-400-normal.woff2',
  );
  if (!GlobalFonts.registerFromPath(fontPath, OFFICE_PDF_FONT_FAMILY)) {
    throw new Error('PDF 预览字体加载失败。');
  }
  officePdfFontReady = true;
}

function cleanText(value: string): string {
  return value
    .replace(/\u0000/g, '')
    .replace(/\r\n?/g, '\n')
    .trim();
}

function splitLineToWidth(context: PdfContext, line: string, maxWidth: number): string[] {
  const value = line.trimEnd();
  if (!value) return [''];
  const tokens = /\s/.test(value) ? value.split(/(\s+)/).filter(Boolean) : Array.from(value);
  const rows: string[] = [];
  let row = '';
  for (const token of tokens) {
    const candidate = `${row}${token}`;
    if (!row || context.measureText(candidate).width <= maxWidth) {
      row = candidate;
      continue;
    }
    rows.push(row.trimEnd());
    row = token.trimStart();
    if (context.measureText(row).width <= maxWidth) continue;
    let fragment = '';
    for (const character of Array.from(row)) {
      const next = `${fragment}${character}`;
      if (fragment && context.measureText(next).width > maxWidth) {
        rows.push(fragment);
        fragment = character;
      } else {
        fragment = next;
      }
    }
    row = fragment;
  }
  if (row) rows.push(row.trimEnd());
  return rows;
}

function documentLines(context: PdfContext, text: string, maxWidth: number): string[] {
  return cleanText(text)
    .split('\n')
    .flatMap((line) => splitLineToWidth(context, line, maxWidth));
}

function beginWhitePage(document: PDFDocument, width: number, height: number): PdfContext {
  const context = document.beginPage(width, height);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#172033';
  context.textBaseline = 'alphabetic';
  return context;
}

function renderDocxPdf(title: string, text: string): { pdf: Buffer; pageCount: number } {
  ensureOfficePdfFont();
  const document = new PDFDocument({
    title,
    creator: 'Syntara',
    producer: 'Syntara normalized DOCX preview',
    compressionLevel: 6,
  });
  const margin = 48;
  const bodyTop = 88;
  const bodyBottom = PORTRAIT_PAGE.height - 48;
  const lineHeight = 18;
  let pageNumber = 0;
  const startPage = (): PdfContext => {
    if (pageNumber > 0) document.endPage();
    pageNumber += 1;
    const context = beginWhitePage(document, PORTRAIT_PAGE.width, PORTRAIT_PAGE.height);
    context.font = `bold 15px ${OFFICE_PDF_FONT}`;
    context.fillStyle = '#111827';
    context.fillText(title.slice(0, 90), margin, 48, PORTRAIT_PAGE.width - margin * 2);
    context.font = `10px ${OFFICE_PDF_FONT}`;
    context.fillStyle = '#94a3b8';
    context.fillText(`PDF 在线预览 · 第 ${pageNumber} 页`, margin, 68);
    context.strokeStyle = '#e2e8f0';
    context.beginPath();
    context.moveTo(margin, 76);
    context.lineTo(PORTRAIT_PAGE.width - margin, 76);
    context.stroke();
    context.font = `12px ${OFFICE_PDF_FONT}`;
    context.fillStyle = '#334155';
    return context;
  };

  let context = startPage();
  const lines = documentLines(context, text, PORTRAIT_PAGE.width - margin * 2);
  let y = bodyTop;
  for (const line of lines) {
    if (y > bodyBottom) {
      context = startPage();
      y = bodyTop;
    }
    if (!line) {
      y += lineHeight * 0.65;
      continue;
    }
    context.fillText(line, margin, y, PORTRAIT_PAGE.width - margin * 2);
    y += lineHeight;
  }
  document.endPage();
  return { pdf: document.close(), pageCount: pageNumber };
}

function slideTextBlocks(text: string, slideCount: number): string[] {
  const blocks = Array.from({ length: Math.max(1, slideCount) }, () => '');
  const matches = Array.from(text.matchAll(/(?:^|\n\n)Slide\s+(\d+)\s*\n?/g));
  if (!matches.length) {
    blocks[0] = cleanText(text);
    return blocks;
  }
  matches.forEach((match, index) => {
    const pageIndex = Math.max(0, Number(match[1]) - 1);
    const start = (match.index || 0) + match[0].length;
    const end = matches[index + 1]?.index ?? text.length;
    if (pageIndex < blocks.length) blocks[pageIndex] = cleanText(text.slice(start, end));
  });
  return blocks;
}

async function drawSlideImages(
  context: PdfContext,
  images: ParsedPptxImage[],
  area: { x: number; y: number; width: number; height: number },
) {
  const candidates = images.slice(0, 4);
  if (!candidates.length) return;
  const columns = candidates.length === 1 ? 1 : 2;
  const rows = Math.ceil(candidates.length / columns);
  const gap = 10;
  const cellWidth = (area.width - gap * (columns - 1)) / columns;
  const cellHeight = (area.height - gap * (rows - 1)) / rows;
  await Promise.all(
    candidates.map(async (candidate, index) => {
      try {
        const image = await loadImage(candidate.src);
        const scale = Math.min(cellWidth / image.width, cellHeight / image.height);
        const width = Math.max(1, image.width * scale);
        const height = Math.max(1, image.height * scale);
        const column = index % columns;
        const row = Math.floor(index / columns);
        const x = area.x + column * (cellWidth + gap) + (cellWidth - width) / 2;
        const y = area.y + row * (cellHeight + gap) + (cellHeight - height) / 2;
        (
          context as unknown as {
            drawImage: (source: typeof image, x: number, y: number, w: number, h: number) => void;
          }
        ).drawImage(image, x, y, width, height);
      } catch {
        // A broken embedded image must not prevent the text of the slide from being previewed.
      }
    }),
  );
}

async function renderPptxPdf(args: {
  title: string;
  text: string;
  slideCount: number;
  images: ParsedPptxImage[];
}): Promise<Buffer> {
  ensureOfficePdfFont();
  const document = new PDFDocument({
    title: args.title,
    creator: 'Syntara',
    producer: 'Syntara normalized PPTX preview',
    compressionLevel: 6,
    encodingQuality: 90,
  });
  const blocks = slideTextBlocks(args.text, args.slideCount);
  for (let slideIndex = 0; slideIndex < blocks.length; slideIndex += 1) {
    const context = beginWhitePage(document, SLIDE_PAGE.width, SLIDE_PAGE.height);
    context.fillStyle = '#f8fafc';
    context.fillRect(0, 0, SLIDE_PAGE.width, 58);
    context.font = `bold 18px ${OFFICE_PDF_FONT}`;
    context.fillStyle = '#0f172a';
    context.fillText(args.title.slice(0, 80), 40, 36, 720);
    context.font = `11px ${OFFICE_PDF_FONT}`;
    context.fillStyle = '#64748b';
    context.fillText(`第 ${slideIndex + 1} / ${blocks.length} 页`, 820, 36);

    const slideImages = args.images.filter((image) => image.pageNumber === slideIndex + 1);
    const hasImages = slideImages.length > 0;
    const textWidth = hasImages ? 500 : SLIDE_PAGE.width - 80;
    context.font = `15px ${OFFICE_PDF_FONT}`;
    context.fillStyle = '#273449';
    const lines = documentLines(context, blocks[slideIndex] || '', textWidth);
    let y = 94;
    for (const line of lines.slice(0, 22)) {
      if (!line) {
        y += 10;
        continue;
      }
      context.fillText(line, 40, y, textWidth);
      y += 19;
    }
    if (lines.length > 22) {
      context.font = `11px ${OFFICE_PDF_FONT}`;
      context.fillStyle = '#94a3b8';
      context.fillText('本页文字较多，已在课程资料索引中完整保留。', 40, 510);
    }
    if (hasImages) {
      await drawSlideImages(context, slideImages, {
        x: 570,
        y: 82,
        width: 350,
        height: 410,
      });
    }
    document.endPage();
  }
  return document.close();
}

export function courseSourcePreviewPdfPath(sourceId: string): string {
  return `${PREVIEW_PATH_PREFIX}${sourceId}.pdf`;
}

export async function convertOfficeSourceToPdf(args: {
  title: string;
  mimeType: string;
  data: Buffer;
}): Promise<OfficeSourcePdf> {
  const lowerTitle = args.title.toLowerCase();
  const lowerMimeType = args.mimeType.toLowerCase();
  if (lowerMimeType.includes('presentationml') || lowerTitle.endsWith('.pptx')) {
    const parsed = await parsePptxBuffer({
      buffer: args.data,
      fileName: args.title,
      fileSize: args.data.byteLength,
    });
    const pageCount = Math.max(1, parsed.metadata.slideCount || 1);
    return {
      text: cleanText(parsed.text || ''),
      pageCount,
      pdf: await renderPptxPdf({
        title: args.title,
        text: parsed.text || '',
        slideCount: pageCount,
        images: parsed.images,
      }),
    };
  }
  const parsed = await parseDocxBuffer({
    buffer: args.data,
    fileName: args.title,
    fileSize: args.data.byteLength,
  });
  const text = cleanText(parsed.text);
  const rendered = renderDocxPdf(args.title, text);
  return { text, pageCount: rendered.pageCount, pdf: rendered.pdf };
}

export async function persistCourseSourcePreviewPdf(sourceId: string, pdf: Buffer) {
  const path = courseSourcePreviewPdfPath(sourceId);
  const sha256 = createHash('sha256').update(pdf).digest('hex');
  const data = Uint8Array.from(pdf);
  return prisma.asset.upsert({
    where: { path },
    create: {
      path,
      mimeType: 'application/pdf',
      sizeBytes: pdf.byteLength,
      sha256,
      source: `course-source-preview:${sourceId}`,
      data,
    },
    update: {
      mimeType: 'application/pdf',
      sizeBytes: pdf.byteLength,
      sha256,
      source: `course-source-preview:${sourceId}`,
      data,
    },
    select: { id: true, path: true, sizeBytes: true },
  });
}
