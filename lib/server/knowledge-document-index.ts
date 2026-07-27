import crypto from 'node:crypto';
import { Prisma, type PrismaClient } from '@/lib/server/generated-prisma';
import { createLogger } from '@/lib/logger';
import {
  createEmbedding,
  createEmbeddings,
  DEFAULT_EMBEDDING_DIMENSIONS,
  DEFAULT_EMBEDDING_MODEL,
} from '@/lib/server/embedding-client';

const log = createLogger('KnowledgeDocumentIndex');

const MAX_CHUNK_CHARS = 1400;
const CHUNK_OVERLAP_CHARS = 200;
const COURSE_SOURCE_INDEX_TRANSACTION_OPTIONS = {
  maxWait: 30_000,
  timeout: 300_000,
} as const;

export type KnowledgeDocumentType = 'course_source' | 'markdown_section' | 'problem';

type CourseSourceRow = {
  id: string;
  ownerId: string;
  title: string;
  kind: string;
  extractedText: string | null;
  metadataJson: unknown;
};

type KnowledgeQueryClient = PrismaClient | Prisma.TransactionClient;

type MarkdownSourceRow = {
  id: string;
  notebookId: string;
  notebookName: string | null;
  title: string;
  order: number;
  markdown: string;
  summary: string | null;
  updatedAt: Date | string;
};

type ProblemSourceRow = {
  id: string;
  notebookId: string | null;
  notebookName: string | null;
  title: string;
  type: string;
  status: string;
  tags: string[];
  difficulty: string;
  publicText: string;
  updatedAt: Date | string;
};

type IndexableKnowledgeDocument = {
  documentKey: string;
  documentType: KnowledgeDocumentType;
  sourceEntityType: 'CourseSource' | 'MarkdownNotebookSection' | 'NotebookProblem';
  sourceEntityId: string;
  notebookId: string | null;
  title: string;
  summary: string | null;
  content: string;
  contentHash: string;
  metadataJson: Record<string, unknown>;
  publishedAt: Date | string | null;
};

type PreparedChunk = {
  chunkIndex: number;
  chunkText: string;
  contentHash: string;
  tokenCount: number;
  embedding: number[] | null;
};

type RawHybridSearchRow = {
  chunkId: string;
  documentId: string;
  ownerId: string;
  courseId: string;
  courseSourceId: string | null;
  notebookId: string | null;
  documentType: string;
  visibility: string;
  sourceEntityType: string;
  sourceEntityId: string;
  title: string;
  summary: string | null;
  content: string;
  metadataJson: unknown;
  chunkIndex: number;
  chunkText: string;
  lexicalScore: number | string;
  semanticScore: number | string;
  score: number | string;
  updatedAt: Date | string;
};

type RawCoverageRow = {
  expectedCount: number | bigint | string;
  indexedCount: number | bigint | string;
  hasMismatch: boolean;
};

export type CourseKnowledgeIndexResult = {
  indexStatus: 'ready' | 'error' | 'indexing';
  indexed: boolean;
  documents: number;
  chunks: number;
  embeddedChunks: number;
  reason?:
    | 'course_source_not_found'
    | 'knowledge_tables_unavailable'
    | 'no_indexable_content'
    | 'embedding_disabled'
    | 'embedding_unavailable'
    | 'already_indexing'
    | 'index_lease_lost'
    | 'source_changed_during_index'
    | 'index_failed';
  errorReason?: string;
};

export type CourseKnowledgeSearchMatch = {
  chunkId: string;
  documentId: string;
  ownerId: string;
  courseId: string;
  courseSourceId: string | null;
  notebookId: string | null;
  documentType: KnowledgeDocumentType;
  visibility: string;
  sourceEntityType: string;
  sourceEntityId: string;
  title: string;
  summary: string | null;
  content: string;
  chunkIndex: number;
  chunkText: string;
  lexicalScore: number;
  semanticScore: number;
  score: number;
  metadata: Record<string, unknown>;
  updatedAt: string;
};

export type CourseKnowledgeSearchResult = {
  available: boolean;
  matches: CourseKnowledgeSearchMatch[];
  reason?: 'knowledge_tables_unavailable' | 'not_indexed' | 'search_failed';
};

