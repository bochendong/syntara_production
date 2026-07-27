import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@prisma/client';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  findCourseAccessRole,
  type CourseAccessRole,
  withCourseEnrollmentSchemaFallback,
} from '@/lib/server/repositories/course-enrollment-repository';

const LEARN_CONVERSATION_TARGET_PREFIX = 'learn:';
const MAX_SYNCED_MESSAGES = 120;
const MAX_SYNCED_LEARNING_ACTIONS = 40;
const DEFAULT_SESSION_PAGE_LIMIT = 5;
const MAX_SESSION_PAGE_LIMIT = 100;
const MAX_CONVERSATION_READ_FENCE_ATTEMPTS = 3;
const CONVERSATION_TRANSACTION_MAX_WAIT_MS = 10_000;
const CONVERSATION_TRANSACTION_TIMEOUT_MS = 20_000;

type LearnConversationRow = {
  id: string;
  title: string | null;
  targetId: string | null;
  meta: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  cursorUpdatedAt?: string;
};

type LearnConversationPageRow = {
  accessRole: CourseAccessRole | null;
  id: string | null;
  title: string | null;
  targetId: string | null;
  meta: unknown;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  cursorUpdatedAt: string | null;
};

type LearnConversationCursor = {
  updatedAt: string;
  id: string;
};

type LearnMessageContent = {
  text?: unknown;
  plan?: unknown;
  progressProposal?: unknown;
  pendingAction?: unknown;
  lecturePrompt?: unknown;
  lectureDeck?: unknown;
  learningActions?: unknown;
  artifacts?: unknown;
  publicTrace?: unknown;
  attachments?: unknown;
};

type LearnConversationDbClient = PrismaClient | Prisma.TransactionClient;

type LearnMessageRow = {
  id: string;
  role: string;
  content: LearnMessageContent | null;
  plainText: string | null;
  meta: unknown;
  createdAt: Date | string;
};

const clientRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const baseRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sessionPageLimitSchema = z.coerce.number().int().min(1).max(MAX_SESSION_PAGE_LIMIT);
const sessionPageCursorSchema = z.object({
  updatedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/)
    .refine((value) => {
      const millisecondTimestamp = value.slice(0, 23);
      const parsed = new Date(`${millisecondTimestamp}Z`);
      return (
        Number.isFinite(parsed.getTime()) &&
        parsed.toISOString().slice(0, 23) === millisecondTimestamp
      );
    }),
  id: z.string().min(1).max(240),
});

const learningActionKindSchema = z.enum([
  'calendar.propose_add',
  'calendar.propose_update',
  'calendar.propose_delete',
  'calendar.search',
  'calendar.start_recent',
  'memory.search',
  'web.search',
  'review_mode.request_choice',
  'learner_progress.request_confirmation',
  'practice.propose_generation',
  'classroom.propose_temporary_explanation',
  'image.propose_generation',
  'memory.propose_write',
]);
const learningActionStatusSchema = z.enum([
  'proposed',
  'confirmed',
  'cancelled',
  'completed',
  'failed',
]);
const learningActionEvidenceSchema = z.object({
  sourceType: z.enum([
    'notebook',
    'memory',
    'problem_bank',
    'calendar',
    'source',
    'web',
    'user',
    'system',
  ]),
  sourceId: z.string().max(240).optional(),
  title: z.string().max(1000).optional(),
  reason: z.string().max(4000).optional(),
});
const learningActionExecutionResultSchema = z.object({
  status: learningActionStatusSchema,
  executor: z.enum(['learn-client', 'server', 'simulator']),
  executedAt: z.number().finite(),
  summary: z.string().max(10000),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(10000).optional(),
  trace: z
    .object({
      actionId: z.string().min(1).max(240),
      actionKind: learningActionKindSchema,
      courseId: z.string().max(240).optional(),
      conversationId: z.string().max(240).optional(),
    })
    .optional(),
});
const learningActionSchema = z.object({
  id: z.string().trim().min(1).max(240),
  kind: learningActionKindSchema,
  label: z.string().trim().min(1).max(1000),
  summary: z.string().max(10000).optional(),
  status: learningActionStatusSchema.optional(),
  confirmation: z.enum(['none', 'optional', 'required']).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  result: learningActionExecutionResultSchema.optional(),
  evidence: z.array(learningActionEvidenceSchema).max(40).optional(),
});

