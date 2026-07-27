import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { deleteCourseSourceUpload } from '@/features/memory/server/source-upload-library';
import { findStoredCourseSource } from '@/features/memory/server/course-source-store';
import { scheduleUnlinkedCourseKnowledgeProjectionSync } from '@/lib/server/unlinked-course-knowledge-projection';
import { toPrismaJson, toPrismaNullableJson } from '@/lib/server/prisma-json';

export const maxDuration = 300;

const SOURCE_COVER_WIDTH = 1024;
const SOURCE_COVER_HEIGHT = 1448;
const SOURCE_COVER_PUBLIC_PREFIX = '/generated-source-covers';
const SOURCE_COVER_PUBLIC_ROOT = path.join(process.cwd(), 'public', 'generated-source-covers');

const coverOverlaySchema = z.object({
  title: z.string().trim().min(1).max(160),
  courseLabel: z.string().trim().max(80).default(''),
  routeTitle: z.string().trim().min(1).max(80),
  routeItems: z.array(z.string().trim().min(1).max(80)).max(3),
  sideTitle: z.string().trim().min(1).max(80),
  sideItems: z.array(z.string().trim().min(1).max(120)).max(4),
  footerTitle: z.string().trim().min(1).max(80),
  footerText: z.string().trim().min(1).max(320),
});

const updateCoverSchema = z.object({
  notebookId: z.string().trim().min(1).max(80),
  imageDataUrl: z
    .string()
    .min(32)
    .max(32 * 1024 * 1024),
  providerId: z.literal('openai-image'),
  model: z.literal('gpt-image-2'),
  prompt: z.string().trim().min(1).max(20_000),
  coverSpec: coverOverlaySchema,
});

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];
}

function safePathSegment(input: string, fallback: string): string {
  const value = input
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return value || fallback;
}

function parseImageDataUrl(value: string): Buffer | null {
  const match = value.match(/^data:image\/(?:png|jpeg|jpg|webp);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) return null;
  const encoded = match[1].replace(/\s+/g, '');
  if (!encoded || encoded.length % 4 !== 0) return null;
  const buffer = Buffer.from(encoded, 'base64');
  const canonicalInput = encoded.replace(/=+$/, '');
  const canonicalDecoded = buffer.toString('base64').replace(/=+$/, '');
  if (canonicalDecoded !== canonicalInput) return null;
  return buffer.length > 0 && buffer.length <= 24 * 1024 * 1024 ? buffer : null;
}

async function writeFileAtomically(filePath: string, data: Buffer): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, data, { flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => undefined);
  }
}

class CoverTargetChangedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoverTargetChangedError';
  }
}

