'use client';

import { uploadFileToOpenAI, type StagedOpenAIFile } from '@/lib/uploads/openai-file-upload-client';
import {
  normalizedCourseSourceMimeType,
  courseSourceFileValidationError,
} from '@/lib/uploads/course-source-policy';
import type { PdfSourceSelection } from '@/lib/pdf/page-selection';

const uploads = new WeakMap<File, { createdAt: number; file: StagedOpenAIFile }>();

export async function prepareNotebookOriginalFile(args: {
  file: File;
  signal?: AbortSignal;
  selection?: PdfSourceSelection;
}) {
  const error = courseSourceFileValidationError(args.file);
  if (error) throw new Error(error);
  const cached = uploads.get(args.file);
  let uploaded = cached && Date.now() - cached.createdAt < 90 * 60_000 ? cached.file : undefined;
  if (!uploaded) {
    const file = new File([args.file], args.file.name, {
      type: normalizedCourseSourceMimeType(args.file),
    });
    uploaded = await uploadFileToOpenAI({ file, intent: 'course_source', signal: args.signal });
    uploads.set(args.file, { createdAt: Date.now(), file: uploaded });
  }
  return {
    text: `参考资料原文件：${args.file.name}。请直接阅读附加原文件中的正文、公式和图表。${args.selection ? `只使用以下选定页面：${JSON.stringify(args.selection.pages.filter((page) => page.keep).map((page) => page.pageNumber))}。` : ''}`,
    sourceFileToken: uploaded.fileToken,
    imageCount: 0,
    imagePreviews: [],
    imageDuplicateCount: 0,
    pdfImages: [],
    imageMapping: {},
    warnings: [],
  };
}