const learnMessageSchema = z.object({
  id: z.string().trim().min(1).max(160),
  role: z.enum(['user', 'assistant']),
  text: z.string().max(40000).default(''),
  createdAt: z.number().finite().optional(),
  plan: z.unknown().optional(),
  progressProposal: z.unknown().optional(),
  pendingAction: z.unknown().optional(),
  lecturePrompt: z.unknown().optional(),
  lectureDeck: z.unknown().optional(),
  learningActions: z.array(learningActionSchema).max(MAX_SYNCED_LEARNING_ACTIONS).optional(),
  artifacts: z.unknown().optional(),
  publicTrace: z.unknown().optional(),
  attachments: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        mimeType: z.string().optional(),
        size: z.number().finite().optional(),
        width: z.number().finite().optional(),
        height: z.number().finite().optional(),
      }),
    )
    .optional(),
});

const syncLearnConversationSchema = z.object({
  courseId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1).max(160),
  title: z.string().trim().max(200).optional(),
  messages: z.array(learnMessageSchema).max(MAX_SYNCED_MESSAGES).default([]),
  baseRevision: baseRevisionSchema.optional(),
  clientRevision: clientRevisionSchema.optional(),
});

function learnTargetId(sessionId: string) {
  return `${LEARN_CONVERSATION_TARGET_PREFIX}${sessionId}`;
}

function sessionIdFromTargetId(targetId: string | null): string {
  if (!targetId?.startsWith(LEARN_CONVERSATION_TARGET_PREFIX)) return 'default';
  return targetId.slice(LEARN_CONVERSATION_TARGET_PREFIX.length) || 'default';
}

function timestamp(value: Date | string): number {
  return new Date(value).getTime();
}

function makeDbId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}