function sourceCoverSlideJson(args: {
  previous: unknown;
  sourceHash: string;
  sourceTitle: string;
  topic: string | null;
  imagePath: string;
  promptHash: string;
  coverSpec: z.infer<typeof coverOverlaySchema>;
}): Record<string, unknown> {
  const previous = jsonRecord(args.previous);
  const previousSourceCover = jsonRecord(previous.sourceCover);
  const previousElements = Array.isArray(previous.elements) ? previous.elements : [];
  const imageElement = {
    id: `source-cover-image-${args.sourceHash.slice(0, 12)}`,
    type: 'image',
    src: args.imagePath,
    x: 0,
    y: 0,
    width: SOURCE_COVER_WIDTH,
    height: SOURCE_COVER_HEIGHT,
  };
  return {
    ...previous,
    id:
      typeof previous.id === 'string'
        ? previous.id
        : `source-cover-${args.sourceHash.slice(0, 12)}`,
    viewportSize: SOURCE_COVER_WIDTH,
    viewportRatio: SOURCE_COVER_WIDTH / SOURCE_COVER_HEIGHT,
    sourceCover: {
      ...previousSourceCover,
      kind: 'source_upload_cover',
      sourceHash: args.sourceHash,
      sourceTitle: args.sourceTitle,
      topic: args.topic,
      providerId: 'openai-image',
      model: 'gpt-image-2',
      promptHash: args.promptHash,
      coverSpec: args.coverSpec,
      generatedAt: new Date().toISOString(),
    },
    elements: [
      imageElement,
      ...previousElements.filter(
        (element) =>
          !element ||
          typeof element !== 'object' ||
          Array.isArray(element) ||
          (element as { type?: unknown }).type !== 'image',
      ),
    ],
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; sourceHash: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id, sourceHash: rawSourceHash } = await context.params;
    const sourceHash = rawSourceHash.trim();
    const payload = updateCoverSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const lookup = await findStoredCourseSource({
      prisma,
      userId: auth.userId,
      courseId: id,
      sourceHash,
    });
    if (!lookup.available) {
      return NextResponse.json({ error: '课程资料目录尚未完成数据库迁移。' }, { status: 409 });
    }
    if (!lookup.source) {
      return NextResponse.json({ error: 'Source upload not found' }, { status: 404 });
    }
    if (lookup.source.ingestStatus !== 'ready') {
      return NextResponse.json(
        {
          error:
            lookup.source.errorReason ||
            `资料尚未入库完成，当前状态：${lookup.source.ingestStatus}`,
        },
        { status: 409 },
      );
    }

    const notebook = await prisma.notebook.findFirst({
      where: {
        id: payload.data.notebookId,
        ownerId: auth.userId,
        courseId: id,
      },
      select: {
        id: true,
        name: true,
        coverSlideJson: true,
        markdownSections: {
          select: { sourceMeta: true },
        },
      },
    });
    if (!notebook) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    const sourceMetadata = jsonRecord(lookup.source.metadataJson);
    const metadataNotebookIds = stringArray(sourceMetadata.notebookIds);
    const sectionLinked = notebook.markdownSections.some((section) => {
      const sourceMeta = jsonRecord(section.sourceMeta);
      return sourceMeta.sourceHash === sourceHash || sourceMeta.uploadSourceHash === sourceHash;
    });
    if (!metadataNotebookIds.includes(notebook.id) && !sectionLinked) {
      return NextResponse.json(
        { error: 'Notebook is not linked to this source upload' },
        { status: 409 },
      );
    }

    const sourceImage = parseImageDataUrl(payload.data.imageDataUrl);
    if (!sourceImage) {
      return NextResponse.json(
        { error: 'imageDataUrl must contain a PNG, JPEG, or WebP image under 24 MB' },
        { status: 400 },
      );
    }
    const sharp = (await import('sharp')).default;
    let sourceMetadataImage;
    let png;
    try {
      sourceMetadataImage = await sharp(sourceImage).metadata();
      png = await sharp(sourceImage).png().toBuffer();
    } catch {
      return NextResponse.json(
        { error: 'imageDataUrl does not contain a valid PNG, JPEG, or WebP image' },
        { status: 400 },
      );
    }
    if (
      sourceMetadataImage.width !== SOURCE_COVER_WIDTH ||
      sourceMetadataImage.height !== SOURCE_COVER_HEIGHT
    ) {
      return NextResponse.json(
        {
          error: `Cover image must be exactly ${SOURCE_COVER_WIDTH}x${SOURCE_COVER_HEIGHT}`,
          actual: {
            width: sourceMetadataImage.width ?? null,
            height: sourceMetadataImage.height ?? null,
          },
        },
        { status: 400 },
      );
    }
    const imageDigest = createHash('sha256').update(png).digest('hex');
    const promptHash = createHash('sha256').update(payload.data.prompt).digest('hex');
    const courseSegment = safePathSegment(id, 'course');
    const notebookSegment = safePathSegment(notebook.id, 'notebook');
    const sourceSegment = safePathSegment(sourceHash.slice(0, 24), 'source');
    const fileName = `${sourceSegment}-${imageDigest.slice(0, 12)}.png`;
    const outputDir = path.join(SOURCE_COVER_PUBLIC_ROOT, courseSegment, notebookSegment);
    await fs.mkdir(outputDir, { recursive: true });
    await writeFileAtomically(path.join(outputDir, fileName), png);
    const imagePath = `${SOURCE_COVER_PUBLIC_PREFIX}/${courseSegment}/${notebookSegment}/${fileName}`;
    const generatedAt = new Date().toISOString();
    const cover = {
      status: 'generated',
      imagePath,
      providerId: payload.data.providerId,
      model: payload.data.model,
      reason: null,
      promptHash,
      generatedAt,
    };
    let memoryFactUpdated = false;
    try {
      const transactionResult = await prisma.$transaction(
        async (tx) => {
          // Re-read both records in the transaction so a concurrent source
          // delete/re-ingest or notebook move cannot redirect this cover.
          const currentSource = await tx.courseSource.findFirst({
            where: {
              id: lookup.source!.id,
              ownerId: auth.userId,
              courseId: id,
              sourceHash,
              ingestStatus: 'ready',
            },
            select: {
              id: true,
              title: true,
              topic: true,
              metadataJson: true,
              contentVersion: true,
            },
          });
          const currentNotebook = await tx.notebook.findFirst({
            where: {
              id: notebook.id,
              ownerId: auth.userId,
              courseId: id,
            },
            select: {
              id: true,
              coverSlideJson: true,
              contentVersion: true,
              markdownSections: {
                select: { sourceMeta: true },
              },
            },
          });
          if (!currentSource || !currentNotebook) {
            throw new CoverTargetChangedError(
              'The source upload or notebook changed while the cover was being prepared.',
            );
          }

          const currentSourceMetadata = jsonRecord(currentSource.metadataJson);
          const currentNotebookIds = stringArray(currentSourceMetadata.notebookIds);
          const currentlySectionLinked = currentNotebook.markdownSections.some((section) => {
            const sourceMeta = jsonRecord(section.sourceMeta);
            return (
              sourceMeta.sourceHash === sourceHash || sourceMeta.uploadSourceHash === sourceHash
            );
          });
          if (!currentNotebookIds.includes(currentNotebook.id) && !currentlySectionLinked) {
            throw new CoverTargetChangedError(
              'The notebook is no longer linked to this source upload.',
            );
          }

          const activeFact = await tx.memoryFact.findFirst({
            where: {
              ownerId: auth.userId,
              scopeType: 'course',
              scopeId: id,
              namespace: 'knowledge_graph',
              key: `source:${sourceHash}`,
              status: 'active',
            },
            orderBy: { validFrom: 'desc' },
            select: {
              id: true,
              valueJson: true,
              sourceRef: true,
              updatedAt: true,
            },
          });
          const nextSourceMetadata = {
            ...currentSourceMetadata,
            notebookIds: Array.from(new Set([...currentNotebookIds, currentNotebook.id])),
            knowledgeGraphFactIds: Array.from(
              new Set([
                ...stringArray(currentSourceMetadata.knowledgeGraphFactIds),
                ...(activeFact ? [activeFact.id] : []),
              ]),
            ),
            coverImagePath: imagePath,
            coverStatus: 'generated',
            coverProviderId: payload.data.providerId,
            coverModel: payload.data.model,
            coverPromptHash: promptHash,
            coverSpec: payload.data.coverSpec,
            coverUpdatedAt: generatedAt,
          };
          const nextCoverSlide = sourceCoverSlideJson({
            previous: currentNotebook.coverSlideJson,
            sourceHash,
            sourceTitle: currentSource.title,
            topic: currentSource.topic,
            imagePath,
            promptHash,
            coverSpec: payload.data.coverSpec,
          });

          const sourceUpdate = await tx.courseSource.updateMany({
            where: {
              id: currentSource.id,
              ownerId: auth.userId,
              courseId: id,
              sourceHash,
              ingestStatus: 'ready',
              contentVersion: currentSource.contentVersion,
            },
            data: {
              metadataJson: toPrismaJson(nextSourceMetadata),
              contentVersion: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          const notebookUpdate = await tx.notebook.updateMany({
            where: {
              id: currentNotebook.id,
              ownerId: auth.userId,
              courseId: id,
              contentVersion: currentNotebook.contentVersion,
            },
            data: {
              coverImagePath: imagePath,
              coverSlideJson: toPrismaNullableJson(nextCoverSlide),
              contentVersion: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          if (sourceUpdate.count !== 1 || notebookUpdate.count !== 1) {
            throw new CoverTargetChangedError(
              'The source upload or notebook changed while the cover was being saved.',
            );
          }

          if (activeFact) {
            const nextFactValue = {
              ...jsonRecord(activeFact.valueJson),
              cover,
            };
            const sourceRef = {
              ...jsonRecord(activeFact.sourceRef),
              coverRegeneration: {
                sourceHash,
                notebookId: currentNotebook.id,
                imagePath,
                model: payload.data.model,
              },
            };
            const factUpdate = await tx.memoryFact.updateMany({
              where: {
                id: activeFact.id,
                ownerId: auth.userId,
                scopeType: 'course',
                scopeId: id,
                namespace: 'knowledge_graph',
                key: `source:${sourceHash}`,
                status: 'active',
                updatedAt: activeFact.updatedAt,
              },
              data: {
                valueJson: toPrismaJson(nextFactValue),
                sourceRef: toPrismaNullableJson(sourceRef),
                updatedAt: new Date(),
              },
            });
            if (factUpdate.count !== 1) {
              throw new CoverTargetChangedError(
                'The source memory changed while the cover was being saved.',
              );
            }
            await tx.memoryFactEvent.create({
              data: {
                factId: activeFact.id,
                ownerId: auth.userId,
                scopeType: 'course',
                scopeId: id,
                namespace: 'knowledge_graph',
                key: `source:${sourceHash}`,
                eventType: 'confirmed',
                oldValueJson: toPrismaNullableJson(activeFact.valueJson),
                newValueJson: toPrismaNullableJson(nextFactValue),
                source: 'source-cover-regeneration',
                sourceRef: toPrismaNullableJson(sourceRef),
              },
            });
          }

          return { memoryFactUpdated: Boolean(activeFact) };
        },
        { maxWait: 15_000, timeout: 45_000 },
      );
      memoryFactUpdated = transactionResult.memoryFactUpdated;
    } catch (error) {
      if (error instanceof CoverTargetChangedError) {
        return NextResponse.json(
          { error: error.message, code: 'SOURCE_COVER_TARGET_CHANGED' },
          { status: 409 },
        );
      }
      throw error;
    }

    return NextResponse.json({
      ok: true,
      courseId: id,
      sourceHash,
      notebookId: notebook.id,
      cover,
      coverSpec: payload.data.coverSpec,
      memoryFactUpdated,
      image: {
        path: imagePath,
        width: SOURCE_COVER_WIDTH,
        height: SOURCE_COVER_HEIGHT,
        sha256: imageDigest,
      },
    });
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; sourceHash: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id, sourceHash } = await context.params;
    const preserveProblemsParam = new URL(request.url).searchParams.get('preserveProblems');
    if (preserveProblemsParam !== null && preserveProblemsParam !== '1') {
      return NextResponse.json(
        {
          error: 'Source deletion always preserves course problems.',
          code: 'PROBLEM_PRESERVATION_REQUIRED',
        },
        { status: 400 },
      );
    }

    const result = await deleteCourseSourceUpload({
      prisma,
      userId: auth.userId,
      courseId: id,
      sourceHash,
      preserveProblems: true,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Delete source upload failed';
      if (message === 'Course not found' || message === 'Source upload not found') {
        return NextResponse.json({ error: message }, { status: 404 });
      }
      throw error;
    });

    if (result instanceof NextResponse) return result;
    if (result.preservedProblems > 0) {
      scheduleUnlinkedCourseKnowledgeProjectionSync({
        prisma,
        courseId: id,
        ownerId: auth.userId,
        reason: 'course_source_deleted_preserve_problems',
      });
    }
    return NextResponse.json({ ok: true, result });
  });
}
