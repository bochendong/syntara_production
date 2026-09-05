import crypto from 'node:crypto';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { createLogger } from '@/lib/logger';
import {
  createEmbedding,
  createEmbeddings,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from '@/lib/server/embedding-client';

const log = createLogger('StudyMemoryVectorStore');

const EMBEDDING_MODEL = DEFAULT_EMBEDDING_MODEL;
const EMBEDDING_DIMENSIONS = DEFAULT_EMBEDDING_DIMENSIONS;
const MAX_CHUNK_CHARS = 1200;
const CHUNK_OVERLAP_CHARS = 180;

type IndexableStudyMemoryRecord = {
  id: string;
  ownerId: string;
  courseId: string | null;
  notebookId: string | null;
  targetType: string;
  scope: string;
  status: string;
  source: string;
  title: string;
  text: string;
  reason: string | null;
  question: string | null;
  sourceReferences: unknown;
};

type ExistingChunkRow = {
  chunkIndex: number;
  contentHash: string;
  embeddingModel: string;
  embeddingDimensions: number;
};

type RawSearchRow = {
  id: string;
  memoryId: string;
  ownerId: string;
  courseId: string | null;
  notebookId: string | null;
  targetType: string;
  scope: string;
  chunkIndex: number;
  chunkText: string;
  similarity: number | string;
  title: string;
  text: string;
  reason: string | null;
  question: string | null;
  sourceReferences: unknown;
  updatedAt: Date | string;
};

export type StudyMemorySemanticMatch = {
  chunkId: string;
  memoryId: string;
  ownerId: string;
  courseId: string | null;
  notebookId: string | null;
  targetType: string;
  scope: string;
  chunkIndex: number;
  chunkText: string;
  similarity: number;
  title: string;
  text: string;
  reason: string | null;
  question: string | null;
  sourceReferences: unknown;
  updatedAt: string;
};

function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stableJson(value: unknown): string {
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function contentHash(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function chunkHash(
  memory: IndexableStudyMemoryRecord,
  chunkText: string,
  chunkIndex: number,
): string {
  return contentHash(
    [
      memory.id,
      memory.title,
      memory.reason || '',
      memory.question || '',
      stableJson(memory.sourceReferences),
      chunkIndex,
      chunkText,
    ].join('\n'),
  );
}

function splitMemoryText(
  memory: IndexableStudyMemoryRecord,
): Array<{ chunkIndex: number; text: string }> {
  const sourceReferences = stableJson(memory.sourceReferences);
  const fullText = normalizeText(
    [
      `Title: ${memory.title}`,
      memory.reason ? `Reason: ${memory.reason}` : '',
      memory.question ? `Question: ${memory.question}` : '',
      memory.text,
      sourceReferences ? `Source references: ${sourceReferences}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  );

  if (!fullText) return [];
  if (fullText.length <= MAX_CHUNK_CHARS) return [{ chunkIndex: 0, text: fullText }];

  const chunks: Array<{ chunkIndex: number; text: string }> = [];
  let start = 0;
  while (start < fullText.length) {
    const hardEnd = Math.min(fullText.length, start + MAX_CHUNK_CHARS);
    const slice = fullText.slice(start, hardEnd);
    const softBreak = Math.max(
      slice.lastIndexOf('\n\n'),
      slice.lastIndexOf('。'),
      slice.lastIndexOf('. '),
    );
    const end = softBreak > MAX_CHUNK_CHARS * 0.55 ? start + softBreak + 1 : hardEnd;
    const text = fullText.slice(start, end).trim();
    if (text) chunks.push({ chunkIndex: chunks.length, text });
    if (end >= fullText.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP_CHARS);
  }
  return chunks;
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}

export async function indexStudyMemoryRecord(
  prisma: PrismaClient,
  memory: IndexableStudyMemoryRecord,
): Promise<{ indexed: boolean; chunks: number; reason?: string }> {
  if (memory.status === 'archived') {
    await prisma.$executeRawUnsafe(
      'DELETE FROM "StudyMemoryChunk" WHERE "memoryId" = $1',
      memory.id,
    );
    return { indexed: false, chunks: 0, reason: 'archived' };
  }

  const chunks = splitMemoryText(memory);
  if (chunks.length === 0) return { indexed: false, chunks: 0, reason: 'empty' };

  const chunkHashes = chunks.map((chunk) => ({
    chunkIndex: chunk.chunkIndex,
    contentHash: chunkHash(memory, chunk.text, chunk.chunkIndex),
  }));
  const existing = await prisma.$queryRawUnsafe<ExistingChunkRow[]>(
    `
      SELECT "chunkIndex", "contentHash", "embeddingModel", "embeddingDimensions"
      FROM "StudyMemoryChunk"
      WHERE "memoryId" = $1 AND "embeddingModel" = $2 AND "embeddingDimensions" = $3
      ORDER BY "chunkIndex" ASC
    `,
    memory.id,
    EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS,
  );
  const alreadyIndexed =
    existing.length === chunkHashes.length &&
    chunkHashes.every((chunk, index) => existing[index]?.contentHash === chunk.contentHash);
  if (alreadyIndexed) return { indexed: false, chunks: chunks.length, reason: 'unchanged' };

  const embeddingResult = await createEmbeddings(
    chunks.map((chunk) => chunk.text),
    { model: EMBEDDING_MODEL, dimensions: EMBEDDING_DIMENSIONS },
  );
  if (embeddingResult.embeddings.some((embedding) => !embedding)) {
    return {
      indexed: false,
      chunks: 0,
      reason:
        embeddingResult.reason === 'dimension_mismatch'
          ? 'embedding_dimension_mismatch'
          : 'embedding_unavailable',
    };
  }
  const embeddings = embeddingResult.embeddings as number[][];

  const insertRows = chunks.map((chunk) => ({
    id: `memory_chunk_${crypto.randomUUID().replace(/-/g, '')}`,
    memoryId: memory.id,
    ownerId: memory.ownerId,
    courseId: memory.courseId,
    notebookId: memory.notebookId,
    targetType: memory.targetType,
    scope: memory.scope,
    chunkIndex: chunk.chunkIndex,
    chunkText: chunk.text,
    contentHash: chunkHashes[chunk.chunkIndex]?.contentHash || contentHash(chunk.text),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: EMBEDDING_DIMENSIONS,
    embedding: vectorLiteral(embeddings[chunk.chunkIndex] || []),
  }));
  const indexed = await prisma.$transaction(async (tx) => {
    // Embeddings were prepared outside the transaction. Lock and recheck the
    // source before publishing so late indexing never restores deleted/stale text.
    const source = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "StudyMemory" WHERE "id" = ${memory.id}
        AND "ownerId" = ${memory.ownerId} AND "status" = 'active'
        AND "text" = ${memory.text} AND "title" = ${memory.title}
        AND "scope" = ${memory.scope} AND "targetType" = ${memory.targetType}
      FOR UPDATE`;
    if (!source.length) return false;
    await tx.$executeRawUnsafe(
      `
        DELETE FROM "StudyMemoryChunk"
        WHERE "memoryId" = $1 AND "embeddingModel" = $2 AND "embeddingDimensions" = $3
      `,
      memory.id,
      EMBEDDING_MODEL,
      EMBEDDING_DIMENSIONS,
    );
    await tx.$executeRawUnsafe(
      `
        INSERT INTO "StudyMemoryChunk" (
          "id", "memoryId", "ownerId", "courseId", "notebookId",
          "targetType", "scope", "chunkIndex", "chunkText", "contentHash",
          "embeddingModel", "embeddingDimensions", "embedding", "createdAt", "updatedAt"
        )
        SELECT
          row."id",
          row."memoryId",
          row."ownerId",
          row."courseId",
          row."notebookId",
          row."targetType",
          row."scope",
          row."chunkIndex",
          row."chunkText",
          row."contentHash",
          row."embeddingModel",
          row."embeddingDimensions",
          row."embedding"::vector,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        FROM jsonb_to_recordset($1::jsonb) AS row(
          "id" text,
          "memoryId" text,
          "ownerId" text,
          "courseId" text,
          "notebookId" text,
          "targetType" text,
          "scope" text,
          "chunkIndex" integer,
          "chunkText" text,
          "contentHash" text,
          "embeddingModel" text,
          "embeddingDimensions" integer,
          "embedding" text
        )
      `,
      JSON.stringify(insertRows),
    );
    return true;
  });

  return {
    indexed,
    chunks: indexed ? chunks.length : 0,
    reason: indexed ? undefined : 'source_changed',
  };
}

export async function indexStudyMemoryRecords(
  prisma: PrismaClient,
  memories: IndexableStudyMemoryRecord[],
): Promise<{ indexed: number; skipped: number; chunks: number }> {
  let indexed = 0;
  let skipped = 0;
  let chunks = 0;
  for (const memory of memories) {
    try {
      const result = await indexStudyMemoryRecord(prisma, memory);
      if (result.indexed) indexed += 1;
      else skipped += 1;
      chunks += result.chunks;
    } catch (error) {
      skipped += 1;
      log.warn('Failed to index study memory:', { memoryId: memory.id, error });
    }
  }
  return { indexed, skipped, chunks };
}

export async function backfillStudyMemoryVectorIndex(
  prisma: PrismaClient,
  options: { limit?: number } = {},
): Promise<{ scanned: number; indexed: number; skipped: number; chunks: number }> {
  const limit = Math.max(1, Math.min(options.limit ?? 500, 2000));
  const rows = await prisma.$queryRawUnsafe<IndexableStudyMemoryRecord[]>(
    `
      SELECT *
      FROM "StudyMemory"
      WHERE "status" = 'active'
      ORDER BY "updatedAt" DESC
      LIMIT $1
    `,
    limit,
  );
  const result = await indexStudyMemoryRecords(prisma, rows);
  return { scanned: rows.length, ...result };
}

export async function semanticSearchStudyMemoryChunks(args: {
  prisma: PrismaClient;
  query: string;
  viewerUserId: string;
  publicOwnerId: string;
  notebookId?: string | null;
  courseId?: string | null;
  limit?: number;
}): Promise<StudyMemorySemanticMatch[]> {
  const query = normalizeText(args.query).slice(0, 1600);
  if (!query) return [];

  const embedding = await createEmbedding(query, {
    model: EMBEDDING_MODEL,
    dimensions: EMBEDDING_DIMENSIONS,
  });
  if (!embedding || embedding.length !== EMBEDDING_DIMENSIONS) return [];

  const limit = Math.max(1, Math.min(args.limit ?? 8, 20));
  const rows = await args.prisma.$queryRawUnsafe<RawSearchRow[]>(
    `
      SELECT
        c."id",
        c."memoryId",
        c."ownerId",
        c."courseId",
        c."notebookId",
        c."targetType",
        c."scope",
        c."chunkIndex",
        c."chunkText",
        1 - (c."embedding" <=> $1::vector) AS "similarity",
        m."title",
        m."text",
        m."reason",
        m."question",
        m."sourceReferences",
        m."updatedAt"
      FROM "StudyMemoryChunk" c
      JOIN "StudyMemory" m ON m."id" = c."memoryId"
      WHERE
        m."status" = 'active'
        AND c."embeddingModel" = $2
        AND c."embeddingDimensions" = $3
        AND (
          (m."scope" = 'public' AND m."ownerId" = $4)
          OR (m."scope" = 'private' AND m."ownerId" = $5)
        )
        AND (
          ($6::text IS NOT NULL AND m."notebookId" = $6)
          OR ($7::text IS NOT NULL AND m."courseId" = $7)
          OR m."targetType" = 'platform'
        )
      ORDER BY c."embedding" <=> $1::vector
      LIMIT $8
    `,
    vectorLiteral(embedding),
    EMBEDDING_MODEL,
    EMBEDDING_DIMENSIONS,
    args.publicOwnerId,
    args.viewerUserId,
    args.notebookId || null,
    args.courseId || null,
    limit,
  );

  return rows.map((row) => ({
    chunkId: row.id,
    memoryId: row.memoryId,
    ownerId: row.ownerId,
    courseId: row.courseId,
    notebookId: row.notebookId,
    targetType: row.targetType,
    scope: row.scope,
    chunkIndex: row.chunkIndex,
    chunkText: row.chunkText,
    similarity: Number(row.similarity) || 0,
    title: row.title,
    text: row.text,
    reason: row.reason,
    question: row.question,
    sourceReferences: row.sourceReferences,
    updatedAt: new Date(row.updatedAt).toISOString(),
  }));
}