function encodeSessionPageCursor(row: LearnConversationRow): string {
  const payload: LearnConversationCursor = {
    updatedAt: row.cursorUpdatedAt ?? `${new Date(row.updatedAt).toISOString().slice(0, 23)}000`,
    id: row.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

function decodeSessionPageCursor(rawCursor: string): LearnConversationCursor | null {
  if (!rawCursor || rawCursor.length > 1024) return null;
  try {
    const decoded = JSON.parse(Buffer.from(rawCursor, 'base64url').toString('utf8'));
    const parsed = sessionPageCursorSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function conversationMeta(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function conversationRevision(value: unknown): number {
  const revision = conversationMeta(value).clientRevision;
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0
    ? revision
    : 0;
}

function conversationIsDeleted(value: unknown): boolean {
  return conversationMeta(value).deleted === true;
}

function nextAcceptedRevision(currentRevision: number, requestedRevision?: number): number {
  return requestedRevision ?? Math.max(1, currentRevision + 1);
}

async function lockLearnConversation(
  prisma: LearnConversationDbClient,
  args: { userId: string; courseId: string; sessionId: string },
) {
  const lockKey = [
    LEARN_CONVERSATION_TARGET_PREFIX,
    args.userId,
    args.courseId,
    args.sessionId,
  ].join(':');
  await prisma.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "locked"',
    lockKey,
  );
}

function plainTextFromMessage(message: z.infer<typeof learnMessageSchema>) {
  const suffix = message.attachments?.length ? `\n[附件 ${message.attachments.length} 个]` : '';
  return `${message.text || ''}${suffix}`.trim();
}

function contentFromMessage(message: z.infer<typeof learnMessageSchema>) {
  return {
    type: 'learn_message',
    text: message.text,
    plan: message.plan ?? null,
    progressProposal: message.progressProposal ?? null,
    pendingAction: message.pendingAction ?? null,
    lecturePrompt: message.lecturePrompt ?? null,
    lectureDeck: message.lectureDeck ?? null,
    learningActions: message.learningActions ?? null,
    artifacts: message.artifacts ?? null,
    publicTrace: message.publicTrace ?? null,
    attachments: message.attachments ?? [],
  };
}

function messageFromRow(row: LearnMessageRow) {
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    text:
      typeof row.content?.text === 'string'
        ? row.content.text
        : typeof row.plainText === 'string'
          ? row.plainText
          : '',
    createdAt: timestamp(row.createdAt),
    plan: row.content?.plan ?? undefined,
    progressProposal: row.content?.progressProposal ?? undefined,
    pendingAction: row.content?.pendingAction ?? undefined,
    lecturePrompt: row.content?.lecturePrompt ?? undefined,
    lectureDeck: row.content?.lectureDeck ?? undefined,
    learningActions: Array.isArray(row.content?.learningActions)
      ? row.content.learningActions
      : undefined,
    artifacts: row.content?.artifacts ?? undefined,
    publicTrace: row.content?.publicTrace ?? undefined,
    attachments: Array.isArray(row.content?.attachments) ? row.content.attachments : undefined,
  };
}

function sessionFromRow(row: LearnConversationRow) {
  const sessionId = sessionIdFromTargetId(row.targetId);
  return {
    id: sessionId,
    conversationId: row.id,
    title: row.title?.trim() || '新对话',
    createdAt: timestamp(row.createdAt),
    updatedAt: timestamp(row.updatedAt),
    currentRevision: conversationRevision(row.meta),
  };
}

async function requireCourseAccess(prisma: PrismaClient, userId: string, courseId: string) {
  const access = await findCourseAccessRole(prisma, userId, courseId);
  if (!access) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
  return null;
}

async function findLearnConversation(
  prisma: LearnConversationDbClient,
  args: { userId: string; courseId: string; sessionId: string },
) {
  const rows = await prisma.$queryRawUnsafe<LearnConversationRow[]>(
    `
      SELECT "id", "title", "targetId", "meta", "createdAt", "updatedAt"
      FROM "Conversation"
      WHERE "ownerId" = $1
        AND "courseId" = $2
        AND "targetId" = $3
        AND "kind"::text = 'course'
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `,
    args.userId,
    args.courseId,
    learnTargetId(args.sessionId),
  );
  return rows[0] ?? null;
}

async function listLearnConversations(
  prisma: PrismaClient,
  args: {
    userId: string;
    courseId: string;
    limit: number;
    cursor: LearnConversationCursor | null;
  },
): Promise<{ accessRole: CourseAccessRole | null; rows: LearnConversationRow[] }> {
  let pageRows: LearnConversationPageRow[];
  const cursor = args.cursor;
  if (cursor) {
    pageRows = await withCourseEnrollmentSchemaFallback(prisma, () =>
      prisma.$queryRawUnsafe<LearnConversationPageRow[]>(
        `
            WITH "courseAccess" AS (
              SELECT
                CASE
                  WHEN course."ownerId" = $6 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1
                    FROM "CourseEnrollment"
                    WHERE "userId" = $7 AND "courseId" = $8
                  ) OR EXISTS (
                    SELECT 1
                    FROM "CoursePurchase"
                    WHERE "buyerId" = $9 AND "sourceCourseId" = $10
                  ) THEN 'enrolled'
                  ELSE NULL
                END AS "accessRole"
              FROM "Course" AS course
              WHERE course."id" = $11
              LIMIT 1
            )
            SELECT
              access."accessRole",
              conversation."id",
              conversation."title",
              conversation."targetId",
              conversation."meta",
              conversation."createdAt",
              conversation."updatedAt",
              conversation."cursorUpdatedAt"
            FROM "courseAccess" AS access
            LEFT JOIN LATERAL (
              SELECT
                "id",
                "title",
                "targetId",
                "meta",
                "createdAt",
                "updatedAt",
                to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "cursorUpdatedAt"
              FROM "Conversation"
              WHERE "ownerId" = $1
                AND "courseId" = $2
                AND "kind"::text = 'course'
                AND "targetId" LIKE '${LEARN_CONVERSATION_TARGET_PREFIX}%'
                AND "meta"->>'deleted' IS DISTINCT FROM 'true'
                AND ("updatedAt", "id") < (CAST($3 AS TIMESTAMP), $4)
                AND access."accessRole" IS NOT NULL
              ORDER BY "updatedAt" DESC, "id" DESC
              LIMIT $5
            ) AS conversation ON TRUE
            ORDER BY conversation."updatedAt" DESC NULLS LAST, conversation."id" DESC NULLS LAST
          `,
        args.userId,
        args.courseId,
        cursor.updatedAt,
        cursor.id,
        args.limit + 1,
        args.userId,
        args.userId,
        args.courseId,
        args.userId,
        args.courseId,
        args.courseId,
      ),
    );
  } else {
    pageRows = await withCourseEnrollmentSchemaFallback(prisma, () =>
      prisma.$queryRawUnsafe<LearnConversationPageRow[]>(
        `
            WITH "courseAccess" AS (
              SELECT
                CASE
                  WHEN course."ownerId" = $4 THEN 'owner'
                  WHEN EXISTS (
                    SELECT 1
                    FROM "CourseEnrollment"
                    WHERE "userId" = $5 AND "courseId" = $6
                  ) OR EXISTS (
                    SELECT 1
                    FROM "CoursePurchase"
                    WHERE "buyerId" = $7 AND "sourceCourseId" = $8
                  ) THEN 'enrolled'
                  ELSE NULL
                END AS "accessRole"
              FROM "Course" AS course
              WHERE course."id" = $9
              LIMIT 1
            )
            SELECT
              access."accessRole",
              conversation."id",
              conversation."title",
              conversation."targetId",
              conversation."meta",
              conversation."createdAt",
              conversation."updatedAt",
              conversation."cursorUpdatedAt"
            FROM "courseAccess" AS access
            LEFT JOIN LATERAL (
              SELECT
                "id",
                "title",
                "targetId",
                "meta",
                "createdAt",
                "updatedAt",
                to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "cursorUpdatedAt"
              FROM "Conversation"
              WHERE "ownerId" = $1
                AND "courseId" = $2
                AND "kind"::text = 'course'
                AND "targetId" LIKE '${LEARN_CONVERSATION_TARGET_PREFIX}%'
                AND "meta"->>'deleted' IS DISTINCT FROM 'true'
                AND access."accessRole" IS NOT NULL
              ORDER BY "updatedAt" DESC, "id" DESC
              LIMIT $3
            ) AS conversation ON TRUE
            ORDER BY conversation."updatedAt" DESC NULLS LAST, conversation."id" DESC NULLS LAST
          `,
        args.userId,
        args.courseId,
        args.limit + 1,
        args.userId,
        args.userId,
        args.courseId,
        args.userId,
        args.courseId,
        args.courseId,
      ),
    );
  }

  const accessRole = pageRows[0]?.accessRole ?? null;
  const rows = pageRows.flatMap((row): LearnConversationRow[] =>
    accessRole && row.id && row.createdAt && row.updatedAt
      ? [
          {
            id: row.id,
            title: row.title,
            targetId: row.targetId,
            meta: row.meta,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            cursorUpdatedAt: row.cursorUpdatedAt || undefined,
          },
        ]
      : [],
  );
  return { accessRole, rows };
}

async function upsertLearnConversation(
  prisma: LearnConversationDbClient,
  args: {
    userId: string;
    courseId: string;
    sessionId: string;
    title: string;
    clientRevision: number;
    deleted: boolean;
    existing: LearnConversationRow | null;
  },
) {
  const meta = {
    ...conversationMeta(args.existing?.meta),
    source: 'learn',
    sessionId: args.sessionId,
    clientRevision: args.clientRevision,
    deleted: args.deleted,
  };
  if (args.existing) {
    await prisma.$executeRawUnsafe(
      `
        UPDATE "Conversation"
        SET "title" = $1,
            "meta" = CAST($2 AS JSONB),
            "updatedAt" = NOW()
        WHERE "id" = $3 AND "ownerId" = $4
      `,
      args.title,
      JSON.stringify(meta),
      args.existing.id,
      args.userId,
    );
    return {
      ...args.existing,
      title: args.title,
      meta,
      updatedAt: new Date(),
    };
  }

  const id = makeDbId('learn_conversation');
  const rows = await prisma.$queryRawUnsafe<LearnConversationRow[]>(
    `
      INSERT INTO "Conversation" (
        "id", "ownerId", "courseId", "kind", "targetId", "title", "meta", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, 'course', $4, $5, CAST($6 AS JSONB), NOW(), NOW())
      RETURNING "id", "title", "targetId", "meta", "createdAt", "updatedAt"
    `,
    id,
    args.userId,
    args.courseId,
    learnTargetId(args.sessionId),
    args.title,
    JSON.stringify(meta),
  );
  return rows[0];
}

async function replaceLearnMessages(
  prisma: LearnConversationDbClient,
  args: {
    conversationId: string;
    userId: string;
    courseId: string;
    sessionId: string;
    messages: Array<z.infer<typeof learnMessageSchema>>;
  },
) {
  // A client should not send duplicate message ids, but collapsing them here
  // preserves the old loop's last-write-wins behavior and keeps PostgreSQL's
  // one-row-per-ON-CONFLICT rule explicit.
  const messages = Array.from(
    new Map(
      args.messages.slice(-MAX_SYNCED_MESSAGES).map((message) => [message.id, message] as const),
    ).values(),
  );
  const ids = messages.map((message) => message.id);
  const existingMessages = ids.length
    ? await prisma.message.findMany({
        where: { id: { in: ids } },
        select: { id: true, ownerId: true, conversationId: true },
      })
    : [];
  const conflictingMessage = existingMessages.find(
    (message) => message.ownerId !== args.userId || message.conversationId !== args.conversationId,
  );
  if (conflictingMessage) {
    throw new Error(
      `Message id conflict: ${conflictingMessage.id} already belongs to another conversation.`,
    );
  }
  await prisma.message.deleteMany({
    where: {
      conversationId: args.conversationId,
      ownerId: args.userId,
      ...(ids.length > 0 ? { id: { notIn: ids } } : {}),
    },
  });

  if (messages.length === 0) return;
  const now = new Date();
  const payload = messages.map((message) => ({
    id: message.id,
    role: message.role,
    content: contentFromMessage(message),
    plainText: plainTextFromMessage(message),
    meta: {
      source: 'learn',
      courseId: args.courseId,
      sessionId: args.sessionId,
      clientCreatedAt: message.createdAt ?? null,
    },
    createdAt: (message.createdAt ? new Date(message.createdAt) : now).toISOString(),
  }));

  // Keep the advisory-lock transaction short: one set-based statement replaces
  // up to 240 update/create round trips. The ownership predicate prevents an
  // id collision from mutating a message in another conversation; the affected
  // row count below turns a concurrent collision into an explicit failure.
  const affectedRows = await prisma.$executeRawUnsafe(
    `
      WITH payload AS (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS item(
          "id" TEXT,
          "role" TEXT,
          "content" JSONB,
          "plainText" TEXT,
          "meta" JSONB,
          "createdAt" TIMESTAMP
        )
      )
      INSERT INTO "Message" (
        "id", "conversationId", "ownerId", "role", "content", "plainText", "meta", "createdAt"
      )
      SELECT
        payload."id",
        $2,
        $3,
        payload."role",
        payload."content",
        payload."plainText",
        payload."meta",
        payload."createdAt"
      FROM payload
      ON CONFLICT ("id") DO UPDATE
      SET
        "role" = EXCLUDED."role",
        "content" = EXCLUDED."content",
        "plainText" = EXCLUDED."plainText",
        "meta" = EXCLUDED."meta"
      WHERE "Message"."conversationId" = EXCLUDED."conversationId"
        AND "Message"."ownerId" = EXCLUDED."ownerId"
    `,
    JSON.stringify(payload),
    args.conversationId,
    args.userId,
  );
  if (affectedRows !== messages.length) {
    throw new Error('Message id conflict detected while synchronizing the conversation.');
  }
}

async function loadMessages(
  prisma: LearnConversationDbClient,
  conversationId: string,
  userId: string,
) {
  const rows = await prisma.message.findMany({
    where: { conversationId, ownerId: userId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      role: true,
      content: true,
      plainText: true,
      meta: true,
      createdAt: true,
    },
  });
  return rows.map((row) =>
    messageFromRow({
      ...row,
      content: row.content as LearnMessageContent | null,
    }),
  );
}

function sameConversationReadFence(
  left: LearnConversationRow,
  right: LearnConversationRow,
): boolean {
  return (
    left.id === right.id &&
    timestamp(left.updatedAt) === timestamp(right.updatedAt) &&
    conversationRevision(left.meta) === conversationRevision(right.meta) &&
    conversationIsDeleted(left.meta) === conversationIsDeleted(right.meta)
  );
}

async function loadLearnConversationWithoutTransaction(
  prisma: PrismaClient,
  args: { userId: string; courseId: string; sessionId: string },
) {
  let conversation = await findLearnConversation(prisma, args);

  for (let attempt = 0; attempt < MAX_CONVERSATION_READ_FENCE_ATTEMPTS; attempt += 1) {
    if (!conversation || conversationIsDeleted(conversation.meta)) {
      return {
        session: null,
        messages: [],
        currentRevision: conversationRevision(conversation?.meta),
      };
    }

    const messages = await loadMessages(prisma, conversation.id, args.userId);
    const confirmedConversation = await findLearnConversation(prisma, args);
    if (
      confirmedConversation &&
      !conversationIsDeleted(confirmedConversation.meta) &&
      sameConversationReadFence(conversation, confirmedConversation)
    ) {
      return {
        session: sessionFromRow(confirmedConversation),
        messages,
        currentRevision: conversationRevision(confirmedConversation.meta),
      };
    }
    conversation = confirmedConversation;
  }

  // A writer kept changing this session throughout every bounded read attempt.
  // Let the client retain its local snapshot and retry instead of returning a
  // mismatched conversation revision and message set.
  throw new Error('Conversation changed while it was being read; please retry.');
}

async function listLearnConversationPageWithoutTransaction(
  prisma: PrismaClient,
  args: {
    userId: string;
    courseId: string;
    limit: number;
    cursor: LearnConversationCursor | null;
  },
) {
  const { accessRole, rows } = await listLearnConversations(prisma, args);
  const hasMore = rows.length > args.limit;
  const visibleRows = hasMore ? rows.slice(0, args.limit) : rows;
  return {
    accessRole,
    sessions: visibleRows.map(sessionFromRow),
    hasMore,
    nextCursor:
      hasMore && visibleRows.length > 0
        ? encodeSessionPageCursor(visibleRows[visibleRows.length - 1])
        : null,
    // The initial screen needs five names and a lookahead bit, not an exact
    // COUNT. The client grows this lower bound as additional pages are loaded.
    totalCount: visibleRows.length,
  };
}

export async function GET(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const prisma = getOptionalPrisma();
    if (!prisma) {
      return NextResponse.json({
        storage: 'unavailable',
        sessions: [],
        hasMore: false,
        nextCursor: null,
        totalCount: 0,
      });
    }

    const { userId } = auth;
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('courseId')?.trim();
    const sessionId = searchParams.get('sessionId')?.trim();
    if (!courseId) return NextResponse.json({ error: 'Missing courseId' }, { status: 400 });

    if (sessionId) {
      const accessError = await requireCourseAccess(prisma, userId, courseId);
      if (accessError) return accessError;
      const snapshot = await loadLearnConversationWithoutTransaction(prisma, {
        userId,
        courseId,
        sessionId,
      });
      return NextResponse.json({ storage: 'database', ...snapshot });
    }

    const rawLimit = searchParams.get('limit');
    const parsedLimit =
      rawLimit === null
        ? { success: true as const, data: DEFAULT_SESSION_PAGE_LIMIT }
        : sessionPageLimitSchema.safeParse(rawLimit);
    if (!parsedLimit.success) {
      return NextResponse.json(
        {
          error: `Invalid limit; expected an integer between 1 and ${MAX_SESSION_PAGE_LIMIT}`,
        },
        { status: 400 },
      );
    }

    const rawCursor = searchParams.get('cursor');
    const cursor = rawCursor ? decodeSessionPageCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    }

    const page = await listLearnConversationPageWithoutTransaction(prisma, {
      userId,
      courseId,
      limit: parsedLimit.data,
      cursor,
    });
    if (!page.accessRole) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    return NextResponse.json({
      storage: 'database',
      sessions: page.sessions,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      totalCount: page.totalCount,
    });
  });
}

