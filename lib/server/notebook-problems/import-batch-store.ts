import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@/lib/server/generated-prisma';

export type ProblemImportTargetType = 'course' | 'notebook';
export type ProblemImportBatchStatus = 'previewed' | 'committing' | 'committed' | 'cancelled';

export type ProblemImportCommitResult = {
  requestedCount: number;
  insertedProblemIds: string[];
  reusedProblemIds: string[];
  skippedDraftIds: string[];
  reusedDrafts: Array<{
    draftId: string;
    existingProblemId: string;
    dedupeKey: string;
  }>;
};

export type ProblemImportBatchRecord = {
  id: string;
  ownerId: string;
  courseId: string | null;
  notebookId: string | null;
  targetType: ProblemImportTargetType;
  source: string;
  status: ProblemImportBatchStatus;
  sourceFileName: string | null;
  sourceFileMime: string | null;
  sourceTextHash: string | null;
  draftCount: number;
  committedCount: number;
  commitPayloadHash: string | null;
  commitLeaseToken: string | null;
  commitLeaseExpiresAt: string | null;
  commitResultJson: unknown;
  draftSnapshotJson: unknown;
  usageJson: unknown;
  webSearchJson: unknown;
  warnings: string[];
  createdAt: string;
  updatedAt: string;
};

type RawProblemImportBatchRow = Omit<
  ProblemImportBatchRecord,
  'createdAt' | 'updatedAt' | 'commitLeaseExpiresAt'
> & {
  commitLeaseExpiresAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

let ensureProblemImportBatchTablePromise: Promise<void> | null = null;

function createBatchId(): string {
  return `problem_import_${randomUUID().replace(/-/g, '')}`;
}

function hashSourceText(sourceText?: string | null): string | null {
  const text = sourceText?.trim();
  if (!text) return null;
  return createHash('sha256').update(text).digest('hex');
}

export function hashProblemImportCommitPayload(drafts: unknown): string {
  return createHash('sha256').update(JSON.stringify(drafts)).digest('hex');
}

function jsonParam(value: unknown): string | null {
  return value == null ? null : JSON.stringify(value);
}

function cleanOptionalText(value?: string | null): string | null {
  const text = value?.trim();
  return text ? text.slice(0, 240) : null;
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) return null;
  return value;
}

export function readProblemImportCommitResult(
  batch: Pick<ProblemImportBatchRecord, 'commitResultJson'>,
): ProblemImportCommitResult | null {
  const value = batch.commitResultJson;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const insertedProblemIds = stringArray(record.insertedProblemIds);
  const reusedProblemIds = stringArray(record.reusedProblemIds);
  const skippedDraftIds = stringArray(record.skippedDraftIds);
  if (
    typeof record.requestedCount !== 'number' ||
    !Number.isInteger(record.requestedCount) ||
    record.requestedCount < 0 ||
    !insertedProblemIds ||
    !reusedProblemIds ||
    !skippedDraftIds ||
    !Array.isArray(record.reusedDrafts)
  ) {
    return null;
  }
  const reusedDrafts = record.reusedDrafts.filter(
    (
      item,
    ): item is {
      draftId: string;
      existingProblemId: string;
      dedupeKey: string;
    } =>
      Boolean(
        item &&
        typeof item === 'object' &&
        !Array.isArray(item) &&
        typeof (item as Record<string, unknown>).draftId === 'string' &&
        typeof (item as Record<string, unknown>).existingProblemId === 'string' &&
        typeof (item as Record<string, unknown>).dedupeKey === 'string',
      ),
  );
  if (reusedDrafts.length !== record.reusedDrafts.length) return null;
  return {
    requestedCount: record.requestedCount,
    insertedProblemIds,
    reusedProblemIds,
    skippedDraftIds,
    reusedDrafts,
  };
}

