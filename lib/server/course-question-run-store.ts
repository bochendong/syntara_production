import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import {
  appendCourseQuestionTurnInTransaction,
  type PersistedCourseQuestionTurn,
} from '@/lib/server/learn-conversation-store';

const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const COURSE_QUESTION_TRANSACTION_MAX_WAIT_MS = 10_000;
const COURSE_QUESTION_TRANSACTION_TIMEOUT_MS = 20_000;

export type CourseQuestionRunStatus = 'processing' | 'completed' | 'failed';

export type CourseQuestionRunRecord = {
  id: string;
  ownerId: string;
  courseId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  sessionId: string;
  status: CourseQuestionRunStatus;
  leaseToken: string | null;
  leaseExpiresAt: string | null;
  question: string;
  answer: string | null;
  responseJson: unknown;
  conversationId: string | null;
  userMessageId: string | null;
  assistantMessageId: string | null;
  model: string | null;
  errorReason: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

type RawCourseQuestionRunRow = Omit<
  CourseQuestionRunRecord,
  'leaseExpiresAt' | 'createdAt' | 'updatedAt' | 'completedAt'
> & {
  leaseExpiresAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  completedAt: Date | string | null;
};

export type CourseQuestionRunStoreErrorCode =
  | 'idempotency_conflict'
  | 'request_in_progress'
  | 'lease_lost'
  | 'run_not_found';

export class CourseQuestionRunStoreError extends Error {
  constructor(
    readonly code: CourseQuestionRunStoreErrorCode,
    readonly status: 404 | 409,
    message: string,
  ) {
    super(message);
    this.name = 'CourseQuestionRunStoreError';
  }
}

export type CourseQuestionRunClaim =
  | {
      kind: 'claimed';
      run: CourseQuestionRunRecord;
      leaseToken: string;
    }
  | {
      kind: 'completed';
      run: CourseQuestionRunRecord;
      response: unknown;
    };

function serializeRow(row: RawCourseQuestionRunRow): CourseQuestionRunRecord {
  return {
    ...row,
    leaseExpiresAt: row.leaseExpiresAt ? new Date(row.leaseExpiresAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : null,
  };
}

function makeRunId(): string {
  return `course_question_run_${randomUUID().replace(/-/g, '')}`;
}

function makeLeaseToken(): string {
  return `course_question_lease_${randomUUID().replace(/-/g, '')}`;
}

export function stableCourseQuestionSessionId(args: {
  userId: string;
  courseId: string;
  idempotencyKey: string;
}): string {
  const digest = createHash('sha256')
    .update([args.userId, args.courseId, args.idempotencyKey].join('\0'))
    .digest('hex')
    .slice(0, 24);
  return `s_api_${digest}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export function hashCourseQuestionPayload(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

async function findRun(args: {
  prisma: PrismaClient;
  userId: string;
  courseId: string;
  idempotencyKey: string;
}): Promise<CourseQuestionRunRecord | null> {
  const rows = await args.prisma.$queryRawUnsafe<RawCourseQuestionRunRow[]>(
    `
      SELECT *
      FROM "CourseQuestionRun"
      WHERE "ownerId" = $1
        AND "courseId" = $2
        AND "idempotencyKey" = $3
      LIMIT 1
    `,
    args.userId,
    args.courseId,
    args.idempotencyKey,
  );
  return rows[0] ? serializeRow(rows[0]) : null;
}

export async function claimCourseQuestionRun(args: {
  prisma: PrismaClient;
  userId: string;
  courseId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string;
  sessionId: string;
  question: string;
  leaseMs?: number;
}): Promise<CourseQuestionRunClaim> {
  const leaseToken = makeLeaseToken();
  const leaseMs = Math.max(30_000, Math.min(args.leaseMs ?? DEFAULT_LEASE_MS, 15 * 60 * 1000));
  const inserted = await args.prisma.$queryRawUnsafe<RawCourseQuestionRunRow[]>(
    `
      INSERT INTO "CourseQuestionRun" (
        "id", "ownerId", "courseId", "idempotencyKey", "requestHash",
        "requestId", "sessionId", "status", "leaseToken", "leaseExpiresAt",
        "question", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, 'processing', $8, CURRENT_TIMESTAMP + ($9 * INTERVAL '1 millisecond'),
        $10, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("ownerId", "courseId", "idempotencyKey") DO NOTHING
      RETURNING *
    `,
    makeRunId(),
    args.userId,
    args.courseId,
    args.idempotencyKey,
    args.requestHash,
    args.requestId,
    args.sessionId,
    leaseToken,
    leaseMs,
    args.question,
  );
  if (inserted[0]) {
    return { kind: 'claimed', run: serializeRow(inserted[0]), leaseToken };
  }

  const existing = await findRun(args);
  if (!existing) {
    throw new CourseQuestionRunStoreError(
      'run_not_found',
      404,
      'The course question run could not be found after claiming it.',
    );
  }
  if (existing.requestHash !== args.requestHash || existing.sessionId !== args.sessionId) {
    throw new CourseQuestionRunStoreError(
      'idempotency_conflict',
      409,
      'The Idempotency-Key was already used with a different request payload.',
    );
  }
  if (existing.status === 'completed' && existing.responseJson != null) {
    return { kind: 'completed', run: existing, response: existing.responseJson };
  }

  const reclaimed = await args.prisma.$queryRawUnsafe<RawCourseQuestionRunRow[]>(
    `
      UPDATE "CourseQuestionRun"
      SET "status" = 'processing',
          "requestId" = $1,
          "leaseToken" = $2,
          "leaseExpiresAt" = CURRENT_TIMESTAMP + ($3 * INTERVAL '1 millisecond'),
          "errorReason" = NULL,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $4
        AND "requestHash" = $5
        AND (
          "status" = 'failed'
          OR ("status" = 'processing' AND "leaseExpiresAt" <= CURRENT_TIMESTAMP)
        )
      RETURNING *
    `,
    args.requestId,
    leaseToken,
    leaseMs,
    existing.id,
    args.requestHash,
  );
  if (reclaimed[0]) {
    return { kind: 'claimed', run: serializeRow(reclaimed[0]), leaseToken };
  }
  throw new CourseQuestionRunStoreError(
    'request_in_progress',
    409,
    'A request with this Idempotency-Key is already in progress.',
  );
}

export async function completeCourseQuestionRun<T>(args: {
  prisma: PrismaClient;
  runId: string;
  leaseToken: string;
  requestHash: string;
  userId: string;
  courseId: string;
  sessionId: string;
  idempotencyKey: string;
  requestId: string;
  title: string;
  question: string;
  answer: string;
  model: string;
  learningActions?: unknown[];
  artifacts?: unknown[];
  publicTrace?: unknown;
  buildResponse: (turn: PersistedCourseQuestionTurn) => T;
}): Promise<{ response: T; turn: PersistedCourseQuestionTurn }> {
  return args.prisma.$transaction(
    async (tx) => {
      const lockedRows = await tx.$queryRawUnsafe<RawCourseQuestionRunRow[]>(
        `
        SELECT *
        FROM "CourseQuestionRun"
        WHERE "id" = $1
        FOR UPDATE
      `,
        args.runId,
      );
      const locked = lockedRows[0];
      if (!locked) {
        throw new CourseQuestionRunStoreError(
          'run_not_found',
          404,
          'The course question run no longer exists.',
        );
      }
      if (
        locked.status !== 'processing' ||
        locked.leaseToken !== args.leaseToken ||
        locked.requestHash !== args.requestHash ||
        !locked.leaseExpiresAt ||
        new Date(locked.leaseExpiresAt).getTime() <= Date.now()
      ) {
        throw new CourseQuestionRunStoreError(
          'lease_lost',
          409,
          'The course question run lease was lost before completion.',
        );
      }

      const turn = await appendCourseQuestionTurnInTransaction(tx, {
        userId: args.userId,
        courseId: args.courseId,
        sessionId: args.sessionId,
        idempotencyKey: args.idempotencyKey,
        requestId: args.requestId,
        requestPayloadHash: args.requestHash,
        title: args.title,
        question: args.question,
        answer: args.answer,
        learningActions: args.learningActions,
        artifacts: args.artifacts,
        publicTrace: args.publicTrace,
      });
      const response = args.buildResponse(turn);
      const updated = await tx.$executeRawUnsafe(
        `
        UPDATE "CourseQuestionRun"
        SET "status" = 'completed',
            "answer" = $1,
            "responseJson" = $2::jsonb,
            "conversationId" = $3,
            "userMessageId" = $4,
            "assistantMessageId" = $5,
            "model" = $6,
            "leaseToken" = NULL,
            "leaseExpiresAt" = NULL,
            "errorReason" = NULL,
            "completedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $7
          AND "status" = 'processing'
          AND "leaseToken" = $8
          AND "requestHash" = $9
      `,
        turn.answer,
        JSON.stringify(response),
        turn.session.conversationId,
        turn.userMessageId,
        turn.assistantMessageId,
        args.model,
        args.runId,
        args.leaseToken,
        args.requestHash,
      );
      if (updated !== 1) {
        throw new CourseQuestionRunStoreError(
          'lease_lost',
          409,
          'The course question run lease was lost during completion.',
        );
      }
      return { response, turn };
    },
    {
      maxWait: COURSE_QUESTION_TRANSACTION_MAX_WAIT_MS,
      timeout: COURSE_QUESTION_TRANSACTION_TIMEOUT_MS,
    },
  );
}

export async function failCourseQuestionRun(args: {
  prisma: PrismaClient;
  runId: string;
  leaseToken: string;
  errorReason: string;
}): Promise<boolean> {
  const updated = await args.prisma.$executeRawUnsafe(
    `
      UPDATE "CourseQuestionRun"
      SET "status" = 'failed',
          "leaseToken" = NULL,
          "leaseExpiresAt" = NULL,
          "errorReason" = $1,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE "id" = $2
        AND "status" = 'processing'
        AND "leaseToken" = $3
    `,
    args.errorReason.slice(0, 4000),
    args.runId,
    args.leaseToken,
  );
  return updated === 1;
}
