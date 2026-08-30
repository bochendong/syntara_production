'use client';

import { MAX_PDF_CONTENT_CHARS } from '@/lib/constants/generation';
import { parsePdfForGeneration, type PdfImageCaptureMode } from '@/lib/pdf/parse-for-generation';
import type { PdfSourceSelection } from '@/lib/pdf/page-selection';
import { useSettingsStore } from '@/lib/store/settings';
import type { ImageMapping, PdfImage } from '@/lib/types/generation';
import { loadImageMapping, storeImages } from '@/lib/utils/image-storage';
import {
  courseSourceFileKind,
  normalizedCourseSourceMimeType,
} from '@/lib/uploads/course-source-policy';

export function isPdfSourceFile(file: File): boolean {
  return courseSourceFileKind(file) === 'pdf';
}

export function isMarkdownSourceFile(file: File): boolean {
  return courseSourceFileKind(file) === 'markdown';
}

export function isPptxSourceFile(file: File): boolean {
  return courseSourceFileKind(file) === 'pptx';
}

export function isDocxSourceFile(file: File): boolean {
  return courseSourceFileKind(file) === 'docx';
}

export function isTextSourceFile(file: File): boolean {
  const kind = courseSourceFileKind(file);
  return kind === 'markdown' || kind === 'plain_text';
}

export function isImageSourceFile(file: File): boolean {
  return courseSourceFileKind(file) === 'image';
}

export async function parseMarkdownLikeGenerationInput(args: {
  file: File;
}): Promise<{ pdfText: string; truncationWarnings: string[] }> {
  const file = args.file;
  const kindLabel = isMarkdownSourceFile(file) ? 'Markdown' : 'TXT';
  if (!(file instanceof File) || file.size === 0) {
    throw new Error(`${kindLabel} 文件无效或为空`);
  }
  const raw = (await file.text()).replace(/\u0000/g, '').trim();
  if (!raw) {
    throw new Error(`${kindLabel} 文件为空，无法用于生成`);
  }
  const truncationWarnings: string[] = [];
  let pdfText = raw;
  if (pdfText.length > MAX_PDF_CONTENT_CHARS) {
    pdfText = pdfText.substring(0, MAX_PDF_CONTENT_CHARS);
    truncationWarnings.push(`正文已截断至前 ${MAX_PDF_CONTENT_CHARS} 字符`);
  }
  return { pdfText, truncationWarnings };
}

export async function parseDocxLikeGenerationInput(args: {
  file: File;
  signal?: AbortSignal;
}): Promise<{ pdfText: string; truncationWarnings: string[] }> {
  const formData = new FormData();
  formData.set('file', args.file);
  const response = await fetch('/api/parse-docx', {
    method: 'POST',
    body: formData,
    signal: args.signal,
  });
  const payload = (await response.json().catch(() => null)) as {
    text?: unknown;
    error?: unknown;
  } | null;
  if (!response.ok || typeof payload?.text !== 'string') {
    throw new Error(
      typeof payload?.error === 'string'
        ? payload.error
        : `DOCX 解析失败（HTTP ${response.status}）`,
    );
  }
  let pdfText = payload.text.replace(/\u0000/g, '').trim();
  if (!pdfText) throw new Error('DOCX 文件没有可读取的正文。');
  const truncationWarnings: string[] = [];
  if (pdfText.length > MAX_PDF_CONTENT_CHARS) {
    pdfText = pdfText.substring(0, MAX_PDF_CONTENT_CHARS);
    truncationWarnings.push(`正文已截断至前 ${MAX_PDF_CONTENT_CHARS} 字符`);
  }
  return { pdfText, truncationWarnings };
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('图片读取失败'));
    reader.onerror = () => reject(reader.error || new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
}

export async function parseImageLikeGenerationInput(args: { file: File }): Promise<{
  pdfText: string;
  pdfImages: PdfImage[];
  imageStorageIds: string[];
  imageMapping: ImageMapping;
  truncationWarnings: string[];
}> {
  const src = await readFileAsDataUrl(args.file);
  const id = 'source_image_1';
  const imageStorageIds = await storeImages([{ id, src, pageNumber: 1 }]);
  const imageMapping = await loadImageMapping(imageStorageIds);
  const pdfImages: PdfImage[] = [
    {
      id,
      src: '',
      pageNumber: 1,
      storageId: imageStorageIds[0],
      description: `用户上传的课程图片：${args.file.name}（${normalizedCourseSourceMimeType(args.file, 'image')}）`,
    },
  ];
  return {
    pdfText: `用户上传了一张课程资料图片：${args.file.name}。请直接阅读图片内容，并将图片中的文字、公式、图表和结构作为生成依据。`,
    pdfImages,
    imageStorageIds,
    imageMapping,
    truncationWarnings: [],
  };
}