function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function hashText(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function documentsFingerprint(documents: IndexableKnowledgeDocument[]): string {
  const comparable = documents
    .map((document) => ({
      documentKey: document.documentKey,
      documentType: document.documentType,
      sourceEntityType: document.sourceEntityType,
      sourceEntityId: document.sourceEntityId,
      notebookId: document.notebookId,
      title: document.title,
      summary: document.summary,
      contentHash: document.contentHash,
      metadataJson: document.metadataJson,
      publishedAt:
        document.publishedAt instanceof Date
          ? document.publishedAt.toISOString()
          : document.publishedAt,
    }))
    .sort((left, right) => left.documentKey.localeCompare(right.documentKey));
  return hashText(JSON.stringify(comparable));
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${hashText(value).slice(0, 32)}`;
}

function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 800);
  return String(error).slice(0, 800);
}

function isMissingKnowledgeTable(error: unknown): boolean {
  const record =
    error && typeof error === 'object' ? (error as Record<string, unknown>) : undefined;
  const meta =
    record?.meta && typeof record.meta === 'object'
      ? (record.meta as Record<string, unknown>)
      : undefined;
  const code = String(meta?.code || record?.code || '');
  const message = errorText(error);
  return (
    code === '42P01' ||
    (code === '42703' && /indexLease(?:Token|ExpiresAt)/i.test(message)) ||
    /relation\s+"?(?:KnowledgeDocument|KnowledgeChunk|CourseSource)"?\s+does not exist/i.test(
      message,
    )
  );
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

function renderPublicProblemContent(rawText: string): string {
  try {
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const lines: string[] = [];
    for (const key of ['stem', 'stemTemplate', 'statement', 'question', 'prompt']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) {
        lines.push(value.trim());
        break;
      }
    }
    if (Array.isArray(parsed.options)) {
      const options = parsed.options
        .map((option) => {
          if (!option || typeof option !== 'object') return '';
          const item = option as Record<string, unknown>;
          const id = typeof item.id === 'string' ? item.id.trim() : '';
          const label = typeof item.label === 'string' ? item.label.trim() : '';
          return label ? `${id ? `${id}. ` : ''}${label}` : '';
        })
        .filter(Boolean);
      if (options.length > 0) lines.push(options.join('\n'));
    }
    for (const key of ['functionSignature', 'starterCode', 'explanation']) {
      const value = parsed[key];
      if (typeof value === 'string' && value.trim()) lines.push(value.trim());
    }
    if (Array.isArray(parsed.constraints)) {
      lines.push(parsed.constraints.map(String).join('\n'));
    }
    if (Array.isArray(parsed.sampleIO)) {
      lines.push(JSON.stringify(parsed.sampleIO));
    }
    return normalizeText(lines.join('\n\n') || rawText);
  } catch {
    return normalizeText(rawText);
  }
}

function splitText(text: string): Array<{ chunkIndex: number; chunkText: string }> {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= MAX_CHUNK_CHARS) {
    return [{ chunkIndex: 0, chunkText: normalized }];
  }

  const chunks: Array<{ chunkIndex: number; chunkText: string }> = [];
  let start = 0;
  while (start < normalized.length) {
    const hardEnd = Math.min(normalized.length, start + MAX_CHUNK_CHARS);
    const slice = normalized.slice(start, hardEnd);
    const softBreak = Math.max(
      slice.lastIndexOf('\n\n'),
      slice.lastIndexOf('。'),
      slice.lastIndexOf('. '),
    );
    const end = softBreak > MAX_CHUNK_CHARS * 0.55 ? start + softBreak + 1 : hardEnd;
    const chunkText = normalized.slice(start, end).trim();
    if (chunkText) chunks.push({ chunkIndex: chunks.length, chunkText });
    if (end >= normalized.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP_CHARS);
  }
  return chunks;
}

function searchTerms(query: string): string[] {
  const normalized = query.normalize('NFKC').toLowerCase();
  const latin = normalized.match(/[a-z0-9_+\-]{2,}/g) || [];
  const han = normalized.match(/[\u3400-\u9fff]{2,}/g) || [];
  const terms = [...latin, ...han];
  return Array.from(new Set(terms)).slice(0, 32);
}

function pgvectorSupportsIterativeScan(version: string | null | undefined): boolean {
  const [major = 0, minor = 0] = String(version || '')
    .split('.')
    .map((part) => Number.parseInt(part, 10) || 0);
  return major > 0 || minor >= 8;
}

async function updateCourseSourceIndexState(
  prisma: PrismaClient,
  args: {
    courseSourceId: string;
    indexStatus: 'pending' | 'indexing' | 'ready' | 'error';
    errorReason?: string | null;
    indexed?: boolean;
    leaseToken?: string | null;
  },
): Promise<number> {
  return prisma.$executeRawUnsafe(
    `
      UPDATE "CourseSource"
      SET
        "indexStatus" = $2,
        "indexLeaseToken" = CASE WHEN $2 = 'indexing' THEN "indexLeaseToken" ELSE NULL END,
        "indexLeaseExpiresAt" = CASE
          WHEN $2 = 'indexing' THEN "indexLeaseExpiresAt"
          ELSE NULL
        END,
        "errorReason" = $3,
        "indexedAt" = CASE
          WHEN $4::boolean THEN CURRENT_TIMESTAMP
          WHEN $2 IN ('pending', 'error') THEN NULL
          ELSE "indexedAt"
        END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1
        AND ($5::text IS NULL OR "indexLeaseToken" = $5)
    `,
    args.courseSourceId,
    args.indexStatus,
    args.errorReason || null,
    Boolean(args.indexed),
    args.leaseToken || null,
  );
}

async function loadReadyCourseSource(args: {
  prisma: KnowledgeQueryClient;
  courseId: string;
  sourceHash: string;
  ownerId: string | null;
  forUpdate?: boolean;
  leaseToken?: string | null;
}): Promise<CourseSourceRow | null> {
  const rows = await args.prisma.$queryRawUnsafe<CourseSourceRow[]>(
    `
      SELECT "id", "ownerId", "title", "kind", "extractedText", "metadataJson"
      FROM "CourseSource"
      WHERE "courseId" = $1
        AND "sourceHash" = $2
        AND "ingestStatus" = 'ready'
        AND ($3::text IS NULL OR "ownerId" = $3)
        AND (
          $4::text IS NULL
          OR (
            "indexStatus" = 'indexing'
            AND "indexLeaseToken" = $4
          )
        )
      LIMIT 1
      ${args.forUpdate ? 'FOR UPDATE' : ''}
    `,
    args.courseId,
    args.sourceHash,
    args.ownerId,
    args.leaseToken || null,
  );
  return rows[0] || null;
}

export type CourseKnowledgeIndexClaim = {
  available: boolean;
  claimed: boolean;
  leaseToken: string | null;
};

export async function claimCourseSourceKnowledgeIndex(args: {
  prisma: PrismaClient;
  ownerId?: string | null;
  userId?: string | null;
  courseId: string;
  sourceHash: string;
  allowReady?: boolean;
}): Promise<CourseKnowledgeIndexClaim> {
  const ownerId = args.ownerId?.trim() || args.userId?.trim() || null;
  const leaseToken = crypto.randomUUID();
  try {
    const rows = await args.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      UPDATE "CourseSource"
      SET
        "indexStatus" = 'indexing',
        "indexLeaseToken" = $4,
        "indexLeaseExpiresAt" = CURRENT_TIMESTAMP + INTERVAL '15 minutes',
        "errorReason" = NULL,
        "indexedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "courseId" = $1
        AND "sourceHash" = $2
        AND "ingestStatus" = 'ready'
        AND ($3::text IS NULL OR "ownerId" = $3)
        AND (
          "indexStatus" IN ('pending', 'error')
          OR ($5::boolean AND "indexStatus" = 'ready')
          OR (
            "indexStatus" = 'indexing'
            AND (
              "indexLeaseToken" IS NULL
              OR "indexLeaseExpiresAt" IS NULL
              OR "indexLeaseExpiresAt" <= CURRENT_TIMESTAMP
            )
          )
        )
      RETURNING "id"
    `,
      args.courseId,
      args.sourceHash,
      ownerId,
      leaseToken,
      Boolean(args.allowReady),
    );
    return rows[0]
      ? { available: true, claimed: true, leaseToken }
      : { available: true, claimed: false, leaseToken: null };
  } catch (error) {
    if (isMissingKnowledgeTable(error)) {
      return { available: false, claimed: false, leaseToken: null };
    }
    throw error;
  }
}

