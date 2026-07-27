import crypto from 'node:crypto';
import { after } from 'next/server';
import { Prisma, type PrismaClient } from '@/lib/server/generated-prisma';
import { createLogger } from '@/lib/logger';

const MAX_CHUNK_CHARS = 1400;
const CHUNK_OVERLAP_CHARS = 200;
const PROJECTION_WRITE_BATCH_SIZE = 400;
const PROJECTION_SYNC_QUIET_MS = 750;
const PROJECTION_SYNC_MAX_DEBOUNCE_MS = 2_500;
const PROJECTION_SYNC_MAX_PASSES_PER_RUNNER = 2;
const RECONCILIATION_THROTTLE_MS = 30_000;
const RECONCILIATION_MAX_BACKOFF_MS = 5 * 60_000;
const log = createLogger('UnlinkedCourseKnowledgeProjection');
const reconciliationNotBeforeByCourse = new Map<string, number>();
const reconciliationFailureCountByCourse = new Map<string, number>();

type KnowledgeDb = PrismaClient | Prisma.TransactionClient;

type MarkdownRow = {
  id: string;
  notebookId: string;
  notebookName: string | null;
  title: string;
  order: number;
  markdown: string;
  summary: string | null;
  updatedAt: Date | string;
};

type ProblemRow = {
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

type ProjectionDocument = {
  documentKey: string;
  documentType: 'markdown_section' | 'problem';
  sourceEntityType: 'MarkdownNotebookSection' | 'NotebookProblem';
  sourceEntityId: string;
  notebookId: string | null;
  title: string;
  summary: string | null;
  content: string;
  contentHash: string;
  metadataJson: Record<string, unknown>;
  publishedAt: Date | string | null;
};

type ProjectionStateRow = {
  documentKey: string;
  notebookId: string | null;
  sourceEntityType: string;
  sourceEntityId: string;
  title: string;
  summary: string | null;
  contentHash: string;
  status: string;
  metadataJson: unknown;
  chunkCount: number;
  chunkHashes: string[];
  publishedAt: Date | string | null;
};

type ExistingProjectionRow = {
  id: string;
  documentKey: string;
  ownerId: string;
  notebookId: string | null;
  documentType: string;
  sourceEntityType: string;
  sourceEntityId: string;
  visibility: string;
  title: string;
  summary: string | null;
  content: string;
  contentHash: string;
  language: string;
  status: string;
  errorReason: string | null;
  metadataJson: unknown;
  chunkCount: number;
  publishedAt: Date | string | null;
  indexedAt: Date | string | null;
  chunks: unknown;
};

type PreparedProjectionItem = {
  document: ProjectionDocument;
  chunks: Array<{
    chunkIndex: number;
    chunkText: string;
    contentHash: string;
    tokenCount: number;
  }>;
};

type ScheduledProjectionState = {
  prisma: PrismaClient;
  courseId: string;
  ownerId?: string | null;
  reasons: Set<string>;
  mutationVersion: number;
  dirty: boolean;
  firstDirtyAt: number;
  lastDirtyAt: number;
  reconciliationRequested: boolean;
  callbackScheduled: boolean;
  running: boolean;
  retryNotBefore: number;
  lastTouchedAt: number;
};

const scheduledProjectionByCourse = new Map<string, ScheduledProjectionState>();
const globalProjectionWaiters: Array<() => void> = [];
let globalProjectionPermitActive = false;

export type UnlinkedCourseKnowledgeProjectionInspection = {
  available: boolean;
  pending: boolean;
  expectedCount: number;
  readyCount: number;
  errorReason?: string;
};

export type UnlinkedCourseKnowledgeProjectionSyncResult = {
  available: boolean;
  synced: boolean;
  pending: boolean;
  documents: number;
  chunks: number;
  reason?:
    | 'course_not_found'
    | 'knowledge_tables_unavailable'
    | 'source_linked_ownership_conflict'
    | 'source_changed_during_sync'
    | 'sync_failed';
  errorReason?: string;
};

const projectionSyncInFlightByCourse = new Map<
  string,
  Promise<UnlinkedCourseKnowledgeProjectionSyncResult>
>();

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

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function dateValue(value: Date | string | null): string | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${hashText(value).slice(0, 32)}`;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 800);
}

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function inBatches<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function withGlobalProjectionPermit<T>(task: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    if (!globalProjectionPermitActive) {
      globalProjectionPermitActive = true;
      resolve();
      return;
    }
    globalProjectionWaiters.push(resolve);
  });

  try {
    return await task();
  } finally {
    const next = globalProjectionWaiters.shift();
    if (next) {
      next();
    } else {
      globalProjectionPermitActive = false;
    }
  }
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
    /relation\s+"?(?:CourseSource|KnowledgeDocument|KnowledgeChunk)"?\s+does not exist/i.test(
      message,
    )
  );
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
    // This column is the public problem payload. Private evaluation data is
    // deliberately neither selected nor joined by this projection.
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

function documentsFingerprint(documents: ProjectionDocument[]): string {
  return hashText(
    JSON.stringify(
      documents
        .map((document) => ({
          documentKey: document.documentKey,
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
        .sort((left, right) => left.documentKey.localeCompare(right.documentKey)),
    ),
  );
}

function expectedChunkState(args: {
  item: PreparedProjectionItem;
  ownerId: string;
  courseId: string;
}): Array<Record<string, unknown>> {
  return args.item.chunks.map((chunk) => ({
    ownerId: args.ownerId,
    courseId: args.courseId,
    courseSourceId: null,
    notebookId: args.item.document.notebookId,
    documentType: args.item.document.documentType,
    visibility: 'course',
    chunkIndex: chunk.chunkIndex,
    chunkText: chunk.chunkText,
    contentHash: chunk.contentHash,
    tokenCount: chunk.tokenCount,
    metadataJson: {
      sourceEntityType: args.item.document.sourceEntityType,
      sourceEntityId: args.item.document.sourceEntityId,
    },
  }));
}

function isProjectionDocumentCurrent(args: {
  existing: ExistingProjectionRow | undefined;
  item: PreparedProjectionItem;
  ownerId: string;
  language: string;
}): boolean {
  const { existing, item } = args;
  return Boolean(
    existing &&
    existing.ownerId === args.ownerId &&
    existing.notebookId === item.document.notebookId &&
    existing.documentType === item.document.documentType &&
    existing.sourceEntityType === item.document.sourceEntityType &&
    existing.sourceEntityId === item.document.sourceEntityId &&
    existing.visibility === 'course' &&
    existing.title === item.document.title &&
    existing.summary === item.document.summary &&
    existing.content === item.document.content &&
    existing.contentHash === item.document.contentHash &&
    existing.language === args.language &&
    existing.status === 'ready' &&
    existing.errorReason === null &&
    sameJson(existing.metadataJson, item.document.metadataJson) &&
    Number(existing.chunkCount) === item.chunks.length &&
    dateValue(existing.publishedAt) === dateValue(item.document.publishedAt) &&
    existing.indexedAt !== null,
  );
}

function areProjectionChunksCurrent(args: {
  existing: ExistingProjectionRow | undefined;
  item: PreparedProjectionItem;
  ownerId: string;
  courseId: string;
}): boolean {
  return Boolean(
    args.existing &&
    sameJson(
      args.existing.chunks,
      expectedChunkState({
        item: args.item,
        ownerId: args.ownerId,
        courseId: args.courseId,
      }),
    ),
  );
}

async function loadUnlinkedCourseDocuments(
  prisma: KnowledgeDb,
  courseId: string,
): Promise<ProjectionDocument[]> {
  const [sections, problems] = await Promise.all([
    prisma.$queryRawUnsafe<MarkdownRow[]>(
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
          AND NOT EXISTS (
            SELECT 1
            FROM "CourseSource" source
            WHERE source."courseId" = $1
              AND source."sourceHash" = NULLIF(s."sourceMeta"->>'sourceHash', '')
          )
        ORDER BY s."order" ASC, s."updatedAt" DESC
      `,
      courseId,
    ),
    prisma.$queryRawUnsafe<ProblemRow[]>(
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
          AND NOT EXISTS (
            SELECT 1
            FROM "CourseSource" source
            WHERE source."courseId" = $1
              AND source."sourceHash" = COALESCE(
                NULLIF(p."sourceMeta"->>'uploadSourceHash', ''),
                NULLIF(p."sourceMeta"->>'sourceHash', '')
              )
          )
        ORDER BY p."updatedAt" DESC
      `,
      courseId,
    ),
  ]);

  const sectionDocuments = sections.map((row): ProjectionDocument => {
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

  const problemDocuments = problems.map((row): ProjectionDocument => {
    const publicContent = renderPublicProblemContent(row.publicText);
    const content = normalizeText(
      [row.title, row.tags.join(' '), publicContent].filter(Boolean).join('\n\n'),
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

  return [...sectionDocuments, ...problemDocuments].filter((document) => document.content);
}

async function inspectUnlinkedCourseKnowledgeProjectionWithPermit(args: {
  prisma: PrismaClient;
  courseId: string;
}): Promise<UnlinkedCourseKnowledgeProjectionInspection> {
  try {
    return await args.prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtext($1))::text AS "locked"',
          `knowledge-course:${args.courseId}`,
        );
        const expectedDocuments = await loadUnlinkedCourseDocuments(tx, args.courseId);
        const expectedFingerprint = documentsFingerprint(expectedDocuments);
        const rows = await tx.$queryRawUnsafe<ProjectionStateRow[]>(
          `
          SELECT
            d."documentKey",
            d."notebookId",
            d."sourceEntityType",
            d."sourceEntityId",
            d."title",
            d."summary",
            d."contentHash",
            d."status",
            d."metadataJson",
            d."chunkCount",
            COALESCE(
              ARRAY_AGG(c."contentHash" ORDER BY c."chunkIndex")
                FILTER (WHERE c."id" IS NOT NULL),
              ARRAY[]::text[]
            ) AS "chunkHashes",
            d."publishedAt"
          FROM "KnowledgeDocument" d
          LEFT JOIN "KnowledgeChunk" c ON c."documentId" = d."id"
          WHERE d."courseId" = $1
            AND d."courseSourceId" IS NULL
            AND d."documentType" IN ('markdown_section', 'problem')
          GROUP BY d."id"
        `,
          args.courseId,
        );
        const sourceChanged =
          documentsFingerprint(await loadUnlinkedCourseDocuments(tx, args.courseId)) !==
          expectedFingerprint;
        const expectedByKey = new Map(
          expectedDocuments.map((document) => [
            document.documentKey,
            {
              document,
              chunkHashes: splitText(document.content).map((chunk) => hashText(chunk.chunkText)),
            },
          ]),
        );
        let readyCount = 0;
        for (const row of rows) {
          const expected = expectedByKey.get(row.documentKey);
          if (
            expected &&
            row.status === 'ready' &&
            row.notebookId === expected.document.notebookId &&
            row.sourceEntityType === expected.document.sourceEntityType &&
            row.sourceEntityId === expected.document.sourceEntityId &&
            row.title === expected.document.title &&
            row.summary === expected.document.summary &&
            row.contentHash === expected.document.contentHash &&
            sameJson(row.metadataJson, expected.document.metadataJson) &&
            dateValue(row.publishedAt) === dateValue(expected.document.publishedAt) &&
            Number(row.chunkCount) === expected.chunkHashes.length &&
            row.chunkHashes.length === expected.chunkHashes.length &&
            row.chunkHashes.every((hash, index) => hash === expected.chunkHashes[index])
          ) {
            readyCount += 1;
          }
        }
        return {
          available: true,
          pending:
            sourceChanged ||
            readyCount !== expectedDocuments.length ||
            rows.some((row) => !expectedByKey.has(row.documentKey)),
          expectedCount: expectedDocuments.length,
          readyCount,
        };
      },
      {
        maxWait: 30_000,
        timeout: 120_000,
      },
    );
  } catch (error) {
    const missing = isMissingKnowledgeTable(error);
    return {
      available: !missing,
      // An inspection failure is not evidence that the projection is stale.
      // In particular, attempting an immediate rebuild after a transient
      // connection/pool error only adds more pressure to the same database.
      pending: false,
      expectedCount: 0,
      readyCount: 0,
      errorReason: errorText(error),
    };
  }
}

export async function inspectUnlinkedCourseKnowledgeProjection(args: {
  prisma: PrismaClient;
  courseId: string;
}): Promise<UnlinkedCourseKnowledgeProjectionInspection> {
  return withGlobalProjectionPermit(() => inspectUnlinkedCourseKnowledgeProjectionWithPermit(args));
}

async function syncUnlinkedCourseKnowledgeProjectionWithPermit(args: {
  prisma: PrismaClient;
  courseId: string;
  ownerId?: string | null;
}): Promise<UnlinkedCourseKnowledgeProjectionSyncResult> {
  const course = await args.prisma.course.findFirst({
    where: {
      id: args.courseId,
      ...(args.ownerId ? { ownerId: args.ownerId } : {}),
    },
    select: { id: true, ownerId: true, language: true },
  });
  if (!course) {
    return {
      available: true,
      synced: false,
      pending: false,
      documents: 0,
      chunks: 0,
      reason: 'course_not_found',
    };
  }

  try {
    const documents = await loadUnlinkedCourseDocuments(args.prisma, args.courseId);
    const fingerprint = documentsFingerprint(documents);
    const prepared: PreparedProjectionItem[] = documents.map((document) => ({
      document,
      chunks: splitText(document.content).map((chunk) => ({
        ...chunk,
        contentHash: hashText(chunk.chunkText),
        tokenCount: Math.max(1, Math.ceil(chunk.chunkText.length / 4)),
      })),
    }));

    let sourceChanged = false;
    let ownershipConflict = false;
    await args.prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock(hashtext($1))::text AS "locked"',
          `knowledge-course:${args.courseId}`,
        );
        const freshDocuments = await loadUnlinkedCourseDocuments(tx, args.courseId);
        sourceChanged = documentsFingerprint(freshDocuments) !== fingerprint;
        if (sourceChanged) return;

        const documentKeys = documents.map((document) => document.documentKey);
        if (documentKeys.length > 0) {
          // This is an explicit ownership handoff, not a blind conflict update:
          // under the same course lock used by the source index, recheck that
          // the business entity still belongs here and no same-course
          // CourseSource owns its current source hash. Linked rows stay linked.
          const priorOwners = await tx.$queryRawUnsafe<Array<{ courseSourceId: string }>>(
            `
            SELECT DISTINCT d."courseSourceId"
            FROM "KnowledgeDocument" d
            WHERE d."courseId" = $1
              AND d."courseSourceId" IS NOT NULL
              AND d."documentKey" = ANY($2::text[])
              AND (
                EXISTS (
                  SELECT 1
                  FROM "MarkdownNotebookSection" section
                  INNER JOIN "Notebook" notebook ON notebook."id" = section."notebookId"
                  WHERE d."documentKey" = 'markdown_section:' || section."id"
                    AND COALESCE(section."courseId", notebook."courseId") = $1
                    AND NOT EXISTS (
                      SELECT 1
                      FROM "CourseSource" source
                      WHERE source."courseId" = $1
                        AND source."sourceHash" =
                          NULLIF(section."sourceMeta"->>'sourceHash', '')
                    )
                )
                OR EXISTS (
                  SELECT 1
                  FROM "NotebookProblem" problem
                  LEFT JOIN "Notebook" notebook ON notebook."id" = problem."notebookId"
                  WHERE d."documentKey" = 'problem:' || problem."id"
                    AND problem."status" <> 'archived'
                    AND COALESCE(problem."courseId", notebook."courseId") = $1
                    AND NOT EXISTS (
                      SELECT 1
                      FROM "CourseSource" source
                      WHERE source."courseId" = $1
                        AND source."sourceHash" = COALESCE(
                          NULLIF(problem."sourceMeta"->>'uploadSourceHash', ''),
                          NULLIF(problem."sourceMeta"->>'sourceHash', '')
                        )
                    )
                )
              )
          `,
            args.courseId,
            documentKeys,
          );
          const priorOwnerIds = priorOwners.map((row) => row.courseSourceId);
          if (priorOwnerIds.length > 0) {
            // Match the business staleness trigger's lock order:
            // CourseSource first, KnowledgeDocument second.
            await tx.$executeRawUnsafe(
              `
              UPDATE "CourseSource"
              SET
                "indexStatus" = 'pending',
                "indexLeaseToken" = NULL,
                "indexLeaseExpiresAt" = NULL,
                "indexedAt" = NULL,
                "updatedAt" = CURRENT_TIMESTAMP
              WHERE "id" = ANY($1::text[])
            `,
              priorOwnerIds,
            );
          }
          await tx.$executeRawUnsafe(
            `
            UPDATE "KnowledgeDocument" d
            SET
              "courseSourceId" = NULL,
              "status" = 'stale',
              "indexedAt" = NULL,
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE d."courseId" = $1
              AND d."courseSourceId" IS NOT NULL
              AND d."documentKey" = ANY($2::text[])
              AND (
                EXISTS (
                  SELECT 1
                  FROM "MarkdownNotebookSection" section
                  INNER JOIN "Notebook" notebook ON notebook."id" = section."notebookId"
                  WHERE d."documentKey" = 'markdown_section:' || section."id"
                    AND COALESCE(section."courseId", notebook."courseId") = $1
                    AND NOT EXISTS (
                      SELECT 1
                      FROM "CourseSource" source
                      WHERE source."courseId" = $1
                        AND source."sourceHash" =
                          NULLIF(section."sourceMeta"->>'sourceHash', '')
                    )
                )
                OR EXISTS (
                  SELECT 1
                  FROM "NotebookProblem" problem
                  LEFT JOIN "Notebook" notebook ON notebook."id" = problem."notebookId"
                  WHERE d."documentKey" = 'problem:' || problem."id"
                    AND problem."status" <> 'archived'
                    AND COALESCE(problem."courseId", notebook."courseId") = $1
                    AND NOT EXISTS (
                      SELECT 1
                      FROM "CourseSource" source
                      WHERE source."courseId" = $1
                        AND source."sourceHash" = COALESCE(
                          NULLIF(problem."sourceMeta"->>'uploadSourceHash', ''),
                          NULLIF(problem."sourceMeta"->>'sourceHash', '')
                        )
                    )
                )
              )
          `,
            args.courseId,
            documentKeys,
          );
        }
        const existingRows =
          documentKeys.length > 0
            ? await tx.$queryRawUnsafe<ExistingProjectionRow[]>(
                `
                SELECT
                  d."id",
                  d."documentKey",
                  d."ownerId",
                  d."notebookId",
                  d."documentType",
                  d."sourceEntityType",
                  d."sourceEntityId",
                  d."visibility",
                  d."title",
                  d."summary",
                  d."content",
                  d."contentHash",
                  d."language",
                  d."status",
                  d."errorReason",
                  d."metadataJson",
                  d."chunkCount",
                  d."publishedAt",
                  d."indexedAt",
                  COALESCE(
                    (
                      SELECT JSONB_AGG(
                        JSONB_BUILD_OBJECT(
                          'ownerId', c."ownerId",
                          'courseId', c."courseId",
                          'courseSourceId', c."courseSourceId",
                          'notebookId', c."notebookId",
                          'documentType', c."documentType",
                          'visibility', c."visibility",
                          'chunkIndex', c."chunkIndex",
                          'chunkText', c."chunkText",
                          'contentHash', c."contentHash",
                          'tokenCount', c."tokenCount",
                          'metadataJson', c."metadataJson"
                        )
                        ORDER BY c."chunkIndex"
                      )
                      FROM "KnowledgeChunk" c
                      WHERE c."documentId" = d."id"
                    ),
                    '[]'::jsonb
                  ) AS "chunks"
                FROM "KnowledgeDocument" d
                WHERE d."courseId" = $1
                  AND d."courseSourceId" IS NULL
                  AND d."documentKey" = ANY($2::text[])
              `,
                args.courseId,
                documentKeys,
              )
            : [];
        const existingByKey = new Map(existingRows.map((row) => [row.documentKey, row] as const));
        const writePlan = prepared.map((item) => {
          const existing = existingByKey.get(item.document.documentKey);
          return {
            item,
            existing,
            documentCurrent: isProjectionDocumentCurrent({
              existing,
              item,
              ownerId: course.ownerId,
              language: course.language,
            }),
            chunksCurrent: areProjectionChunksCurrent({
              existing,
              item,
              ownerId: course.ownerId,
              courseId: args.courseId,
            }),
          };
        });
        const documentIdsByKey = new Map(
          existingRows.map((row) => [row.documentKey, row.id] as const),
        );
        const documentWrites = writePlan.filter((entry) => !entry.documentCurrent);

        for (const batch of inBatches(documentWrites, PROJECTION_WRITE_BATCH_SIZE)) {
          const values = batch.map(
            ({ item }) => Prisma.sql`
              (
                ${stableId('knowledge_document', `${args.courseId}:${item.document.documentKey}`)},
                ${course.ownerId},
                ${args.courseId},
                NULL,
                ${item.document.notebookId},
                ${item.document.documentKey},
                ${item.document.documentType},
                ${item.document.sourceEntityType},
                ${item.document.sourceEntityId},
                'course',
                ${item.document.title},
                ${item.document.summary},
                ${item.document.content},
                ${item.document.contentHash},
                ${course.language},
                'ready',
                NULL,
                CAST(${JSON.stringify(item.document.metadataJson)} AS JSONB),
                1,
                ${item.chunks.length},
                ${item.document.publishedAt},
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
              )
            `,
          );
          const persistedRows = await tx.$queryRaw<
            Array<{ id: string; documentKey: string }>
          >(Prisma.sql`
            INSERT INTO "KnowledgeDocument" (
              "id", "ownerId", "courseId", "courseSourceId", "notebookId",
              "documentKey", "documentType", "sourceEntityType", "sourceEntityId",
              "visibility", "title", "summary", "content", "contentHash",
              "language", "status", "errorReason", "metadataJson",
              "contentVersion", "chunkCount", "publishedAt", "indexedAt",
              "createdAt", "updatedAt"
            )
            VALUES ${Prisma.join(values)}
            ON CONFLICT ("courseId", "documentKey") DO UPDATE SET
              "ownerId" = EXCLUDED."ownerId",
              "notebookId" = EXCLUDED."notebookId",
              "documentType" = EXCLUDED."documentType",
              "sourceEntityType" = EXCLUDED."sourceEntityType",
              "sourceEntityId" = EXCLUDED."sourceEntityId",
              "visibility" = 'course',
              "title" = EXCLUDED."title",
              "summary" = EXCLUDED."summary",
              "content" = EXCLUDED."content",
              "contentVersion" = CASE
                WHEN "KnowledgeDocument"."contentHash" = EXCLUDED."contentHash"
                  THEN "KnowledgeDocument"."contentVersion"
                ELSE "KnowledgeDocument"."contentVersion" + 1
              END,
              "contentHash" = EXCLUDED."contentHash",
              "language" = EXCLUDED."language",
              "status" = 'ready',
              "errorReason" = NULL,
              "metadataJson" = EXCLUDED."metadataJson",
              "chunkCount" = EXCLUDED."chunkCount",
              "publishedAt" = EXCLUDED."publishedAt",
              "indexedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE "KnowledgeDocument"."courseSourceId" IS NULL
            RETURNING "id", "documentKey"
          `);
          const persistedByKey = new Map(
            persistedRows.map((row) => [row.documentKey, row.id] as const),
          );
          for (const { item } of batch) {
            const persistedDocumentId = persistedByKey.get(item.document.documentKey);
            if (persistedDocumentId) {
              documentIdsByKey.set(item.document.documentKey, persistedDocumentId);
            } else {
              // A source-linked index owns the unique (courseId, documentKey) row.
              // This generic projection must never detach it or rewrite its chunks.
              ownershipConflict = true;
              documentIdsByKey.delete(item.document.documentKey);
            }
          }
        }

        const chunkWrites: Array<
          (typeof writePlan)[number] & {
            documentId: string;
          }
        > = [];
        for (const entry of writePlan) {
          if (entry.chunksCurrent) continue;
          const documentId = documentIdsByKey.get(entry.item.document.documentKey);
          if (documentId) chunkWrites.push({ ...entry, documentId });
        }

        for (const batch of inBatches(chunkWrites, PROJECTION_WRITE_BATCH_SIZE)) {
          await tx.$executeRawUnsafe(
            'DELETE FROM "KnowledgeChunk" WHERE "documentId" = ANY($1::text[])',
            batch.map((entry) => entry.documentId),
          );
        }

        const chunkRows = chunkWrites.flatMap(({ item, documentId }) =>
          item.chunks.map(
            (chunk) => Prisma.sql`
              (
                ${stableId('knowledge_chunk', `${documentId}:${chunk.chunkIndex}`)},
                ${documentId},
                ${course.ownerId},
                ${args.courseId},
                NULL,
                ${item.document.notebookId},
                ${item.document.documentType},
                'course',
                ${chunk.chunkIndex},
                ${chunk.chunkText},
                ${chunk.contentHash},
                ${chunk.tokenCount},
                CAST(${JSON.stringify({
                  sourceEntityType: item.document.sourceEntityType,
                  sourceEntityId: item.document.sourceEntityId,
                })} AS JSONB),
                CURRENT_TIMESTAMP,
                CURRENT_TIMESTAMP
              )
            `,
          ),
        );
        for (const batch of inBatches(chunkRows, PROJECTION_WRITE_BATCH_SIZE)) {
          await tx.$executeRaw(Prisma.sql`
            INSERT INTO "KnowledgeChunk" (
              "id", "documentId", "ownerId", "courseId", "courseSourceId",
              "notebookId", "documentType", "visibility", "chunkIndex",
              "chunkText", "contentHash", "tokenCount", "metadataJson",
              "createdAt", "updatedAt"
            )
            VALUES ${Prisma.join(batch)}
          `);
        }

        await tx.$executeRawUnsafe(
          `
          DELETE FROM "KnowledgeDocument"
          WHERE "courseId" = $1
            AND "courseSourceId" IS NULL
            AND "documentType" IN ('markdown_section', 'problem')
            AND NOT ("documentKey" = ANY($2::text[]))
        `,
          args.courseId,
          documentKeys,
        );

        const settledDocuments = await loadUnlinkedCourseDocuments(tx, args.courseId);
        if (documentsFingerprint(settledDocuments) !== fingerprint) {
          sourceChanged = true;
          // Never commit an old snapshot as searchable truth. A concurrent
          // mutation will be retried; until then, lexical search must fall back.
          await tx.$executeRawUnsafe(
            `
            UPDATE "KnowledgeDocument"
            SET
              "status" = 'stale',
              "indexedAt" = NULL,
              "updatedAt" = CURRENT_TIMESTAMP
            WHERE "courseId" = $1
              AND "courseSourceId" IS NULL
              AND "documentType" IN ('markdown_section', 'problem')
          `,
            args.courseId,
          );
        }
      },
      {
        maxWait: 30_000,
        timeout: 300_000,
      },
    );

    const chunks = prepared.reduce((count, item) => count + item.chunks.length, 0);
    if (sourceChanged) {
      return {
        available: true,
        synced: false,
        pending: true,
        documents: documents.length,
        chunks,
        reason: 'source_changed_during_sync',
      };
    }
    if (ownershipConflict) {
      return {
        available: true,
        synced: false,
        pending: true,
        documents: documents.length,
        chunks,
        reason: 'source_linked_ownership_conflict',
      };
    }
    return {
      available: true,
      synced: true,
      pending: false,
      documents: documents.length,
      chunks,
    };
  } catch (error) {
    const missing = isMissingKnowledgeTable(error);
    return {
      available: !missing,
      synced: false,
      pending: !missing,
      documents: 0,
      chunks: 0,
      reason: missing ? 'knowledge_tables_unavailable' : 'sync_failed',
      errorReason: errorText(error),
    };
  }
}

export async function syncUnlinkedCourseKnowledgeProjection(args: {
  prisma: PrismaClient;
  courseId: string;
  ownerId?: string | null;
}): Promise<UnlinkedCourseKnowledgeProjectionSyncResult> {
  const existing = projectionSyncInFlightByCourse.get(args.courseId);
  if (existing) return existing;

  const run = withGlobalProjectionPermit(() =>
    syncUnlinkedCourseKnowledgeProjectionWithPermit(args),
  );
  projectionSyncInFlightByCourse.set(args.courseId, run);
  try {
    return await run;
  } finally {
    if (projectionSyncInFlightByCourse.get(args.courseId) === run) {
      projectionSyncInFlightByCourse.delete(args.courseId);
    }
  }
}

export function scheduleUnlinkedCourseKnowledgeProjectionSync(args: {
  prisma: PrismaClient;
  courseId: string | null | undefined;
  ownerId?: string | null;
  reason: string;
}): void {
  const courseId = args.courseId?.trim();
  if (!courseId) return;
  const state = getOrCreateScheduledProjectionState(args.prisma, courseId);
  const now = Date.now();
  state.ownerId = args.ownerId;
  state.mutationVersion += 1;
  if (!state.dirty) state.firstDirtyAt = now;
  state.lastDirtyAt = now;
  state.dirty = true;
  addProjectionReason(state, args.reason);
  ensureScheduledProjectionRunner(state);
}

function logIncompleteSync(
  courseId: string,
  trigger: string,
  result: UnlinkedCourseKnowledgeProjectionSyncResult,
): void {
  if (!result.synced && result.reason !== 'knowledge_tables_unavailable') {
    log.warn('Unlinked course knowledge projection sync did not complete.', {
      courseId,
      trigger,
      reason: result.reason,
      errorReason: result.errorReason,
    });
  }
}

function reconciliationFailureBackoffMs(courseId: string): number {
  const failureCount = (reconciliationFailureCountByCourse.get(courseId) ?? 0) + 1;
  reconciliationFailureCountByCourse.set(courseId, failureCount);
  return Math.min(
    RECONCILIATION_MAX_BACKOFF_MS,
    RECONCILIATION_THROTTLE_MS * 2 ** Math.min(failureCount - 1, 4),
  );
}

function getOrCreateScheduledProjectionState(
  prisma: PrismaClient,
  courseId: string,
): ScheduledProjectionState {
  const existing = scheduledProjectionByCourse.get(courseId);
  if (existing) {
    existing.prisma = prisma;
    return existing;
  }
  const created: ScheduledProjectionState = {
    prisma,
    courseId,
    reasons: new Set(),
    mutationVersion: 0,
    dirty: false,
    firstDirtyAt: 0,
    lastDirtyAt: 0,
    reconciliationRequested: false,
    callbackScheduled: false,
    running: false,
    retryNotBefore: 0,
    lastTouchedAt: Date.now(),
  };
  scheduledProjectionByCourse.set(courseId, created);
  return created;
}

function addProjectionReason(state: ScheduledProjectionState, reason: string): void {
  const normalized = reason.trim();
  if (normalized && state.reasons.size < 12) state.reasons.add(normalized);
  state.lastTouchedAt = Date.now();
}

function projectionTrigger(reasons: string[]): string {
  return reasons.length > 0 ? reasons.join(',') : 'coalesced_mutation';
}

async function waitForProjectionQuietWindow(state: ScheduledProjectionState): Promise<void> {
  while (state.dirty && state.firstDirtyAt > 0) {
    const now = Date.now();
    const quietDeadline = state.lastDirtyAt + PROJECTION_SYNC_QUIET_MS;
    const maxDeadline = state.firstDirtyAt + PROJECTION_SYNC_MAX_DEBOUNCE_MS;
    const waitUntil = Math.min(quietDeadline, maxDeadline);
    if (waitUntil <= now) return;
    await waitFor(waitUntil - now);
  }
}

function ensureScheduledProjectionRunner(state: ScheduledProjectionState): void {
  if (state.callbackScheduled) return;
  state.callbackScheduled = true;
  try {
    after(async () => {
      await runScheduledProjection(state);
    });
  } catch (error) {
    state.callbackScheduled = false;
    throw error;
  }
}

async function runScheduledProjection(state: ScheduledProjectionState): Promise<void> {
  if (scheduledProjectionByCourse.get(state.courseId) !== state) return;
  state.running = true;
  let passCount = 0;
  let encounteredFailure = false;
  let lastPassSawNewMutation = false;

  try {
    if (state.retryNotBefore > Date.now()) return;

    while (
      passCount < PROJECTION_SYNC_MAX_PASSES_PER_RUNNER &&
      (state.dirty || state.reconciliationRequested)
    ) {
      if (state.dirty) await waitForProjectionQuietWindow(state);
      if (state.retryNotBefore > Date.now()) break;

      const hadMutation = state.dirty;
      const hadReconciliation = state.reconciliationRequested;
      if (!hadMutation && !hadReconciliation) break;

      passCount += 1;
      const mutationVersionAtStart = state.mutationVersion;
      const reasons = hadMutation ? Array.from(state.reasons) : [];
      if (hadMutation) {
        state.dirty = false;
        state.firstDirtyAt = 0;
        state.lastDirtyAt = 0;
        state.reasons.clear();
      }
      if (hadReconciliation) state.reconciliationRequested = false;

      let result: UnlinkedCourseKnowledgeProjectionSyncResult | undefined;
      if (hadMutation) {
        result = await syncUnlinkedCourseKnowledgeProjection({
          prisma: state.prisma,
          courseId: state.courseId,
          ownerId: state.ownerId,
        });
      } else {
        const inspection = await inspectUnlinkedCourseKnowledgeProjection({
          prisma: state.prisma,
          courseId: state.courseId,
        });
        if (inspection.errorReason) {
          if (inspection.available) {
            const retryAfterMs = reconciliationFailureBackoffMs(state.courseId);
            state.retryNotBefore = Date.now() + retryAfterMs;
            reconciliationNotBeforeByCourse.set(state.courseId, state.retryNotBefore);
            log.warn('Could not inspect unlinked course knowledge projection.', {
              courseId: state.courseId,
              errorReason: inspection.errorReason,
              retryAfterMs,
            });
          }
          encounteredFailure = true;
          break;
        }
        if (!inspection.pending) {
          reconciliationFailureCountByCourse.delete(state.courseId);
          state.retryNotBefore = 0;
          continue;
        }
        result = await syncUnlinkedCourseKnowledgeProjection({
          prisma: state.prisma,
          courseId: state.courseId,
        });
      }

      const trigger = hadMutation ? projectionTrigger(reasons) : 'source_library_reconciliation';
      logIncompleteSync(state.courseId, trigger, result);
      lastPassSawNewMutation = state.mutationVersion > mutationVersionAtStart;

      if (result.synced || !result.available || result.reason === 'course_not_found') {
        reconciliationFailureCountByCourse.delete(state.courseId);
        state.retryNotBefore = 0;
        // A successful full sync also satisfies a reconciliation request that
        // arrived while it was running. A missing course/table is terminal.
        state.reconciliationRequested = false;
        if (!result.synced) {
          state.dirty = false;
          state.firstDirtyAt = 0;
          state.lastDirtyAt = 0;
          state.reasons.clear();
        }
        continue;
      }

      if (result.reason === 'source_changed_during_sync') {
        const now = Date.now();
        state.dirty = true;
        if (state.firstDirtyAt === 0) state.firstDirtyAt = now;
        state.lastDirtyAt = now;
        addProjectionReason(state, result.reason);
        if (passCount >= PROJECTION_SYNC_MAX_PASSES_PER_RUNNER && !lastPassSawNewMutation) {
          reconciliationNotBeforeByCourse.set(state.courseId, now + RECONCILIATION_THROTTLE_MS);
        }
        continue;
      }

      const retryAfterMs = reconciliationFailureBackoffMs(state.courseId);
      state.retryNotBefore = Date.now() + retryAfterMs;
      reconciliationNotBeforeByCourse.set(state.courseId, state.retryNotBefore);
      if (hadMutation || lastPassSawNewMutation) {
        const now = Date.now();
        state.dirty = true;
        if (state.firstDirtyAt === 0) state.firstDirtyAt = now;
        state.lastDirtyAt = now;
        for (const reason of reasons) addProjectionReason(state, reason);
      }
      encounteredFailure = true;
      break;
    }
  } catch (error) {
    const retryAfterMs = reconciliationFailureBackoffMs(state.courseId);
    const now = Date.now();
    state.retryNotBefore = now + retryAfterMs;
    reconciliationNotBeforeByCourse.set(state.courseId, state.retryNotBefore);
    state.dirty = true;
    if (state.firstDirtyAt === 0) state.firstDirtyAt = now;
    state.lastDirtyAt = now;
    addProjectionReason(state, 'projection_runner_failed');
    encounteredFailure = true;
    log.warn('Unlinked course knowledge projection runner failed.', {
      courseId: state.courseId,
      errorReason: errorText(error),
      retryAfterMs,
    });
  } finally {
    state.running = false;
    state.callbackScheduled = false;
    state.lastTouchedAt = Date.now();
    const needsContinuation =
      !encounteredFailure &&
      state.retryNotBefore <= Date.now() &&
      state.dirty &&
      passCount >= PROJECTION_SYNC_MAX_PASSES_PER_RUNNER &&
      lastPassSawNewMutation;
    if (needsContinuation) {
      // `after` supports nested callbacks. Only a real mutation arriving in
      // the trailing pass can extend the chain, so persistent DB failures or
      // source churn cannot create a hot loop.
      ensureScheduledProjectionRunner(state);
    } else if (!state.dirty && !state.reconciliationRequested) {
      scheduledProjectionByCourse.delete(state.courseId);
    }
  }
}

export function scheduleUnlinkedCourseKnowledgeProjectionReconciliation(args: {
  prisma: PrismaClient;
  courseId: string;
}): void {
  const courseId = args.courseId.trim();
  if (!courseId) return;
  const now = Date.now();
  if ((reconciliationNotBeforeByCourse.get(courseId) ?? 0) > now) return;
  reconciliationNotBeforeByCourse.set(courseId, now + RECONCILIATION_THROTTLE_MS);
  if (reconciliationNotBeforeByCourse.size > 500) {
    for (const [staleCourseId, notBefore] of reconciliationNotBeforeByCourse) {
      if (notBefore <= now) {
        reconciliationNotBeforeByCourse.delete(staleCourseId);
        reconciliationFailureCountByCourse.delete(staleCourseId);
      }
    }
  }
  const state = getOrCreateScheduledProjectionState(args.prisma, courseId);
  state.reconciliationRequested = true;
  ensureScheduledProjectionRunner(state);
}
