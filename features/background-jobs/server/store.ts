import { createHash, randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import type { Prisma, PrismaClient, BackgroundJob } from '@/lib/server/generated-prisma';

export type JobDb = PrismaClient | Prisma.TransactionClient;
export type JobKind = 'learner-note' | 'conversation-memory' | 'mini-lecture' | 'memory-index';
export class JobConflictError extends Error {}
export class JobLeaseLostError extends Error {}
export const LEASE_MS = 120_000;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
export function inputHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}
export function packResult(value: unknown): Uint8Array<ArrayBuffer> {
  return new Uint8Array(gzipSync(JSON.stringify(value)));
}
export function unpackResult<T>(value: Uint8Array): T {
  return JSON.parse(gunzipSync(value).toString('utf8')) as T;
}

/** Call inside the source-write transaction for memory work. Never run a model here. */
export async function enqueueJob(
  db: JobDb,
  args: {
    ownerId: string;
    courseId?: string | null;
    kind: JobKind;
    key: string;
    payload: Prisma.InputJsonValue;
    delayMs?: number;
  },
) {
  const hash = inputHash({
    kind: args.kind,
    courseId: args.courseId || null,
    payload: args.payload,
  });
  // Prisma emulates an upsert with an empty update; concurrent confirmations can
  // otherwise race into P2002. This single statement also works inside intake TXs.
  const rows = await db.$queryRaw<Array<{ id: string; status: string; inputHash: string }>>`
    INSERT INTO "BackgroundJob" ("id", "ownerId", "courseId", "kind", "dedupeKey", "inputHash", "payload", "availableAt", "updatedAt")
    VALUES (${randomUUID()}, ${args.ownerId}, ${args.courseId || null}, ${args.kind}, ${args.key}, ${hash}, ${JSON.stringify(args.payload)}::jsonb, ${new Date(Date.now() + (args.delayMs || 0))}, CURRENT_TIMESTAMP)
    ON CONFLICT ("ownerId", "dedupeKey") DO UPDATE SET "id" = "BackgroundJob"."id"
    RETURNING "id", "status", "inputHash"`;
  const job = rows[0];
  if (job.inputHash !== hash) throw new JobConflictError('这个操作已绑定其他内容，请重新发起。');
  return { id: job.id, status: job.status };
}

export async function claimJob(db: PrismaClient, kinds?: JobKind[]): Promise<BackgroundJob | null> {
  await db.backgroundJob.updateMany({
    where: { status: 'running', leaseUntil: { lt: new Date() }, attempts: { gte: 3 } },
    data: { status: 'failed', error: '任务多次中断，请重试。', leaseToken: null, leaseUntil: null },
  });
  const token = randomUUID();
  const rows = await db.$queryRaw<BackgroundJob[]>`
    UPDATE "BackgroundJob" SET "status" = 'running', "leaseToken" = ${token},
      "leaseUntil" = CURRENT_TIMESTAMP + INTERVAL '120 seconds',
      "attempts" = "attempts" + 1, "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = (
      SELECT "id" FROM "BackgroundJob"
      WHERE (("status" = 'queued' AND "availableAt" <= CURRENT_TIMESTAMP)
        OR ("status" = 'running' AND "leaseUntil" < CURRENT_TIMESTAMP))
        AND "attempts" < "maxAttempts"
        AND (${!kinds?.length} OR "kind" = ANY(${kinds || []}::text[]))
      ORDER BY CASE WHEN "kind" = 'mini-lecture' THEN 0 ELSE 1 END, "availableAt"
      FOR UPDATE SKIP LOCKED LIMIT 1
    ) RETURNING *`;
  return rows[0] || null;
}
export async function renewLease(db: JobDb, job: BackgroundJob): Promise<boolean> {
  const { count } = await db.backgroundJob.updateMany({
    where: {
      id: job.id,
      status: 'running',
      leaseToken: job.leaseToken,
      leaseUntil: { gt: new Date() },
    },
    data: { leaseUntil: new Date(Date.now() + LEASE_MS) },
  });
  return count === 1;
}
export async function finishJob(db: JobDb, job: BackgroundJob, result: unknown): Promise<boolean> {
  const { count } = await db.backgroundJob.updateMany({
    where: {
      id: job.id,
      status: 'running',
      leaseToken: job.leaseToken,
      leaseUntil: { gt: new Date() },
    },
    data: {
      status: 'completed',
      result: packResult(result),
      completedAt: new Date(),
      leaseUntil: null,
      leaseToken: null,
      error: null,
    },
  });
  return count === 1;
}
export async function failJob(db: JobDb, job: BackgroundJob, error: unknown) {
  // A reclaimed worker cannot overwrite the new worker's result.
  await db.backgroundJob.updateMany({
    where: {
      id: job.id,
      status: 'running',
      leaseToken: job.leaseToken,
      leaseUntil: { gt: new Date() },
    },
    data: {
      status: job.attempts < job.maxAttempts ? 'queued' : 'failed',
      availableAt: new Date(Date.now() + 15_000 * 2 ** job.attempts),
      leaseUntil: null,
      leaseToken: null,
      error: error instanceof Error ? error.message.slice(0, 1000) : '后台任务失败。',
    },
  });
}

/** Completed generation stages survive retries and process restarts. */
export async function checkpoint<T>(
  db: PrismaClient,
  job: BackgroundJob,
  key: string,
  run: () => Promise<T>,
): Promise<T> {
  const saved = await db.backgroundJobStep.findUnique({
    where: { jobId_key: { jobId: job.id, key } },
  });
  if (saved) return unpackResult<T>(saved.result);
  if (!(await renewLease(db, job))) throw new JobLeaseLostError('Task lease expired');
  const result = await run();
  await db.$transaction(async (tx) => {
    if (!(await renewLease(tx, job))) throw new JobLeaseLostError('Task lease expired');
    await tx.backgroundJobStep.upsert({
      where: { jobId_key: { jobId: job.id, key } },
      create: { jobId: job.id, key, result: packResult(result) },
      update: {},
    });
  });
  return result;
}