export async function POST(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const prisma = getOptionalPrisma();
    if (!prisma) {
      return NextResponse.json({
        storage: 'unavailable',
        ok: false,
        accepted: false,
        currentRevision: 0,
      });
    }

    const payload = syncLearnConversationSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const { userId } = auth;
    const { courseId, sessionId, messages, baseRevision, clientRevision } = payload.data;
    const accessError = await requireCourseAccess(prisma, userId, courseId);
    if (accessError) return accessError;

    const title = payload.data.title?.trim() || '新对话';
    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await lockLearnConversation(tx, { userId, courseId, sessionId });
        const existing = await findLearnConversation(tx, { userId, courseId, sessionId });
        const currentRevision = conversationRevision(existing?.meta);
        if (existing && conversationIsDeleted(existing.meta)) {
          return {
            accepted: false,
            currentRevision,
            conversation: existing,
            deleted: true,
          };
        }
        if (currentRevision > 0 && baseRevision === undefined) {
          return {
            accepted: false,
            currentRevision,
            conversation: existing,
            deleted: false,
          };
        }
        if (baseRevision !== undefined && baseRevision !== currentRevision) {
          return {
            accepted: false,
            currentRevision,
            conversation: existing,
            deleted: false,
          };
        }
        if (clientRevision !== undefined && clientRevision <= currentRevision) {
          return {
            accepted: false,
            currentRevision,
            conversation: existing,
            deleted: false,
          };
        }

        const acceptedRevision = nextAcceptedRevision(currentRevision, clientRevision);
        const conversation = await upsertLearnConversation(tx, {
          userId,
          courseId,
          sessionId,
          title,
          clientRevision: acceptedRevision,
          deleted: false,
          existing,
        });
        await replaceLearnMessages(tx, {
          conversationId: conversation.id,
          userId,
          courseId,
          sessionId,
          messages,
        });
        return {
          accepted: true,
          currentRevision: acceptedRevision,
          conversation,
          deleted: false,
        };
      },
      {
        maxWait: CONVERSATION_TRANSACTION_MAX_WAIT_MS,
        timeout: CONVERSATION_TRANSACTION_TIMEOUT_MS,
      },
    );

    return NextResponse.json({
      storage: 'database',
      ok: true,
      accepted: result.accepted,
      currentRevision: result.currentRevision,
      deleted: result.deleted,
      session:
        result.conversation && !conversationIsDeleted(result.conversation.meta)
          ? sessionFromRow(result.conversation)
          : null,
    });
  });
}