async function loadSourceDocuments(args: {
  prisma: KnowledgeQueryClient;
  courseId: string;
  sourceHash: string;
  courseSource: CourseSourceRow;
}): Promise<IndexableKnowledgeDocument[]> {
  const [sections, problems] = await Promise.all([
    args.prisma.$queryRawUnsafe<MarkdownSourceRow[]>(
      `
        SELECT
          s."id",
          s."notebookId",
          n."name" AS "notebookName",
          s."title",
          s."order",
          s."markdown",
          s."summary",
          s."updatedAt"
        FROM "MarkdownNotebookSection" s
        INNER JOIN "Notebook" n ON n."id" = s."notebookId"
        WHERE COALESCE(s."courseId", n."courseId") = $1
          AND s."sourceMeta"->>'sourceHash' = $2
        ORDER BY s."order" ASC, s."updatedAt" DESC
      `,
      args.courseId,
      args.sourceHash,
    ),
    args.prisma.$queryRawUnsafe<ProblemSourceRow[]>(
      `
        SELECT
          p."id",
          p."notebookId",
          n."name" AS "notebookName",
          p."title",
          p."type"::text AS "type",
          p."status"::text AS "status",
          p."tags",
          p."difficulty"::text AS "difficulty",
          p."publicContentJson"::text AS "publicText",
          p."updatedAt"
        FROM "NotebookProblem" p
        LEFT JOIN "Notebook" n ON n."id" = p."notebookId"
        WHERE p."status" <> 'archived'
          AND COALESCE(p."courseId", n."courseId") = $1
          AND COALESCE(
            p."sourceMeta"->>'uploadSourceHash',
            p."sourceMeta"->>'sourceHash'
          ) = $2
        ORDER BY p."updatedAt" DESC
      `,
      args.courseId,
      args.sourceHash,
    ),
  ]);

  const sourceMetadata = jsonRecord(args.courseSource.metadataJson);
  const sourceText = normalizeText(args.courseSource.extractedText || '');
  const rawSourceIsSearchable =
    args.courseSource.kind !== 'problem_bank' && sourceMetadata.allQuestionUpload !== true;
  const courseSourceDocument: IndexableKnowledgeDocument | null =
    sourceText && rawSourceIsSearchable
      ? {
          documentKey: `course_source:${args.sourceHash}`,
          documentType: 'course_source',
          sourceEntityType: 'CourseSource',
          sourceEntityId: args.courseSource.id,
          notebookId: null,
          title: args.courseSource.title,
          summary: null,
          content: sourceText,
          contentHash: hashText(sourceText),
          metadataJson: {
            sourceHash: args.sourceHash,
            sourceKind: args.courseSource.kind,
          },
          publishedAt: null,
        }
      : null;

  const sectionDocuments = sections.map((row): IndexableKnowledgeDocument => {
    const content = normalizeText(
      [row.title, row.summary || '', row.markdown].filter(Boolean).join('\n\n'),
    );
    return {
      documentKey: `markdown_section:${row.id}`,
      documentType: 'markdown_section',
      sourceEntityType: 'MarkdownNotebookSection',
      sourceEntityId: row.id,
      notebookId: row.notebookId,
      title: row.title,
      summary: row.summary,
      content,
      contentHash: hashText(content),
      metadataJson: {
        notebookName: row.notebookName,
        order: row.order,
      },
      publishedAt: null,
    };
  });

  const problemDocuments = problems.map((row): IndexableKnowledgeDocument => {
    // Only the public problem payload is rendered or embedded. gradingJson and
    // NotebookProblemSecret are intentionally absent from the SELECT above.
    const publicContent = renderPublicProblemContent(row.publicText);
    const content = normalizeText(
      [row.title, row.notebookName || '', row.tags.join(' '), publicContent]
        .filter(Boolean)
        .join('\n\n'),
    );
    return {
      documentKey: `problem:${row.id}`,
      documentType: 'problem',
      sourceEntityType: 'NotebookProblem',
      sourceEntityId: row.id,
      notebookId: row.notebookId,
      title: row.title,
      summary: publicContent.slice(0, 600),
      content,
      contentHash: hashText(content),
      metadataJson: {
        notebookName: row.notebookName,
        problemType: row.type,
        status: row.status,
        tags: row.tags,
        difficulty: row.difficulty,
      },
      publishedAt: row.status === 'published' ? row.updatedAt : null,
    };
  });

  return [courseSourceDocument, ...sectionDocuments, ...problemDocuments].filter(
    (document): document is IndexableKnowledgeDocument => Boolean(document && document.content),
  );
}

