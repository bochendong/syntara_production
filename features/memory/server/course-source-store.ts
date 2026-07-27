import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@/lib/server/generated-prisma';

export type CourseSourceIngestStatus = 'processing' | 'ready' | 'error';
export type CourseSourceIndexStatus = 'pending' | 'indexing' | 'ready' | 'error';

export type StoredCourseSource = {
  id: string;
  courseId: string;
  ownerId: string;
  sourceHash: string;
  title: string;
  kind: string;
  fileMime: string | null;
  storageKey: string | null;
  openaiFileId: string | null;
  extractedText: string | null;
  extractedTextHash: string | null;
  usageProfile: string | null;
  topic: string | null;
  ingestStatus: CourseSourceIngestStatus;
  ingestLeaseToken: string | null;
  ingestLeaseExpiresAt: Date | null;
  indexStatus: CourseSourceIndexStatus;
  errorReason: string | null;
  metadataJson: unknown;
  artifactCountsJson: unknown;
  contentVersion: number;
  ingestedAt: Date | null;
  indexedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type CourseSourceDb = PrismaClient | Prisma.TransactionClient;
const COURSE_SOURCE_INGEST_LEASE_MS = 15 * 60_000;

export type CourseSourceStoreMutationResult = {
  available: boolean;
  source: StoredCourseSource | null;
};

function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const record = error as {
    code?: unknown;
    message?: unknown;
    meta?: { code?: unknown; message?: unknown };
  };
  return [record.code, record.meta?.code, record.message, record.meta?.message]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
}

/**
 * During a rolling deployment the application can run before the catalog
 * migration reaches the database. Catalog reads and writes are optional in
 * that window; all other database errors still surface to the caller.
 */
export function isCourseSourceSchemaUnavailableError(error: unknown): boolean {
  const text = errorText(error);
  return (
    /\bP2021\b|\bP2022\b|\b42P01\b|\b42P10\b|\b42703\b/.test(text) ||
    (/(CourseSource|KnowledgeDocument)/i.test(text) &&
      /does not exist|not exist|missing|unknown column|no unique or exclusion constraint/i.test(
        text,
      ))
  );
}

function jsonText(value: unknown): string {
  return JSON.stringify(value ?? {});
}

const COURSE_SOURCE_COLUMNS = Prisma.raw(`
  "id", "courseId", "ownerId", "sourceHash", "title", "kind", "fileMime",
  "storageKey", "openaiFileId", NULL::text AS "extractedText", "extractedTextHash",
  "usageProfile", "topic", "ingestStatus", "ingestLeaseToken", "ingestLeaseExpiresAt",
  "indexStatus", "errorReason", "metadataJson", "artifactCountsJson",
  "contentVersion", "ingestedAt", "indexedAt", "createdAt", "updatedAt"
`);

/**
 * A processing row without a complete, future-dated lease is recoverable.
 * This intentionally treats rows written by the pre-lease implementation as
 * stale instead of leaving them permanently blocked.
 */
