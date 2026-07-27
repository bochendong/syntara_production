import { parsePdfForGeneration } from '@/lib/pdf/parse-for-generation';
import type { NotebookAttachmentInput } from './chat-page-types';

export const ATTACHMENT_ONLY_PLACEHOLDER = '（已上传附件）';

const TEXT_LIKE_MIME_PREFIXES = ['text/', 'application/json', 'application/xml'];
const TEXT_LIKE_FILE_EXT = [
  '.md',
  '.txt',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.sql',
  '.yaml',
  '.yml',
];

export function shouldImportIntoProblemBank(text: string): boolean {
  return /(导入到题库|题库导入|import to problem bank|import into problem bank)/i.test(text);
}

export function stripProblemBankImportCommand(text: string): string {
  return text
    .replace(/导入到题库[:：]?\s*/gi, '')
    .replace(/题库导入[:：]?\s*/gi, '')
    .replace(/import to problem bank[:：]?\s*/gi, '')
    .replace(/import into problem bank[:：]?\s*/gi, '')
    .trim();
}

function isPdfAttachment(attachment: NotebookAttachmentInput): boolean {
  const mimeType = attachment.mimeType.toLowerCase();
  const lowerName = attachment.name.toLowerCase();
  return mimeType === 'application/pdf' || lowerName.endsWith('.pdf');
}

export async function buildProblemBankImportPayload(args: {
  text: string;
  attachments: NotebookAttachmentInput[];
}): Promise<{
  source: 'chat' | 'pdf' | 'manual';
  text: string;
  warnings: string[];
  skippedAttachments: string[];
}> {
  const blocks: string[] = [];
  const warnings: string[] = [];
  const skippedAttachments: string[] = [];
  const trimmedText = args.text.trim();
  let hasPdf = false;

  if (trimmedText) {
    blocks.push(trimmedText);
  }

  for (const attachment of args.attachments) {
    const file = attachment.file;
    if (file && isPdfAttachment(attachment)) {
      const parsed = await parsePdfForGeneration({
        pdfFile: file,
        language: 'zh-CN',
      });
      const pdfText = parsed.pdfText.trim();
      if (pdfText) {
        blocks.push(`附件：${attachment.name}\n${pdfText}`);
      }
      warnings.push(
        ...parsed.truncationWarnings.map((warning) => `${attachment.name}: ${warning}`),
      );
      hasPdf = true;
      continue;
    }

    const excerpt = attachment.textExcerpt?.trim();
    if (excerpt) {
      blocks.push(`附件：${attachment.name}\n${excerpt}`);
      continue;
    }

    skippedAttachments.push(attachment.name);
  }

  const mergedText = blocks.filter(Boolean).join('\n\n---\n\n').trim();
  if (!mergedText) {
    throw new Error('没有可导入的文本内容，请上传 PDF / Markdown / TXT，或在消息里粘贴题目。');
  }

  return {
    source: hasPdf ? 'pdf' : args.attachments.length > 0 ? 'chat' : 'manual',
    text: mergedText,
    warnings,
    skippedAttachments,
  };
}

function isTextLikeFile(file: File): boolean {
  const mime = file.type || '';
  if (TEXT_LIKE_MIME_PREFIXES.some((p) => mime.startsWith(p))) return true;
  const lower = file.name.toLowerCase();
  return TEXT_LIKE_FILE_EXT.some((ext) => lower.endsWith(ext));
}

export function isNotebookPipelineSourceFile(file: File): boolean {
  const mime = (file.type || '').toLowerCase();
  const lower = file.name.toLowerCase();
  return (
    mime === 'application/pdf' ||
    lower.endsWith('.pdf') ||
    mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    lower.endsWith('.pptx') ||
    mime === 'text/markdown' ||
    mime === 'text/x-markdown' ||
    lower.endsWith('.md')
  );
}

export async function extractTextExcerpt(file: File): Promise<string | undefined> {
  if (!isTextLikeFile(file)) return undefined;
  try {
    const raw = await file.text();
    const cleaned = raw.replace(/\u0000/g, '').trim();
    if (!cleaned) return undefined;
    return cleaned.slice(0, 6000);
  } catch {
    return undefined;
  }
}

/** 将用户文字与附件摘录合并，供总控路由与创建笔记本生成使用 */
export function mergeOrchestratorPrompt(
  text: string,
  attachments: NotebookAttachmentInput[],
  skipPdfExcerptForFullPipeline = false,
): string {
  const t = text.trim();
  const useAttach = skipPdfExcerptForFullPipeline
    ? attachments.filter(
        (a) =>
          !(
            a.mimeType === 'application/pdf' ||
            a.name.toLowerCase().endsWith('.pdf') ||
            a.mimeType === 'text/markdown' ||
            a.mimeType === 'text/x-markdown' ||
            a.name.toLowerCase().endsWith('.md')
          ),
      )
    : attachments;
  if (useAttach.length === 0) {
    return t || (skipPdfExcerptForFullPipeline ? '请根据上传的文档创建笔记本。' : '');
  }
  const blocks = useAttach.map((a) => {
    const excerpt = a.textExcerpt?.trim();
    return `【附件：${a.name}】\n${excerpt || '（未能提取文本，请结合文件名与上方说明理解需求。）'}`;
  });
  if (!t) {
    return `请根据以下上传材料创建或组织笔记本内容：\n\n${blocks.join('\n\n')}`;
  }
  return `${t}\n\n---\n参考材料：\n\n${blocks.join('\n\n')}`;
}