export async function parsePdfLikeGenerationPreview(args: {
  pdfFile: File;
  signal?: AbortSignal;
  language?: 'zh-CN' | 'en-US';
  sourcePageSelection?: PdfSourceSelection;
  imageLimit?: number | null;
  imageCaptureMode?: PdfImageCaptureMode;
  forceBrowserParse?: boolean;
  includeVisualRegionImages?: boolean;
}): Promise<{
  pdfText: string;
  pdfImages: PdfImage[];
  imageStorageIds: string[];
  imageMapping: ImageMapping;
  truncationWarnings: string[];
}> {
  const settings = useSettingsStore.getState();
  const pdfFile = args.pdfFile;
  return parsePdfForGeneration({
    pdfFile,
    signal: args.signal,
    language: args.language || 'zh-CN',
    providerId: settings.pdfProviderId,
    providerConfig: settings.pdfProvidersConfig?.[settings.pdfProviderId]
      ? {
          apiKey: settings.pdfProvidersConfig[settings.pdfProviderId]?.apiKey,
          baseUrl: settings.pdfProvidersConfig[settings.pdfProviderId]?.baseUrl,
        }
      : undefined,
    selection: args.sourcePageSelection,
    imageLimit: args.imageLimit,
    imageCaptureMode: args.imageCaptureMode,
    forceBrowserParse: args.forceBrowserParse,
    includeVisualRegionImages: args.includeVisualRegionImages,
  });
}

export async function parsePptxLikeGenerationPreview(args: {
  pptxFile: File;
  signal?: AbortSignal;
}): Promise<{
  pdfText: string;
  pdfImages: PdfImage[];
  imageStorageIds: string[];
  imageMapping: ImageMapping;
  truncationWarnings: string[];
}> {
  const pptxFile = args.pptxFile;
  if (!(pptxFile instanceof File) || pptxFile.size === 0) {
    throw new Error('PPTX 文件无效或为空');
  }

  const parseFormData = new FormData();
  parseFormData.append('pptx', pptxFile);

  const parseResponse = await fetch('/api/parse-pptx', {
    method: 'POST',
    body: parseFormData,
    signal: args.signal,
  });

  if (!parseResponse.ok) {
    const errorData = await parseResponse.json().catch(() => ({ error: 'PPTX 解析失败' }));
    throw new Error((errorData as { error?: string }).error || 'PPTX 解析失败');
  }

  const parseResult = await parseResponse.json();
  if (!parseResult.success || !parseResult.data) {
    throw new Error('PPTX 解析失败');
  }

  let pdfText = parseResult.data.text as string;
  if (pdfText.length > MAX_PDF_CONTENT_CHARS) {
    pdfText = pdfText.substring(0, MAX_PDF_CONTENT_CHARS);
  }

  const rawPdfImages = parseResult.data.metadata?.pdfImages || [];
  const images = rawPdfImages.map(
    (img: {
      id: string;
      src?: string;
      pageNumber?: number;
      description?: string;
      width?: number;
      height?: number;
    }) => ({
      id: img.id,
      src: img.src || '',
      pageNumber: img.pageNumber || 1,
      description: img.description,
      width: img.width,
      height: img.height,
    }),
  );

  const imageStorageIds = await storeImages(images);
  const pdfImages: PdfImage[] = images.map(
    (
      img: {
        id: string;
        src: string;
        pageNumber: number;
        description?: string;
        width?: number;
        height?: number;
      },
      i: number,
    ) => ({
      id: img.id,
      src: '',
      pageNumber: img.pageNumber,
      description: img.description,
      width: img.width,
      height: img.height,
      storageId: imageStorageIds[i],
    }),
  );
  const imageMapping = await loadImageMapping(imageStorageIds);

  const truncationWarnings: string[] = [];
  if ((parseResult.data.text as string).length > MAX_PDF_CONTENT_CHARS) {
    truncationWarnings.push(`正文已截断至前 ${MAX_PDF_CONTENT_CHARS} 字符`);
  }

  return { pdfText, pdfImages, imageStorageIds, imageMapping, truncationWarnings };
}
