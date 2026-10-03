/**
 * AI SDK tools that let the course chat assistant produce files:
 * Word documents, PDFs and images. Each created file is persisted as an
 * Asset and announced through `onArtifact` so the chat stream can emit a
 * `chat_artifact` event for the current assistant message.
 */
import { tool } from 'ai';
import { z } from 'zod';

import { createLogger } from '@/lib/logger';
import type { ChatFileArtifact } from '@/lib/types/chat';

import {
  collectImageAssetIds,
  parseMarkdownBlocks,
  type ChatDocumentImages,
} from './markdown-blocks';
import { loadChatArtifactForUser, saveChatArtifact, type ChatArtifactDb } from './store';

const log = createLogger('ChatArtifactTools');

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_EMBEDDED_IMAGES = 8;

export type CreateChatArtifactToolsArgs = {
  db: ChatArtifactDb;
  courseId: string;
  userId: string;
  courseName?: string;
  /** Called once per saved file, in creation order. */
  onArtifact: (artifact: ChatFileArtifact) => void | Promise<void>;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadEmbeddedImages(
  args: CreateChatArtifactToolsArgs,
  markdown: string,
): Promise<{ images: ChatDocumentImages; missing: string[] }> {
  const ids = collectImageAssetIds(parseMarkdownBlocks(markdown)).slice(0, MAX_EMBEDDED_IMAGES);
  const images: ChatDocumentImages = {};
  const missing: string[] = [];
  for (const assetId of ids) {
    const loaded = await loadChatArtifactForUser({
      db: args.db,
      courseId: args.courseId,
      artifactId: assetId,
      userId: args.userId,
    });
    if (loaded?.artifact.fileKind === 'image') {
      images[assetId] = { buffer: loaded.data, mimeType: loaded.artifact.mimeType };
    } else {
      missing.push(assetId);
    }
  }
  return { images, missing };
}

export function createChatArtifactTools(args: CreateChatArtifactToolsArgs) {
  return {
    create_document: tool({
      description: [
        'Create a downloadable Word (.docx) and/or PDF file from Markdown, e.g. worksheets, handouts, lesson plans, quizzes, study notes or summaries the user asked to download.',
        'Write the full document content in `markdown`: # / ## / ### headings, paragraphs, **bold**, *italic*, lists (one nesting level), GFM tables, fenced code, > quotes.',
        'Write every formula as LaTeX: inline $...$ and display $$...$$ (never plain-text math or Unicode-only formulas).',
        'Insert `<!-- pagebreak -->` on its own line to start a new page. For worksheets put the answer key / 参考答案 after a `<!-- pagebreak -->` so the student sheet prints without answers.',
        'To embed an image created earlier with generate_image in this chat, use ![caption](asset:ASSET_ID) with the assetId it returned.',
        "Use format 'docx' when the user wants an editable Word file, 'pdf' for print-ready output, 'both' when unspecified and both are useful.",
        'Only tell the user a file was created after this tool returns success: true; if it returns success: false, say it failed and why. Do not paste links — the file appears as a download card in the chat automatically.',
      ].join(' '),
      inputSchema: z.object({
        title: z.string().trim().min(1).max(120).describe('Document title shown at the top.'),
        format: z.enum(['docx', 'pdf', 'both']).default('docx'),
        markdown: z.string().min(1).max(80_000).describe('Complete document body in Markdown.'),
        fileName: z
          .string()
          .trim()
          .max(100)
          .optional()
          .describe('Optional file name without extension; defaults to the title.'),
      }),
      execute: async ({ title, format, markdown, fileName }) => {
        try {
          const { images, missing } = await loadEmbeddedImages(args, markdown);
          const baseName = fileName?.trim() || title;
          const kinds: Array<'docx' | 'pdf'> = format === 'both' ? ['docx', 'pdf'] : [format];
          const files: Array<{
            title: string;
            fileName: string;
            fileKind: 'docx' | 'pdf';
            sizeBytes: number;
          }> = [];
          // Render and validate every requested format before saving any of them, so a
          // failed format never leaves a half-delivered set of download cards.
          const rendered: Array<{ kind: 'docx' | 'pdf'; buffer: Buffer }> = [];
          for (const kind of kinds) {
            rendered.push({
              kind,
              buffer:
                kind === 'docx'
                  ? await (await import('./docx')).renderMarkdownToDocx({ title, markdown, images })
                  : await (await import('./pdf')).renderMarkdownToPdf({ title, markdown, images }),
            });
          }
          for (const { kind, buffer } of rendered) {
            const artifact = await saveChatArtifact({
              db: args.db,
              courseId: args.courseId,
              userId: args.userId,
              fileKind: kind,
              title,
              fileName: `${baseName}.${kind}`,
              mimeType: kind === 'docx' ? DOCX_MIME : 'application/pdf',
              buffer,
            });
            await args.onArtifact(artifact);
            files.push({
              title: artifact.title,
              fileName: artifact.fileName,
              fileKind: kind,
              sizeBytes: artifact.sizeBytes,
            });
          }
          return {
            success: true as const,
            files,
            ...(missing.length
              ? {
                  warning: `These image asset ids were not found and were left as placeholders: ${missing.join(', ')}`,
                }
              : {}),
            note: 'The files are shown to the user as download cards; do not invent links.',
          };
        } catch (error) {
          log.warn('create_document failed', error);
          return { success: false as const, error: errorMessage(error) };
        }
      },
    }),
    generate_image: tool({
      description: [
        'Generate one illustration/diagram-style image from a detailed text prompt (e.g. a concept illustration, scene, poster or visual aid) when the user explicitly asks for an image.',
        'Each call costs the user credits — generate only what was asked, one image per call.',
        'Image models cannot render precise formulas, labels or long text reliably; keep text in the image minimal and explain math in the chat or in a document instead.',
        'The returned assetId can be embedded into a create_document call as ![caption](asset:ASSET_ID).',
        'Only tell the user an image was created after this tool returns success: true. Do not paste links — the image appears in the chat automatically.',
      ].join(' '),
      inputSchema: z.object({
        prompt: z
          .string()
          .trim()
          .min(3)
          .max(4000)
          .describe('Detailed visual description (subject, style, composition, colors).'),
        aspectRatio: z.enum(['1:1', '4:3', '16:9', '9:16']).optional(),
        title: z.string().trim().min(1).max(120).describe('Short caption / file title.'),
      }),
      execute: async ({ prompt, aspectRatio, title }) => {
        try {
          const { generateChatImage } = await import('./image');
          const image = await generateChatImage({
            prompt,
            aspectRatio,
            userId: args.userId,
            courseId: args.courseId,
            courseName: args.courseName,
          });
          const artifact = await saveChatArtifact({
            db: args.db,
            courseId: args.courseId,
            userId: args.userId,
            fileKind: 'image',
            title,
            fileName: title,
            mimeType: image.mimeType,
            buffer: image.buffer,
          });
          await args.onArtifact(artifact);
          return {
            success: true as const,
            assetId: artifact.id,
            title: artifact.title,
            width: image.width,
            height: image.height,
          };
        } catch (error) {
          log.warn('generate_image failed', error);
          return { success: false as const, error: errorMessage(error) };
        }
      },
    }),
  };
}

export type ChatArtifactTools = ReturnType<typeof createChatArtifactTools>;