/**
 * Rebuilds all searchable documents owned by one uploaded course source.
 * Missing/migrating index tables are reported as a result and never reject the
 * source upload request.
 */
export async function indexCourseSourceKnowledge(args: {
  prisma: PrismaClient;
  ownerId?: string | null;
  userId?: string | null;
  courseId: string;
  sourceHash: string;
  leaseToken?: string | null;
  embeddingMode?: 'provider' | 'disabled';
}): Promise<CourseKnowledgeIndexResult> {
  const ownerId = args.ownerId?.trim() || args.userId?.trim() || null;
  let leaseToken = args.leaseToken?.trim() || null;
  let courseSource: CourseSourceRow | null = null;

  try {
    if (!leaseToken) {
      const claim = await claimCourseSourceKnowledgeIndex({
        prisma: args.prisma,
        ownerId,
        courseId: args.courseId,
        sourceHash: args.sourceHash,
      });
      if (!claim.available) {
        return {
          indexStatus: 'error',
          indexed: false,
          documents: 0,
          chunks: 0,
          embeddedChunks: 0,
          reason: 'knowledge_tables_unavailable',
          errorReason: 'Course knowledge index tables are not installed.',
        };
      }
      if (!claim.claimed || !claim.leaseToken) {
        const existingSource = await loadReadyCourseSource({
          prisma: args.prisma,
          courseId: args.courseId,
          sourceHash: args.sourceHash,
          ownerId,
        });
        return existingSource
          ? {
              indexStatus: 'indexing',
              indexed: false,
              documents: 0,
              chunks: 0,
              embeddedChunks: 0,
              reason: 'already_indexing',
            }
          : {
              indexStatus: 'error',
              indexed: false,
              documents: 0,
              chunks: 0,
              embeddedChunks: 0,
              reason: 'course_source_not_found',
              errorReason: 'CourseSource not found for the requested course and source hash.',
            };
      }
      leaseToken = claim.leaseToken;
    }
    courseSource = await loadReadyCourseSource({
      prisma: args.prisma,
      courseId: args.courseId,
      sourceHash: args.sourceHash,
      ownerId,
      leaseToken,
    });
    if (!courseSource) {
      return {
        indexStatus: 'error',
        indexed: false,
        documents: 0,
        chunks: 0,
        embeddedChunks: 0,
        reason: 'index_lease_lost',
        errorReason: 'The course source index lease is no longer owned by this task.',
      };
    }
    const resolvedCourseSource = courseSource;

    await args.prisma.$queryRawUnsafe(
      `
        SELECT 1
        FROM "KnowledgeDocument" d
        CROSS JOIN "KnowledgeChunk" c
        WHERE false
      `,
    );

    const documents = await loadSourceDocuments({
      prisma: args.prisma,
      courseId: args.courseId,
      sourceHash: args.sourceHash,
      courseSource: resolvedCourseSource,
    });
    const sourceFingerprint = documentsFingerprint(documents);
    if (documents.length === 0) {
      let sourceChanged = false;
      await args.prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtext($1))::text AS "locked"',
          `knowledge-course:${args.courseId}`,
        );
        const freshCourseSource = await loadReadyCourseSource({
          prisma: tx,
          courseId: args.courseId,
          sourceHash: args.sourceHash,
          ownerId,
          forUpdate: true,
          leaseToken,
        });
        const freshDocuments = freshCourseSource
          ? await loadSourceDocuments({
              prisma: tx,
              courseId: args.courseId,
              sourceHash: args.sourceHash,
              courseSource: freshCourseSource,
            })
          : [];
        sourceChanged =
          !freshCourseSource || documentsFingerprint(freshDocuments) !== sourceFingerprint;
        if (sourceChanged) return;
        await tx.$executeRawUnsafe(
          'DELETE FROM "KnowledgeDocument" WHERE "courseSourceId" = $1',
          resolvedCourseSource.id,
        );
      }, COURSE_SOURCE_INDEX_TRANSACTION_OPTIONS);
      if (sourceChanged) {
        await updateCourseSourceIndexState(args.prisma, {
          courseSourceId: resolvedCourseSource.id,
          indexStatus: 'pending',
          errorReason: 'Source content changed while its search projection was being rebuilt.',
          leaseToken,
        });
        return {
          indexStatus: 'error',
          indexed: false,
          documents: 0,
          chunks: 0,
          embeddedChunks: 0,
          reason: 'source_changed_during_index',
          errorReason: 'Source content changed while its search projection was being rebuilt.',
        };
      }
      const settled = await updateCourseSourceIndexState(args.prisma, {
        courseSourceId: resolvedCourseSource.id,
        indexStatus: 'ready',
        errorReason: null,
        indexed: true,
        leaseToken,
      });
      if (settled === 0) {
        return {
          indexStatus: 'error',
          indexed: false,
          documents: 0,
          chunks: 0,
          embeddedChunks: 0,
          reason: 'index_lease_lost',
          errorReason: 'The course source index lease was superseded before completion.',
        };
      }
      return {
        indexStatus: 'ready',
        indexed: true,
        documents: 0,
        chunks: 0,
        embeddedChunks: 0,
        reason: 'no_indexable_content',
      };
    }

    const splitDocuments = documents.map((document) => ({
      document,
      chunks: splitText(document.content),
    }));
    const allChunkTexts = splitDocuments.flatMap(({ chunks }) =>
      chunks.map((chunk) => chunk.chunkText),
    );
    const embeddingsDisabled = args.embeddingMode === 'disabled';
    const embeddingResult = embeddingsDisabled
      ? { embeddings: [] as number[][], reason: 'embedding_disabled' as const }
      : await createEmbeddings(allChunkTexts, {
          model: DEFAULT_EMBEDDING_MODEL,
          dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
        });

    let embeddingCursor = 0;
    const prepared = splitDocuments.map(({ document, chunks }) => ({
      document,
      chunks: chunks.map((chunk): PreparedChunk => {
        const embedding = embeddingResult.embeddings[embeddingCursor] || null;
        embeddingCursor += 1;
        return {
          ...chunk,
          contentHash: hashText(chunk.chunkText),
          tokenCount: Math.max(1, Math.ceil(chunk.chunkText.length / 4)),
          embedding,
        };
      }),
    }));

    let sourceChanged = false;
    await args.prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(
        'SELECT pg_advisory_xact_lock(hashtext($1))::text AS "locked"',
        `knowledge-course:${args.courseId}`,
      );
      const freshCourseSource = await loadReadyCourseSource({
        prisma: tx,
        courseId: args.courseId,
        sourceHash: args.sourceHash,
        ownerId,
        forUpdate: true,
        leaseToken,
      });
      const freshDocuments = freshCourseSource
        ? await loadSourceDocuments({
            prisma: tx,
            courseId: args.courseId,
            sourceHash: args.sourceHash,
            courseSource: freshCourseSource,
          })
        : [];
      sourceChanged =
        !freshCourseSource || documentsFingerprint(freshDocuments) !== sourceFingerprint;
      if (sourceChanged) return;

      for (const item of prepared) {
        const documentId = stableId(
          'knowledge_document',
          `${args.courseId}:${item.document.documentKey}`,
        );
        const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `
            INSERT INTO "KnowledgeDocument" (
              "id", "ownerId", "courseId", "courseSourceId", "notebookId",
              "documentKey", "documentType", "sourceEntityType", "sourceEntityId",
              "visibility", "title", "summary", "content", "contentHash",
              "language", "status", "errorReason", "metadataJson",
              "contentVersion", "chunkCount", "publishedAt", "indexedAt",
              "createdAt", "updatedAt"
            )
            VALUES (
              $1, $2, $3, $4, $5,
              $6, $7, $8, $9,
              'course', $10, $11, $12, $13,
              NULL, 'ready', NULL, $14::jsonb,
              1, $15, $16, CURRENT_TIMESTAMP,
              CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            ON CONFLICT ("courseId", "documentKey") DO UPDATE SET
              "ownerId" = EXCLUDED."ownerId",
              "courseSourceId" = EXCLUDED."courseSourceId",
              "notebookId" = EXCLUDED."notebookId",
              "documentType" = EXCLUDED."documentType",
              "sourceEntityType" = EXCLUDED."sourceEntityType",
              "sourceEntityId" = EXCLUDED."sourceEntityId",
              "visibility" = EXCLUDED."visibility",
              "title" = EXCLUDED."title",
              "summary" = EXCLUDED."summary",
              "content" = EXCLUDED."content",
              "contentVersion" = CASE
                WHEN "KnowledgeDocument"."contentHash" = EXCLUDED."contentHash"
                  THEN "KnowledgeDocument"."contentVersion"
                ELSE "KnowledgeDocument"."contentVersion" + 1
              END,
              "contentHash" = EXCLUDED."contentHash",
              "status" = 'ready',
              "errorReason" = NULL,
              "metadataJson" = EXCLUDED."metadataJson",
              "chunkCount" = EXCLUDED."chunkCount",
              "publishedAt" = EXCLUDED."publishedAt",
              "indexedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP
            RETURNING "id"
          `,
          documentId,
          resolvedCourseSource.ownerId,
          args.courseId,
          resolvedCourseSource.id,
          item.document.notebookId,
          item.document.documentKey,
          item.document.documentType,
          item.document.sourceEntityType,
          item.document.sourceEntityId,
          item.document.title,
          item.document.summary,
          item.document.content,
          item.document.contentHash,
          JSON.stringify(item.document.metadataJson),
          item.chunks.length,
          item.document.publishedAt,
        );
        const persistedDocumentId = rows[0]?.id || documentId;

        await tx.$executeRawUnsafe(
          'DELETE FROM "KnowledgeChunk" WHERE "documentId" = $1',
          persistedDocumentId,
        );
        if (item.chunks.length > 0) {
          const chunkRows = item.chunks.map((chunk) => {
            const metadataJson = JSON.stringify({
              sourceEntityType: item.document.sourceEntityType,
              sourceEntityId: item.document.sourceEntityId,
            });
            return Prisma.sql`
              (
                ${stableId('knowledge_chunk', `${persistedDocumentId}:${chunk.chunkIndex}`)},
                ${persistedDocumentId},
                ${resolvedCourseSource.ownerId},
                ${args.courseId},
                ${resolvedCourseSource.id},
                ${item.document.notebookId},
                ${item.document.documentType},
                'course',
                ${chunk.chunkIndex},
                ${chunk.chunkText},
                ${chunk.contentHash},
                ${chunk.tokenCount},
                CAST(${metadataJson} AS JSONB),
                ${chunk.embedding ? DEFAULT_EMBEDDING_MODEL : null},
                ${chunk.embedding ? DEFAULT_EMBEDDING_DIMENSIONS : null},
                CAST(${chunk.embedding ? vectorLiteral(chunk.embedding) : null} AS vector),
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
              )
            `;
          });
          await tx.$executeRaw(Prisma.sql`
              INSERT INTO "KnowledgeChunk" (
                "id", "documentId", "ownerId", "courseId", "courseSourceId",
                "notebookId", "documentType", "visibility", "chunkIndex",
                "chunkText", "contentHash", "tokenCount", "metadataJson",
                "embeddingModel", "embeddingDimensions", "embedding",
                "createdAt", "updatedAt"
              )
              VALUES ${Prisma.join(chunkRows)}
          `);
        }
      }

      const documentKeys = documents.map((document) => document.documentKey);
      await tx.$executeRawUnsafe(
        `
          DELETE FROM "KnowledgeDocument"
          WHERE "courseSourceId" = $1
            AND NOT ("documentKey" = ANY($2::text[]))
        `,
        resolvedCourseSource.id,
        documentKeys,
      );
    }, COURSE_SOURCE_INDEX_TRANSACTION_OPTIONS);

    const chunks = prepared.reduce((count, item) => count + item.chunks.length, 0);
    const embeddedChunks = prepared.reduce(
      (count, item) => count + item.chunks.filter((chunk) => chunk.embedding !== null).length,
      0,
    );
    if (sourceChanged) {
      await updateCourseSourceIndexState(args.prisma, {
        courseSourceId: resolvedCourseSource.id,
        indexStatus: 'pending',
        errorReason: 'Source content changed while its search projection was being rebuilt.',
        leaseToken,
      });
      return {
        indexStatus: 'error',
        indexed: false,
        documents: documents.length,
        chunks,
        embeddedChunks,
        reason: 'source_changed_during_index',
        errorReason: 'Source content changed while its search projection was being rebuilt.',
      };
    }

    const settled = await updateCourseSourceIndexState(args.prisma, {
      courseSourceId: resolvedCourseSource.id,
      indexStatus: 'ready',
      errorReason: null,
      indexed: true,
      leaseToken,
    });

    if (settled === 0) {
      return {
        indexStatus: 'error',
        indexed: false,
        documents: documents.length,
        chunks,
        embeddedChunks,
        reason: 'index_lease_lost',
        errorReason: 'The course source index lease was superseded before completion.',
      };
    }
    return {
      indexStatus: 'ready',
      indexed: true,
      documents: documents.length,
      chunks,
      embeddedChunks,
      reason: embeddingsDisabled
        ? 'embedding_disabled'
        : embeddedChunks < chunks && embeddingResult.reason
          ? 'embedding_unavailable'
          : undefined,
    };
  } catch (error) {
    const missing = isMissingKnowledgeTable(error);
    const message = errorText(error);
    log.warn('Course source knowledge indexing failed:', {
      courseId: args.courseId,
      sourceHash: args.sourceHash,
      error,
    });
    if (courseSource && leaseToken) {
      try {
        await updateCourseSourceIndexState(args.prisma, {
          courseSourceId: courseSource.id,
          indexStatus: 'error',
          errorReason: message,
          leaseToken,
        });
      } catch {
        // The source table itself may be part of the missing migration.
      }
    }
    return {
      indexStatus: 'error',
      indexed: false,
      documents: 0,
      chunks: 0,
      embeddedChunks: 0,
      reason: missing ? 'knowledge_tables_unavailable' : 'index_failed',
      errorReason: message,
    };
  }
}