function serializeRow(row: RawProblemImportBatchRow): ProblemImportBatchRecord {
  return {
    ...row,
    warnings: Array.isArray(row.warnings) ? row.warnings : [],
    commitLeaseExpiresAt: row.commitLeaseExpiresAt
      ? new Date(row.commitLeaseExpiresAt).toISOString()
      : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export async function ensureProblemImportBatchTable(prisma: PrismaClient): Promise<void> {
  if (!ensureProblemImportBatchTablePromise) {
    ensureProblemImportBatchTablePromise = (async () => {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "ProblemImportBatch" (
          "id" TEXT PRIMARY KEY,
          "ownerId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
          "courseId" TEXT REFERENCES "Course"("id") ON DELETE CASCADE,
          "notebookId" TEXT REFERENCES "Notebook"("id") ON DELETE SET NULL,
          "targetType" TEXT NOT NULL,
          "source" TEXT NOT NULL,
          "status" TEXT NOT NULL DEFAULT 'previewed',
          "sourceFileName" TEXT,
          "sourceFileMime" TEXT,
          "sourceTextHash" TEXT,
          "draftCount" INTEGER NOT NULL DEFAULT 0,
          "committedCount" INTEGER NOT NULL DEFAULT 0,
          "commitPayloadHash" TEXT,
          "commitLeaseToken" TEXT,
          "commitLeaseExpiresAt" TIMESTAMP(3),
          "commitResultJson" JSONB,
          "draftSnapshotJson" JSONB,
          "usageJson" JSONB,
          "webSearchJson" JSONB,
          "warnings" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "ProblemImportBatch"
          ADD COLUMN IF NOT EXISTS "commitPayloadHash" TEXT,
          ADD COLUMN IF NOT EXISTS "commitLeaseToken" TEXT,
          ADD COLUMN IF NOT EXISTS "commitLeaseExpiresAt" TIMESTAMP(3),
          ADD COLUMN IF NOT EXISTS "commitResultJson" JSONB
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "ProblemImportBatch_owner_target_course_updated_idx"
        ON "ProblemImportBatch" ("ownerId", "targetType", "courseId", "updatedAt" DESC)
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "ProblemImportBatch_owner_target_notebook_updated_idx"
        ON "ProblemImportBatch" ("ownerId", "targetType", "notebookId", "updatedAt" DESC)
      `);
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "ProblemImportBatch_owner_status_updated_idx"
        ON "ProblemImportBatch" ("ownerId", "status", "updatedAt" DESC)
      `);
    })().catch((error) => {
      ensureProblemImportBatchTablePromise = null;
      throw error;
    });
  }
  return ensureProblemImportBatchTablePromise;
}

export async function createProblemImportBatch(args: {
  prisma: PrismaClient;
  userId: string;
  targetType: ProblemImportTargetType;
  courseId?: string | null;
  notebookId?: string | null;
  source: string;
  sourceText?: string | null;
  sourceFileName?: string | null;
  sourceFileMime?: string | null;
  draftSnapshot?: unknown;
  draftCount: number;
  usage?: unknown;
  webSearch?: unknown;
  warnings?: string[];
}): Promise<ProblemImportBatchRecord> {
  await ensureProblemImportBatchTable(args.prisma);
  const rows = await args.prisma.$queryRawUnsafe<RawProblemImportBatchRow[]>(
    `
      INSERT INTO "ProblemImportBatch" (
        "id", "ownerId", "courseId", "notebookId", "targetType", "source",
        "status", "sourceFileName", "sourceFileMime", "sourceTextHash",
        "draftCount", "committedCount", "draftSnapshotJson", "usageJson",
        "webSearchJson", "warnings", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        'previewed', $7, $8, $9,
        $10, 0, $11::jsonb, $12::jsonb,
        $13::jsonb, $14::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      RETURNING *
    `,
    createBatchId(),
    args.userId,
    args.courseId ?? null,
    args.notebookId ?? null,
    args.targetType,
    args.source,
    cleanOptionalText(args.sourceFileName),
    cleanOptionalText(args.sourceFileMime),
    hashSourceText(args.sourceText),
    args.draftCount,
    jsonParam(args.draftSnapshot),
    jsonParam(args.usage),
    jsonParam(args.webSearch),
    args.warnings ?? [],
  );
  return serializeRow(rows[0]);
}

export async function getProblemImportBatchForTarget(args: {
  prisma: PrismaClient;
  userId: string;
  batchId: string;
  targetType: ProblemImportTargetType;
  courseId?: string | null;
  notebookId?: string | null;
}): Promise<ProblemImportBatchRecord | null> {
  await ensureProblemImportBatchTable(args.prisma);
  const rows = await args.prisma.$queryRawUnsafe<RawProblemImportBatchRow[]>(
    `
      SELECT * FROM "ProblemImportBatch"
      WHERE "id" = $1
        AND "ownerId" = $2
        AND "targetType" = $3
        AND (
          ($3 = 'course' AND "courseId" = $4)
          OR ($3 = 'notebook' AND "notebookId" = $5)
        )
      LIMIT 1
    `,
    args.batchId,
    args.userId,
    args.targetType,
    args.courseId ?? null,
    args.notebookId ?? null,
  );
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function markProblemImportBatchCommitted(args: {
  prisma: PrismaClient;
  userId: string;
  batchId: string;
  committedCount: number;
  leaseToken?: string | null;
  commitResult?: ProblemImportCommitResult | null;
}): Promise<ProblemImportBatchRecord | null> {
  await ensureProblemImportBatchTable(args.prisma);
  const rows = await args.prisma.$queryRawUnsafe<RawProblemImportBatchRow[]>(
    `
      UPDATE "ProblemImportBatch"
      SET "status" = 'committed',
          "committedCount" = $3,
          "commitLeaseToken" = NULL,
          "commitLeaseExpiresAt" = NULL,
          "commitResultJson" = COALESCE($5::jsonb, "commitResultJson"),
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1
        AND "ownerId" = $2
        AND (
          "status" IN ('previewed', 'committed')
          OR (
            "status" = 'committing'
            AND ($4::text IS NULL OR "commitLeaseToken" = $4)
          )
        )
      RETURNING *
    `,
    args.batchId,
    args.userId,
    args.committedCount,
    args.leaseToken ?? null,
    jsonParam(args.commitResult),
  );
  return rows[0] ? serializeRow(rows[0]) : null;
}

/**
 * Atomically reserves a preview batch for one commit request.
 *
 * The previous read-then-write flow allowed two retries to both observe
 * `previewed` and insert the same drafts. Only the request that transitions
 * `previewed -> committing` may create problems; the others must reconcile
 * from the batch state.
 */
export async function claimProblemImportBatchCommit(args: {
  prisma: PrismaClient;
  userId: string;
  batchId: string;
  commitCount: number;
  payloadHash: string;
}): Promise<ProblemImportBatchRecord | null> {
  await ensureProblemImportBatchTable(args.prisma);
  const leaseToken = `problem_commit_${randomUUID().replace(/-/g, '')}`;
  const leaseExpiresAt = new Date(Date.now() + 5 * 60_000);
  const rows = await args.prisma.$queryRawUnsafe<RawProblemImportBatchRow[]>(
    `
      UPDATE "ProblemImportBatch"
      SET "status" = 'committing',
          "committedCount" = $3,
          "commitPayloadHash" = $4,
          "commitLeaseToken" = $5,
          "commitLeaseExpiresAt" = $6,
          "commitResultJson" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1
        AND "ownerId" = $2
        AND (
          "status" = 'previewed'
          OR (
            "status" = 'committing'
            AND ("commitPayloadHash" = $4 OR "commitPayloadHash" IS NULL)
            AND (
              "commitLeaseExpiresAt" IS NULL
              OR "commitLeaseExpiresAt" <= CURRENT_TIMESTAMP
            )
          )
        )
      RETURNING *
    `,
    args.batchId,
    args.userId,
    args.commitCount,
    args.payloadHash,
    leaseToken,
    leaseExpiresAt,
  );
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function releaseProblemImportBatchCommit(args: {
  prisma: PrismaClient;
  userId: string;
  batchId: string;
  leaseToken: string;
}): Promise<void> {
  await ensureProblemImportBatchTable(args.prisma);
  await args.prisma.$executeRawUnsafe(
    `
      UPDATE "ProblemImportBatch"
      SET "status" = 'previewed',
          "committedCount" = 0,
          "commitPayloadHash" = NULL,
          "commitLeaseToken" = NULL,
          "commitLeaseExpiresAt" = NULL,
          "commitResultJson" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $1
        AND "ownerId" = $2
        AND "status" = 'committing'
        AND "commitLeaseToken" = $3
    `,
    args.batchId,
    args.userId,
    args.leaseToken,
  );
}