export async function DELETE(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const prisma = getOptionalPrisma();
    if (!prisma) {
      return NextResponse.json({
        storage: 'unavailable',
        ok: false,
        accepted: false,
        currentRevision: 0,
      });
    }

    const { userId } = auth;
    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('courseId')?.trim();
    const sessionId = searchParams.get('sessionId')?.trim();
    if (!courseId) return NextResponse.json({ error: 'Missing courseId' }, { status: 400 });
    if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });
    const rawClientRevision = searchParams.get('clientRevision');
    const rawBaseRevision = searchParams.get('baseRevision');
    const parsedClientRevision =
      rawClientRevision === null
        ? { success: true as const, data: undefined }
        : clientRevisionSchema.safeParse(Number(rawClientRevision));
    if (!parsedClientRevision.success) {
      return NextResponse.json({ error: 'Invalid clientRevision' }, { status: 400 });
    }
    const parsedBaseRevision =
      rawBaseRevision === null
        ? { success: true as const, data: undefined }
        : baseRevisionSchema.safeParse(Number(rawBaseRevision));
    if (!parsedBaseRevision.success) {
      return NextResponse.json({ error: 'Invalid baseRevision' }, { status: 400 });
    }

    const accessError = await requireCourseAccess(prisma, userId, courseId);
    if (accessError) return accessError;

    const result = await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await lockLearnConversation(tx, { userId, courseId, sessionId });
        const existing = await findLearnConversation(tx, { userId, courseId, sessionId });
        const currentRevision = conversationRevision(existing?.meta);
        const clientRevision = parsedClientRevision.data;
        const baseRevision = parsedBaseRevision.data;
        if (currentRevision > 0 && baseRevision === undefined) {
          return {
            accepted: false,
            currentRevision,
            deleted: conversationIsDeleted(existing?.meta),
          };
        }
        if (baseRevision !== undefined && baseRevision !== currentRevision) {
          return {
            accepted: false,
            currentRevision,
            deleted: conversationIsDeleted(existing?.meta),
          };
        }
        if (clientRevision !== undefined && clientRevision <= currentRevision) {
          return {
            accepted: false,
            currentRevision,
            deleted: conversationIsDeleted(existing?.meta),
          };
        }

        const acceptedRevision = nextAcceptedRevision(currentRevision, clientRevision);
        const conversation = await upsertLearnConversation(tx, {
          userId,
          courseId,
          sessionId,
          title: existing?.title?.trim() || '新对话',
          clientRevision: acceptedRevision,
          deleted: true,
          existing,
        });
        await tx.message.deleteMany({
          where: {
            conversationId: conversation.id,
            ownerId: userId,
          },
        });
        return { accepted: true, currentRevision: acceptedRevision, deleted: true };
      },
      {
        maxWait: CONVERSATION_TRANSACTION_MAX_WAIT_MS,
        timeout: CONVERSATION_TRANSACTION_TIMEOUT_MS,
      },
    );

    return NextResponse.json({
      storage: 'database',
      ok: true,
      accepted: result.accepted,
      currentRevision: result.currentRevision,
      deleted: result.deleted,
    });
  });
}