/**
 * Course is mandatory and is applied directly to KnowledgeChunk before ANN or
 * lexical ranking. The caller must already have authorized access to it.
 */
export async function searchCourseKnowledge(args: {
  prisma: PrismaClient;
  query: string;
  courseId: string;
  notebookId?: string | null;
  documentTypes?: KnowledgeDocumentType[];
  limit?: number;
}): Promise<CourseKnowledgeSearchResult> {
  const query = normalizeText(args.query).slice(0, 1800);
  if (!query || !args.courseId) {
    return { available: true, matches: [], reason: 'not_indexed' };
  }

  const documentTypes =
    args.documentTypes && args.documentTypes.length > 0
      ? args.documentTypes
      : (['course_source', 'markdown_section', 'problem'] satisfies KnowledgeDocumentType[]);
  const terms = searchTerms(query);
  const requestedLimit = Math.max(1, Math.min(args.limit ?? 8, 24));

  try {
    const coverageRows = await args.prisma.$queryRawUnsafe<RawCoverageRow[]>(
      `
        WITH expected_documents AS (
          SELECT 'course_source:' || source."sourceHash" AS "documentKey"
          FROM "CourseSource" source
          WHERE 'course_source' = ANY($3::text[])
            AND source."courseId" = $1
            AND source."ingestStatus" = 'ready'
            AND source."extractedText" IS NOT NULL
            AND length(trim(source."extractedText")) > 0
            AND source."kind" <> 'problem_bank'
            AND source."metadataJson"->>'allQuestionUpload' IS DISTINCT FROM 'true'
            AND $2::text IS NULL

          UNION ALL

          SELECT 'markdown_section:' || s."id" AS "documentKey"
          FROM "MarkdownNotebookSection" s
          INNER JOIN "Notebook" n ON n."id" = s."notebookId"
          WHERE 'markdown_section' = ANY($3::text[])
            AND (
              s."courseId" = $1
              OR (s."courseId" IS NULL AND n."courseId" = $1)
            )
            AND ($2::text IS NULL OR s."notebookId" = $2)

          UNION ALL

          SELECT 'problem:' || p."id" AS "documentKey"
          FROM "NotebookProblem" p
          LEFT JOIN "Notebook" n ON n."id" = p."notebookId"
          WHERE 'problem' = ANY($3::text[])
            AND p."status" <> 'archived'
            AND (
              p."courseId" = $1
              OR (p."courseId" IS NULL AND n."courseId" = $1)
            )
            AND ($2::text IS NULL OR p."notebookId" = $2)
        ),
        indexed_documents AS (
          SELECT d."documentKey"
          FROM "KnowledgeDocument" d
          WHERE d."courseId" = $1
            AND d."status" = 'ready'
            AND d."visibility" = 'course'
            AND d."documentType" = ANY($3::text[])
            AND ($2::text IS NULL OR d."notebookId" = $2)
            AND EXISTS (
              SELECT 1
              FROM "Course" indexed_course
              WHERE indexed_course."id" = d."courseId"
                AND indexed_course."ownerId" = d."ownerId"
            )
            AND (
              d."courseSourceId" IS NULL
              OR EXISTS (
                SELECT 1
                FROM "CourseSource" indexed_source
                WHERE indexed_source."id" = d."courseSourceId"
                  AND indexed_source."courseId" = d."courseId"
                  AND indexed_source."ownerId" = d."ownerId"
                  AND indexed_source."indexStatus" = 'ready'
              )
            )
            AND d."chunkCount" > 0
            AND d."chunkCount" = (
              SELECT COUNT(*)
              FROM "KnowledgeChunk" counted_chunk
              WHERE counted_chunk."documentId" = d."id"
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "KnowledgeChunk" invalid_chunk
              WHERE invalid_chunk."documentId" = d."id"
                AND (
                  invalid_chunk."ownerId" IS DISTINCT FROM d."ownerId"
                  OR invalid_chunk."courseId" IS DISTINCT FROM d."courseId"
                  OR invalid_chunk."courseSourceId" IS DISTINCT FROM d."courseSourceId"
                  OR invalid_chunk."notebookId" IS DISTINCT FROM d."notebookId"
                  OR invalid_chunk."documentType" IS DISTINCT FROM d."documentType"
                  OR invalid_chunk."visibility" IS DISTINCT FROM d."visibility"
                )
            )
        )
        SELECT
          (SELECT COUNT(*) FROM expected_documents) AS "expectedCount",
          (SELECT COUNT(*) FROM indexed_documents) AS "indexedCount",
          EXISTS (
            (
              SELECT "documentKey" FROM expected_documents
              EXCEPT
              SELECT "documentKey" FROM indexed_documents
            )
            UNION ALL
            (
              SELECT "documentKey" FROM indexed_documents
              EXCEPT
              SELECT "documentKey" FROM expected_documents
            )
          ) AS "hasMismatch"
      `,
      args.courseId,
      args.notebookId || null,
      documentTypes,
    );
    const coverage = coverageRows[0];
    const expectedCount = Number(coverage?.expectedCount || 0);
    const indexedCount = Number(coverage?.indexedCount || 0);
    if (expectedCount === 0) {
      return { available: true, matches: [], reason: 'not_indexed' };
    }
    if (coverage?.hasMismatch || indexedCount !== expectedCount) {
      return { available: false, matches: [], reason: 'not_indexed' };
    }

    const embedding = await createEmbedding(query, {
      model: DEFAULT_EMBEDDING_MODEL,
      dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    });
    const executeHybridQuery = (client: KnowledgeQueryClient) =>
      client.$queryRawUnsafe<RawHybridSearchRow[]>(
        `
        WITH lexical_candidates AS (
          SELECT
            c."id" AS "chunkId",
            (
              ts_rank_cd(
                to_tsvector('simple', c."chunkText"),
                plainto_tsquery('simple', $2)
              )
              + (
                SELECT COUNT(*)::float * 0.12
                FROM unnest($3::text[]) AS term
                WHERE c."chunkText" ILIKE ('%' || term || '%')
              )
            ) AS "lexicalScore"
          FROM "KnowledgeChunk" c
          INNER JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
          WHERE c."courseId" = $1
            AND d."courseId" = $1
            AND c."ownerId" = d."ownerId"
            AND c."courseSourceId" IS NOT DISTINCT FROM d."courseSourceId"
            AND c."notebookId" IS NOT DISTINCT FROM d."notebookId"
            AND c."documentType" = d."documentType"
            AND c."visibility" = 'course'
            AND d."visibility" = 'course'
            AND d."status" = 'ready'
            AND (
              d."courseSourceId" IS NULL
              OR EXISTS (
                SELECT 1
                FROM "CourseSource" lexical_source
                WHERE lexical_source."id" = d."courseSourceId"
                  AND lexical_source."ownerId" = d."ownerId"
                  AND lexical_source."courseId" = d."courseId"
                  AND lexical_source."indexStatus" = 'ready'
              )
            )
            AND c."documentType" = ANY($5::text[])
            AND ($6::text IS NULL OR c."notebookId" = $6)
            AND (
              to_tsvector('simple', c."chunkText") @@ plainto_tsquery('simple', $2)
              OR EXISTS (
                SELECT 1
                FROM unnest($3::text[]) AS term
                WHERE c."chunkText" ILIKE ('%' || term || '%')
              )
            )
          ORDER BY "lexicalScore" DESC
          LIMIT $7
        ),
        semantic_candidates AS (
          SELECT
            c."id" AS "chunkId",
            1 - (c."embedding" <=> $4::vector) AS "semanticScore"
          FROM "KnowledgeChunk" c
          INNER JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
          WHERE $4::text IS NOT NULL
            AND c."embedding" IS NOT NULL
            AND c."embeddingModel" = $8
            AND c."embeddingDimensions" = $9
            AND c."courseId" = $1
            AND d."courseId" = $1
            AND c."ownerId" = d."ownerId"
            AND c."courseSourceId" IS NOT DISTINCT FROM d."courseSourceId"
            AND c."notebookId" IS NOT DISTINCT FROM d."notebookId"
            AND c."documentType" = d."documentType"
            AND c."visibility" = 'course'
            AND d."visibility" = 'course'
            AND d."status" = 'ready'
            AND (
              d."courseSourceId" IS NULL
              OR EXISTS (
                SELECT 1
                FROM "CourseSource" semantic_source
                WHERE semantic_source."id" = d."courseSourceId"
                  AND semantic_source."ownerId" = d."ownerId"
                  AND semantic_source."courseId" = d."courseId"
                  AND semantic_source."indexStatus" = 'ready'
              )
            )
            AND c."documentType" = ANY($5::text[])
            AND ($6::text IS NULL OR c."notebookId" = $6)
          ORDER BY c."embedding" <=> $4::vector
          LIMIT $7
        ),
        candidate_scores AS (
          SELECT
            candidates."chunkId",
            MAX(candidates."lexicalScore") AS "lexicalScore",
            MAX(candidates."semanticScore") AS "semanticScore"
          FROM (
            SELECT
              "chunkId",
              "lexicalScore",
              0::float AS "semanticScore"
            FROM lexical_candidates
            UNION ALL
            SELECT
              "chunkId",
              0::float AS "lexicalScore",
              "semanticScore"
            FROM semantic_candidates
          ) candidates
          GROUP BY candidates."chunkId"
        ),
        candidates AS (
          SELECT
            c."id" AS "chunkId",
            c."documentId",
            c."ownerId",
            c."courseId",
            c."courseSourceId",
            c."notebookId",
            c."documentType",
            c."visibility",
            d."sourceEntityType",
            d."sourceEntityId",
            d."title",
            d."summary",
            LEFT(d."content", 9000) AS "content",
            d."metadataJson",
            c."chunkIndex",
            c."chunkText",
            d."updatedAt",
            scores."lexicalScore",
            scores."semanticScore"
          FROM candidate_scores scores
          INNER JOIN "KnowledgeChunk" c ON c."id" = scores."chunkId"
          INNER JOIN "KnowledgeDocument" d ON d."id" = c."documentId"
        )
        SELECT
          *,
          ("lexicalScore" * 0.45 + "semanticScore" * 0.55) AS "score"
        FROM candidates
        WHERE "lexicalScore" > 0 OR "semanticScore" >= 0.2
        ORDER BY "score" DESC, "updatedAt" DESC
        LIMIT $10
        `,
        args.courseId,
        query,
        terms,
        embedding ? vectorLiteral(embedding) : null,
        documentTypes,
        args.notebookId || null,
        requestedLimit * 4,
        DEFAULT_EMBEDDING_MODEL,
        DEFAULT_EMBEDDING_DIMENSIONS,
        requestedLimit * 4,
      );
    const rows = embedding
      ? await args.prisma.$transaction(async (tx) => {
          const versions = await tx.$queryRawUnsafe<Array<{ extversion: string }>>(
            `SELECT extversion FROM pg_extension WHERE extname = 'vector' LIMIT 1`,
          );
          if (pgvectorSupportsIterativeScan(versions[0]?.extversion)) {
            // pgvector 0.8+ can keep scanning a filtered HNSW index until the
            // selected course/notebook has enough candidates.
            await tx.$executeRawUnsafe(`SET LOCAL hnsw.iterative_scan = 'strict_order'`);
          }
          return executeHybridQuery(tx);
        })
      : await executeHybridQuery(args.prisma);

    const seenDocuments = new Set<string>();
    const matches: CourseKnowledgeSearchMatch[] = [];
    for (const row of rows) {
      if (seenDocuments.has(row.documentId)) continue;
      seenDocuments.add(row.documentId);
      matches.push({
        chunkId: row.chunkId,
        documentId: row.documentId,
        ownerId: row.ownerId,
        courseId: row.courseId,
        courseSourceId: row.courseSourceId,
        notebookId: row.notebookId,
        documentType:
          row.documentType === 'problem'
            ? 'problem'
            : row.documentType === 'course_source'
              ? 'course_source'
              : 'markdown_section',
        visibility: row.visibility,
        sourceEntityType: row.sourceEntityType,
        sourceEntityId: row.sourceEntityId,
        title: row.title,
        summary: row.summary,
        content: row.content,
        chunkIndex: row.chunkIndex,
        chunkText: row.chunkText,
        lexicalScore: Number(row.lexicalScore) || 0,
        semanticScore: Number(row.semanticScore) || 0,
        score: Number(row.score) || 0,
        metadata: jsonRecord(row.metadataJson),
        updatedAt: new Date(row.updatedAt).toISOString(),
      });
      if (matches.length >= requestedLimit) break;
    }
    return {
      available: true,
      matches,
      reason: matches.length === 0 ? 'not_indexed' : undefined,
    };
  } catch (error) {
    const missing = isMissingKnowledgeTable(error);
    log.warn('Course knowledge search unavailable; caller should use legacy search:', error);
    return {
      available: false,
      matches: [],
      reason: missing ? 'knowledge_tables_unavailable' : 'search_failed',
    };
  }
}