export function isCourseSourceIngestLeaseActive(
  source: Pick<StoredCourseSource, 'ingestStatus' | 'ingestLeaseToken' | 'ingestLeaseExpiresAt'>,
  now = Date.now(),
): boolean {
  if (source.ingestStatus !== 'processing' || !source.ingestLeaseToken) return false;
  const expiresAt =
    source.ingestLeaseExpiresAt instanceof Date
      ? source.ingestLeaseExpiresAt.getTime()
      : Date.parse(String(source.ingestLeaseExpiresAt ?? ''));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

export async function listStoredCourseSources(args: {
  prisma: CourseSourceDb;
  ownerId: string;
  courseId: string;
}): Promise<StoredCourseSource[] | null> {
  try {
    return await args.prisma.$queryRaw<StoredCourseSource[]>(Prisma.sql`
      SELECT ${COURSE_SOURCE_COLUMNS}
      FROM "CourseSource"
      WHERE "courseId" = ${args.courseId}
        AND "ownerId" = ${args.ownerId}
      ORDER BY "updatedAt" DESC, "title" ASC
    `);
  } catch (error) {
    if (isCourseSourceSchemaUnavailableError(error)) return null;
    throw error;
  }
}

export async function findStoredCourseSource(args: {
  prisma: CourseSourceDb;
  userId: string;
  courseId: string;
  sourceHash: string;
}): Promise<{ available: boolean; source: StoredCourseSource | null }> {
  try {
    const rows = await args.prisma.$queryRaw<StoredCourseSource[]>(Prisma.sql`
      SELECT ${COURSE_SOURCE_COLUMNS}
      FROM "CourseSource"
      WHERE "courseId" = ${args.courseId}
        AND "ownerId" = ${args.userId}
        AND "sourceHash" = ${args.sourceHash}
      LIMIT 1
    `);
    return { available: true, source: rows[0] ?? null };
  } catch (error) {
    if (isCourseSourceSchemaUnavailableError(error)) {
      return { available: false, source: null };
    }
    throw error;
  }
}

export async function markCourseSourceProcessing(args: {
  prisma: CourseSourceDb;
  userId: string;
  courseId: string;
  sourceHash: string;
  title: string;
  kind: string;
  fileMime?: string | null;
  storageKey?: string | null;
  openaiFileId?: string | null;
  extractedText?: string | null;
  usageProfile?: string | null;
  metadata?: unknown;
  leaseToken?: string | null;
}): Promise<CourseSourceStoreMutationResult> {
  const id = randomUUID();
  const requestedLeaseToken = args.leaseToken?.trim() || null;
  const leaseToken = requestedLeaseToken || `source_ingest_${randomUUID().replace(/-/g, '')}`;
  const leaseExpiresAt = new Date(Date.now() + COURSE_SOURCE_INGEST_LEASE_MS);
  try {
    const rows = await args.prisma.$queryRaw<StoredCourseSource[]>(Prisma.sql`
      INSERT INTO "CourseSource" (
        "id", "courseId", "ownerId", "sourceHash", "title", "kind", "fileMime",
        "storageKey", "openaiFileId", "extractedText", "extractedTextHash",
        "usageProfile", "topic", "ingestStatus", "ingestLeaseToken", "ingestLeaseExpiresAt",
        "indexStatus", "errorReason", "metadataJson", "artifactCountsJson",
        "contentVersion", "ingestedAt", "indexedAt", "createdAt", "updatedAt"
      )
      SELECT
        ${id}, "id", "ownerId", ${args.sourceHash}, ${args.title}, ${args.kind},
        ${args.fileMime ?? null}, ${args.storageKey ?? null}, ${args.openaiFileId ?? null},
        ${args.extractedText ?? null},
        ${
          args.extractedText ? createHash('sha256').update(args.extractedText).digest('hex') : null
        },
        ${args.usageProfile ?? null}, NULL, 'processing', ${leaseToken}, ${leaseExpiresAt},
        'pending', NULL,
        CAST(${jsonText(args.metadata)} AS JSONB), '{}'::jsonb,
        1, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      FROM "Course"
      WHERE "id" = ${args.courseId}
        AND "ownerId" = ${args.userId}
      ON CONFLICT ("courseId", "sourceHash") DO UPDATE
      SET
        "title" = EXCLUDED."title",
        "kind" = EXCLUDED."kind",
        "fileMime" = EXCLUDED."fileMime",
        "storageKey" = EXCLUDED."storageKey",
        "openaiFileId" = EXCLUDED."openaiFileId",
        "extractedText" = EXCLUDED."extractedText",
        "extractedTextHash" = EXCLUDED."extractedTextHash",
        "usageProfile" = EXCLUDED."usageProfile",
        "topic" = NULL,
        "ingestStatus" = 'processing',
        "ingestLeaseToken" = EXCLUDED."ingestLeaseToken",
        "ingestLeaseExpiresAt" = EXCLUDED."ingestLeaseExpiresAt",
        "indexStatus" = 'pending',
        "indexLeaseToken" = NULL,
        "indexLeaseExpiresAt" = NULL,
        "errorReason" = NULL,
        "metadataJson" = EXCLUDED."metadataJson",
        "artifactCountsJson" = '{}'::jsonb,
        "contentVersion" = CASE
          WHEN "CourseSource"."ingestLeaseToken" = EXCLUDED."ingestLeaseToken"
            THEN "CourseSource"."contentVersion"
          ELSE "CourseSource"."contentVersion" + 1
        END,
        "ingestedAt" = NULL,
        "indexedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "CourseSource"."ingestStatus" = 'processing'
        AND (
          "CourseSource"."ingestLeaseExpiresAt" IS NULL
          OR "CourseSource"."ingestLeaseExpiresAt" <= CURRENT_TIMESTAMP
          OR (
            ${requestedLeaseToken}::text IS NOT NULL
            AND "CourseSource"."ingestLeaseToken" = ${requestedLeaseToken}
          )
        )
      RETURNING ${COURSE_SOURCE_COLUMNS}
    `);
    return { available: true, source: rows[0] ?? null };
  } catch (error) {
    if (isCourseSourceSchemaUnavailableError(error)) {
      return { available: false, source: null };
    }
    throw error;
  }
}

export async function markCourseSourceReady(args: {
  prisma: CourseSourceDb;
  userId: string;
  courseId: string;
  sourceHash: string;
  leaseToken: string;
  title: string;
  kind: string;
  fileMime?: string | null;
  openaiFileId?: string | null;
  usageProfile?: string | null;
  topic?: string | null;
  metadata?: unknown;
  artifactCounts?: unknown;
}): Promise<CourseSourceStoreMutationResult> {
  try {
    const rows = await args.prisma.$queryRaw<StoredCourseSource[]>(Prisma.sql`
      UPDATE "CourseSource"
      SET
        "title" = ${args.title},
        "kind" = ${args.kind},
        "fileMime" = ${args.fileMime ?? null},
        "openaiFileId" = ${args.openaiFileId ?? null},
        "usageProfile" = ${args.usageProfile ?? null},
        "topic" = ${args.topic ?? null},
        "ingestStatus" = 'ready',
        "ingestLeaseToken" = NULL,
        "ingestLeaseExpiresAt" = NULL,
        "indexStatus" = 'pending',
        "indexLeaseToken" = NULL,
        "indexLeaseExpiresAt" = NULL,
        "errorReason" = NULL,
        "metadataJson" = COALESCE("metadataJson", '{}'::jsonb)
          || CAST(${jsonText(args.metadata)} AS JSONB),
        "artifactCountsJson" = CAST(${jsonText(args.artifactCounts)} AS JSONB),
        "ingestedAt" = CURRENT_TIMESTAMP,
        "indexedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "courseId" = ${args.courseId}
        AND "ownerId" = ${args.userId}
        AND "sourceHash" = ${args.sourceHash}
        AND "ingestStatus" = 'processing'
        AND "ingestLeaseToken" = ${args.leaseToken}
        AND "ingestLeaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING ${COURSE_SOURCE_COLUMNS}
    `);
    return { available: true, source: rows[0] ?? null };
  } catch (error) {
    if (isCourseSourceSchemaUnavailableError(error)) {
      return { available: false, source: null };
    }
    throw error;
  }
}

export async function markCourseSourceError(args: {
  prisma: CourseSourceDb;
  userId: string;
  courseId: string;
  sourceHash: string;
  leaseToken: string;
  errorReason: string;
}): Promise<CourseSourceStoreMutationResult> {
  try {
    const rows = await args.prisma.$queryRaw<StoredCourseSource[]>(Prisma.sql`
      UPDATE "CourseSource"
      SET
        "ingestStatus" = 'error',
        "ingestLeaseToken" = NULL,
        "ingestLeaseExpiresAt" = NULL,
        "indexStatus" = 'error',
        "indexLeaseToken" = NULL,
        "indexLeaseExpiresAt" = NULL,
        "errorReason" = ${args.errorReason},
        "ingestedAt" = NULL,
        "indexedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "courseId" = ${args.courseId}
        AND "ownerId" = ${args.userId}
        AND "sourceHash" = ${args.sourceHash}
        AND "ingestStatus" = 'processing'
        AND "ingestLeaseToken" = ${args.leaseToken}
        AND "ingestLeaseExpiresAt" > CURRENT_TIMESTAMP
      RETURNING ${COURSE_SOURCE_COLUMNS}
    `);
    return { available: true, source: rows[0] ?? null };
  } catch (error) {
    if (isCourseSourceSchemaUnavailableError(error)) {
      return { available: false, source: null };
    }
    throw error;
  }
}

export async function markCourseSourceIndexStatus(args: {
  prisma: CourseSourceDb;
  userId: string;
  courseId: string;
  sourceHash: string;
  status: CourseSourceIndexStatus;
  errorReason?: string | null;
}): Promise<CourseSourceStoreMutationResult> {
  try {
    const rows = await args.prisma.$queryRaw<StoredCourseSource[]>(Prisma.sql`
      UPDATE "CourseSource"
      SET
        "indexStatus" = ${args.status},
        "indexLeaseToken" = CASE
          WHEN ${args.status} = 'indexing' THEN "indexLeaseToken"
          ELSE NULL
        END,
        "indexLeaseExpiresAt" = CASE
          WHEN ${args.status} = 'indexing' THEN "indexLeaseExpiresAt"
          ELSE NULL
        END,
        "errorReason" = ${args.errorReason ?? null},
        "indexedAt" = CASE WHEN ${args.status} = 'ready' THEN CURRENT_TIMESTAMP ELSE NULL END,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "courseId" = ${args.courseId}
        AND "ownerId" = ${args.userId}
        AND "sourceHash" = ${args.sourceHash}
      RETURNING ${COURSE_SOURCE_COLUMNS}
    `);
    return { available: true, source: rows[0] ?? null };
  } catch (error) {
    if (isCourseSourceSchemaUnavailableError(error)) {
      return { available: false, source: null };
    }
    throw error;
  }
}

/**
 * Delete search projections first, then their source. The KnowledgeDocument
 * delete is explicit even though the migrated FK also uses ON DELETE CASCADE.
 */
export async function deleteStoredCourseSource(args: {
  prisma: CourseSourceDb;
  userId: string;
  courseId: string;
  sourceHash: string;
  preserveSource?: boolean;
}): Promise<{ available: boolean; deleted: boolean }> {
  // Check optional catalog tables before referencing them. Catching a missing
  // relation inside a transaction is too late: PostgreSQL marks the whole
  // transaction as aborted, which prevents the legacy artifact cleanup from
  // running afterward.
  const [relations] = await args.prisma.$queryRaw<
    Array<{ courseSource: string | null; knowledgeDocument: string | null }>
  >(Prisma.sql`
    SELECT
      to_regclass('public."CourseSource"')::text AS "courseSource",
      to_regclass('public."KnowledgeDocument"')::text AS "knowledgeDocument"
  `);
  if (!relations?.courseSource) return { available: false, deleted: false };

  try {
    if (relations.knowledgeDocument) {
      await args.prisma.$executeRaw(Prisma.sql`
        DELETE FROM "KnowledgeDocument"
        WHERE "courseSourceId" IN (
          SELECT "id"
          FROM "CourseSource"
          WHERE "courseId" = ${args.courseId}
            AND "ownerId" = ${args.userId}
            AND "sourceHash" = ${args.sourceHash}
        )
      `);
    }
  } catch (error) {
    if (!isCourseSourceSchemaUnavailableError(error)) throw error;
    return { available: false, deleted: false };
  }

  if (args.preserveSource) return { available: true, deleted: false };

  try {
    const deleted = await args.prisma.$executeRaw(Prisma.sql`
      DELETE FROM "CourseSource"
      WHERE "courseId" = ${args.courseId}
        AND "ownerId" = ${args.userId}
        AND "sourceHash" = ${args.sourceHash}
    `);
    return { available: true, deleted: deleted > 0 };
  } catch (error) {
    if (isCourseSourceSchemaUnavailableError(error)) {
      return { available: false, deleted: false };
    }
    throw error;
  }
}
