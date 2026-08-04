import crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@/lib/server/generated-prisma';

export const DEFAULT_COURSE_CONVERSATION_PAGE_LIMIT = 5;
export const MAX_COURSE_CONVERSATION_PAGE_LIMIT = 100;
export const DEFAULT_COURSE_MESSAGE_PAGE_LIMIT = 30;
export const MAX_COURSE_MESSAGE_PAGE_LIMIT = 120;
export const MAX_RETURNED_COURSE_MESSAGE_TOMBSTONES = 500;

const COURSE_CONVERSATION_LOCK_PREFIX = 'course-conversation';
const MAX_SAFE_REVISION = BigInt(Number.MAX_SAFE_INTEGER);

export type CourseConversationAccessRole = 'owner' | 'enrolled';
export type CourseConversationDbClient = PrismaClient | Prisma.TransactionClient;

export type CourseConversationRow = {
  id: string;
  ownerId: string;
  courseId: string;
  sessionId: string;
  title: string;
  revision: bigint | number | string;
  lastMessageAt: Date | string | null;
  messageCount: number;
  summaryText: string | null;
  summaryThroughSequence: bigint | number | string;
  summaryVersion: number;
  summaryUpdatedAt: Date | string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  cursorUpdatedAt?: string;
};

export type CourseConversationMessageRow = {
  id: string;
  conversationId: string;
  ownerId: string;
  courseId: string;
  sequence: bigint | number | string;
  role: 'user' | 'assistant' | null;
  content: unknown;
  plainText: string | null;
  idempotencyKey: string | null;
  requestId: string | null;
  requestPayloadHash: string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

export type CourseConversationMessageWrite = {
  id: string;
  role: 'user' | 'assistant';
  content: unknown;
  plainText: string;
  createdAt?: number | Date;
  idempotencyKey?: string | null;
  requestId?: string | null;
  requestPayloadHash?: string | null;
};

export type CourseConversationSession = {
  id: string;
  conversationId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  currentRevision: number;
  messageCount: number;
};

export type CourseConversationSummary = {
  text: string;
  throughSequence: string;
  version: number;
  updatedAt: number | null;
};

export type CourseConversationMessagePage = {
  hasMore: boolean;
  nextCursor: string | null;
  limit: number;
};

export type CourseConversationSnapshot = {
  accessRole: CourseConversationAccessRole | null;
  session: CourseConversationSession | null;
  messages: CourseConversationMessageRow[];
  deletedMessageIds: string[];
  messagePage: CourseConversationMessagePage;
  messageWindow: {
    hasMore: boolean;
    isComplete: boolean;
  };
  summary: CourseConversationSummary | null;
  currentRevision: number;
};

type SessionPageCursor = {
  updatedAt: string;
  id: string;
};

type MessagePageCursor = {
  sequence: string;
};

type CourseConversationPageRow = {
  accessRole: CourseConversationAccessRole | null;
  totalCount: bigint | number | string | null;
  id: string | null;
  ownerId: string | null;
  courseId: string | null;
  sessionId: string | null;
  title: string | null;
  revision: bigint | number | string | null;
  lastMessageAt: Date | string | null;
  messageCount: number | null;
  summaryText: string | null;
  summaryThroughSequence: bigint | number | string | null;
  summaryVersion: number | null;
  summaryUpdatedAt: Date | string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string | null;
  updatedAt: Date | string | null;
  cursorUpdatedAt: string | null;
};

type CourseConversationSnapshotRow = CourseConversationPageRow & {
  recordKind: 'message' | 'tombstone' | null;
  messageId: string | null;
  messageConversationId: string | null;
  messageOwnerId: string | null;
  messageCourseId: string | null;
  messageSequence: bigint | number | string | null;
  messageRole: 'user' | 'assistant' | null;
  messageContent: unknown;
  messagePlainText: string | null;
  messageIdempotencyKey: string | null;
  messageRequestId: string | null;
  messageRequestPayloadHash: string | null;
  messageDeletedAt: Date | string | null;
  messageCreatedAt: Date | string | null;
  messageUpdatedAt: Date | string | null;
};

type ConversationMutationRow = CourseConversationRow & {
  accepted: boolean;
};

type MessagePatchResultRow = {
  id: string;
  operation: 'upsert' | 'delete';
  existingConversationId: string | null;
  existingDeletedAt: Date | string | null;
  written: boolean;
  projectedMessageCount: number;
  projectedLastMessageAt: Date | string | null;
  projectedSummaryVersion: number;
};

export type CourseConversationPatchResult = {
  accepted: boolean;
  deleted: boolean;
  currentRevision: number;
  conversation: CourseConversationRow | null;
  appliedMessageIds: string[];
  appliedDeletedMessageIds: string[];
  serverDeletedMessageIds: string[];
};

export type CourseConversationDeleteResult = {
  accepted: boolean;
  deleted: boolean;
  currentRevision: number;
};

export type CourseQuestionHistoryResult = {
  conversation: CourseConversationRow | null;
  messages: CourseConversationMessageRow[];
  summary: CourseConversationSummary | null;
};

export type CourseConversationTurnAppendResult = {
  conversation: CourseConversationRow;
  messages: CourseConversationMessageRow[];
  replayed: boolean;
};

export type CourseConversationRepositoryErrorCode =
  | 'conversation_deleted'
  | 'idempotency_conflict'
  | 'message_conflict';

export class CourseConversationRepositoryError extends Error {
  readonly code: CourseConversationRepositoryErrorCode;

  constructor(code: CourseConversationRepositoryErrorCode, message: string) {
    super(message);
    this.name = 'CourseConversationRepositoryError';
    this.code = code;
  }
}

function timestamp(value: Date | string | null | undefined): number | null {
  if (value == null) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function bigintValue(value: bigint | number | string | null | undefined): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  return BigInt(0);
}

function safeCount(value: bigint | number | string | null | undefined): number {
  const count = bigintValue(value);
  if (count < BigInt(0) || count > MAX_SAFE_REVISION) {
    throw new Error('Course conversation count exceeds the safe API integer range.');
  }
  return Number(count);
}

export function safeCourseConversationRevision(
  value: bigint | number | string | null | undefined,
): number {
  const revision = bigintValue(value);
  if (revision < BigInt(0) || revision > MAX_SAFE_REVISION) {
    throw new Error('Course conversation revision exceeds the safe API integer range.');
  }
  return Number(revision);
}

function safeSequenceString(value: bigint | number | string | null | undefined): string {
  const sequence = bigintValue(value);
  if (sequence < BigInt(0) || sequence > MAX_SAFE_REVISION) {
    throw new Error('Course conversation sequence exceeds the safe API integer range.');
  }
  return sequence.toString();
}

function makeConversationId(): string {
  return `course_conversation_${crypto.randomUUID().replace(/-/g, '')}`;
}

function createdAtForWrite(value: number | Date | undefined): string {
  const date =
    value instanceof Date ? value : typeof value === 'number' ? new Date(value) : new Date();
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

export function courseConversationSessionFromRow(
  row: CourseConversationRow,
): CourseConversationSession {
  return {
    id: row.sessionId,
    conversationId: row.id,
    title: row.title.trim() || '新对话',
    createdAt: timestamp(row.createdAt) ?? Date.now(),
    updatedAt: timestamp(row.updatedAt) ?? Date.now(),
    currentRevision: safeCourseConversationRevision(row.revision),
    messageCount: row.messageCount,
  };
}

function summaryFromRow(
  row: Pick<
    CourseConversationRow,
    'summaryText' | 'summaryThroughSequence' | 'summaryVersion' | 'summaryUpdatedAt'
  >,
): CourseConversationSummary | null {
  const text = row.summaryText?.trim();
  if (!text) return null;
  return {
    text,
    throughSequence: safeSequenceString(row.summaryThroughSequence),
    version: row.summaryVersion,
    updatedAt: timestamp(row.summaryUpdatedAt),
  };
}

function rowFromPageRow(row: CourseConversationPageRow): CourseConversationRow | null {
  if (
    !row.id ||
    !row.ownerId ||
    !row.courseId ||
    !row.sessionId ||
    row.revision == null ||
    !row.createdAt ||
    !row.updatedAt
  ) {
    return null;
  }
  return {
    id: row.id,
    ownerId: row.ownerId,
    courseId: row.courseId,
    sessionId: row.sessionId,
    title: row.title?.trim() || '新对话',
    revision: row.revision,
    lastMessageAt: row.lastMessageAt,
    messageCount: row.messageCount ?? 0,
    summaryText: row.summaryText,
    summaryThroughSequence: row.summaryThroughSequence ?? 0,
    summaryVersion: row.summaryVersion ?? 0,
    summaryUpdatedAt: row.summaryUpdatedAt,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cursorUpdatedAt: row.cursorUpdatedAt || undefined,
  };
}

function messageFromSnapshotRow(
  row: CourseConversationSnapshotRow,
): CourseConversationMessageRow | null {
  if (
    !row.messageId ||
    !row.messageConversationId ||
    !row.messageOwnerId ||
    !row.messageCourseId ||
    row.messageSequence == null ||
    !row.messageCreatedAt ||
    !row.messageUpdatedAt
  ) {
    return null;
  }
  return {
    id: row.messageId,
    conversationId: row.messageConversationId,
    ownerId: row.messageOwnerId,
    courseId: row.messageCourseId,
    sequence: row.messageSequence,
    role: row.messageRole,
    content: row.messageContent,
    plainText: row.messagePlainText,
    idempotencyKey: row.messageIdempotencyKey,
    requestId: row.messageRequestId,
    requestPayloadHash: row.messageRequestPayloadHash,
    deletedAt: row.messageDeletedAt,
    createdAt: row.messageCreatedAt,
    updatedAt: row.messageUpdatedAt,
  };
}

export function encodeCourseConversationPageCursor(row: CourseConversationRow): string {
  const payload: SessionPageCursor = {
    updatedAt: row.cursorUpdatedAt ?? `${new Date(row.updatedAt).toISOString().slice(0, 23)}000`,
    id: row.id,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCourseConversationPageCursor(raw: string): SessionPageCursor | null {
  if (!raw || raw.length > 1024) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<SessionPageCursor>;
    if (
      typeof parsed.updatedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}$/.test(parsed.updatedAt) ||
      typeof parsed.id !== 'string' ||
      !parsed.id ||
      parsed.id.length > 240
    ) {
      return null;
    }
    const millisecondTimestamp = parsed.updatedAt.slice(0, 23);
    const date = new Date(`${millisecondTimestamp}Z`);
    if (
      !Number.isFinite(date.getTime()) ||
      date.toISOString().slice(0, 23) !== millisecondTimestamp
    ) {
      return null;
    }
    return { updatedAt: parsed.updatedAt, id: parsed.id };
  } catch {
    return null;
  }
}

export function encodeCourseMessagePageCursor(sequence: bigint | number | string): string {
  const payload: MessagePageCursor = { sequence: safeSequenceString(sequence) };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCourseMessagePageCursor(raw: string): MessagePageCursor | null {
  if (!raw || raw.length > 1024) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<MessagePageCursor>;
    if (typeof parsed.sequence !== 'string' || !/^\d+$/.test(parsed.sequence)) return null;
    const sequence = BigInt(parsed.sequence);
    if (sequence <= BigInt(0) || sequence > MAX_SAFE_REVISION) return null;
    return { sequence: parsed.sequence };
  } catch {
    return null;
  }
}

export async function findCourseConversationAccessRole(
  prisma: CourseConversationDbClient,
  userId: string,
  courseId: string,
): Promise<CourseConversationAccessRole | null> {
  const rows = await prisma.$queryRawUnsafe<
    Array<{ accessRole: CourseConversationAccessRole | null }>
  >(
    `
      SELECT CASE
        WHEN course."ownerId" = $1 THEN 'owner'
        WHEN EXISTS (
          SELECT 1 FROM "CourseEnrollment"
          WHERE "userId" = $1 AND "courseId" = $2
        ) OR EXISTS (
          SELECT 1 FROM "CoursePurchase"
          WHERE "buyerId" = $1 AND "sourceCourseId" = $2
        ) THEN 'enrolled'
        ELSE NULL
      END AS "accessRole"
      FROM "Course" AS course
      WHERE course."id" = $2
      LIMIT 1
    `,
    userId,
    courseId,
  );
  return rows[0]?.accessRole ?? null;
}

export async function listCourseConversationPage(
  prisma: PrismaClient,
  args: {
    userId: string;
    courseId: string;
    limit: number;
    cursor: SessionPageCursor | null;
  },
): Promise<{
  accessRole: CourseConversationAccessRole | null;
  sessions: CourseConversationSession[];
  hasMore: boolean;
  nextCursor: string | null;
  totalCount: number;
}> {
  const rows = await prisma.$queryRawUnsafe<CourseConversationPageRow[]>(
    `
      WITH "courseAccess" AS (
        SELECT CASE
          WHEN course."ownerId" = $1 THEN 'owner'
          WHEN EXISTS (
            SELECT 1 FROM "CourseEnrollment"
            WHERE "userId" = $1 AND "courseId" = $2
          ) OR EXISTS (
            SELECT 1 FROM "CoursePurchase"
            WHERE "buyerId" = $1 AND "sourceCourseId" = $2
          ) THEN 'enrolled'
          ELSE NULL
        END AS "accessRole"
        FROM "Course" AS course
        WHERE course."id" = $2
        LIMIT 1
      )
      SELECT
        access."accessRole",
        CASE
          WHEN access."accessRole" IS NULL THEN 0::bigint
          ELSE (
            SELECT count(*)::bigint
            FROM "CourseConversation" AS counted
            WHERE counted."ownerId" = $1
              AND counted."courseId" = $2
              AND counted."deletedAt" IS NULL
          )
        END AS "totalCount",
        conversation."id",
        conversation."ownerId",
        conversation."courseId",
        conversation."sessionId",
        conversation."title",
        conversation."revision",
        conversation."lastMessageAt",
        conversation."messageCount",
        NULL::text AS "summaryText",
        conversation."summaryThroughSequence",
        conversation."summaryVersion",
        NULL::timestamp AS "summaryUpdatedAt",
        conversation."deletedAt",
        conversation."createdAt",
        conversation."updatedAt",
        conversation."cursorUpdatedAt"
      FROM "courseAccess" AS access
      LEFT JOIN LATERAL (
        SELECT
          "id",
          "ownerId",
          "courseId",
          "sessionId",
          "title",
          "revision",
          "lastMessageAt",
          "messageCount",
          "summaryThroughSequence",
          "summaryVersion",
          "deletedAt",
          "createdAt",
          "updatedAt",
          to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.US') AS "cursorUpdatedAt"
        FROM "CourseConversation"
        WHERE "ownerId" = $1
          AND "courseId" = $2
          AND "deletedAt" IS NULL
          AND access."accessRole" IS NOT NULL
          AND (
            $3::timestamp IS NULL
            OR ("updatedAt", "id") < ($3::timestamp, $4)
          )
        ORDER BY "updatedAt" DESC, "id" DESC
        LIMIT $5
      ) AS conversation ON TRUE
      ORDER BY conversation."updatedAt" DESC NULLS LAST, conversation."id" DESC NULLS LAST
    `,
    args.userId,
    args.courseId,
    args.cursor?.updatedAt ?? null,
    args.cursor?.id ?? '',
    args.limit + 1,
  );
  const accessRole = rows[0]?.accessRole ?? null;
  const conversations = rows
    .map(rowFromPageRow)
    .filter((row): row is CourseConversationRow => Boolean(row));
  const hasMore = conversations.length > args.limit;
  const visible = hasMore ? conversations.slice(0, args.limit) : conversations;
  return {
    accessRole,
    sessions: visible.map(courseConversationSessionFromRow),
    hasMore,
    nextCursor:
      hasMore && visible.length
        ? encodeCourseConversationPageCursor(visible[visible.length - 1])
        : null,
    totalCount: safeCount(rows[0]?.totalCount),
  };
}

export async function loadCourseConversationSnapshot(
  prisma: PrismaClient,
  args: {
    userId: string;
    courseId: string;
    sessionId: string;
    limit: number;
    beforeSequence: string | null;
  },
): Promise<CourseConversationSnapshot> {
  const rows = await prisma.$queryRawUnsafe<CourseConversationSnapshotRow[]>(
    `
      WITH "courseAccess" AS (
        SELECT CASE
          WHEN course."ownerId" = $1 THEN 'owner'
          WHEN EXISTS (
            SELECT 1 FROM "CourseEnrollment"
            WHERE "userId" = $1 AND "courseId" = $2
          ) OR EXISTS (
            SELECT 1 FROM "CoursePurchase"
            WHERE "buyerId" = $1 AND "sourceCourseId" = $2
          ) THEN 'enrolled'
          ELSE NULL
        END AS "accessRole"
        FROM "Course" AS course
        WHERE course."id" = $2
        LIMIT 1
      ),
      conversation AS (
        SELECT c.*
        FROM "CourseConversation" AS c
        CROSS JOIN "courseAccess" AS access
        WHERE c."ownerId" = $1
          AND c."courseId" = $2
          AND c."sessionId" = $3
          AND access."accessRole" IS NOT NULL
        LIMIT 1
      ),
      records AS (
        (
          SELECT
            'message'::text AS "recordKind",
            m.*
          FROM "CourseConversationMessage" AS m
          INNER JOIN conversation AS c ON c."id" = m."conversationId"
          WHERE c."deletedAt" IS NULL
            AND m."deletedAt" IS NULL
            AND ($4::bigint IS NULL OR m."sequence" < $4::bigint)
          ORDER BY m."sequence" DESC
          LIMIT $5
        )
        UNION ALL
        (
          SELECT
            'tombstone'::text AS "recordKind",
            m.*
          FROM "CourseConversationMessage" AS m
          INNER JOIN conversation AS c ON c."id" = m."conversationId"
          WHERE c."deletedAt" IS NULL
            AND m."deletedAt" IS NOT NULL
          ORDER BY m."deletedAt" DESC, m."id" DESC
          LIMIT $6
        )
      )
      SELECT
        access."accessRole",
        NULL::bigint AS "totalCount",
        c."id",
        c."ownerId",
        c."courseId",
        c."sessionId",
        c."title",
        c."revision",
        c."lastMessageAt",
        c."messageCount",
        c."summaryText",
        c."summaryThroughSequence",
        c."summaryVersion",
        c."summaryUpdatedAt",
        c."deletedAt",
        c."createdAt",
        c."updatedAt",
        NULL::text AS "cursorUpdatedAt",
        records."recordKind",
        records."id" AS "messageId",
        records."conversationId" AS "messageConversationId",
        records."ownerId" AS "messageOwnerId",
        records."courseId" AS "messageCourseId",
        records."sequence" AS "messageSequence",
        records."role" AS "messageRole",
        records."content" AS "messageContent",
        records."plainText" AS "messagePlainText",
        records."idempotencyKey" AS "messageIdempotencyKey",
        records."requestId" AS "messageRequestId",
        records."requestPayloadHash" AS "messageRequestPayloadHash",
        records."deletedAt" AS "messageDeletedAt",
        records."createdAt" AS "messageCreatedAt",
        records."updatedAt" AS "messageUpdatedAt"
      FROM "courseAccess" AS access
      LEFT JOIN conversation AS c ON TRUE
      LEFT JOIN records ON TRUE
    `,
    args.userId,
    args.courseId,
    args.sessionId,
    args.beforeSequence,
    args.limit + 1,
    MAX_RETURNED_COURSE_MESSAGE_TOMBSTONES,
  );

  const accessRole = rows[0]?.accessRole ?? null;
  const conversation = rows[0] ? rowFromPageRow(rows[0]) : null;
  if (!conversation) {
    return {
      accessRole,
      session: null,
      messages: [],
      deletedMessageIds: [],
      messagePage: { hasMore: false, nextCursor: null, limit: args.limit },
      messageWindow: { hasMore: false, isComplete: true },
      summary: null,
      currentRevision: 0,
    };
  }
  const currentRevision = safeCourseConversationRevision(conversation.revision);
  if (conversation.deletedAt) {
    return {
      accessRole,
      session: null,
      messages: [],
      deletedMessageIds: [],
      messagePage: { hasMore: false, nextCursor: null, limit: args.limit },
      messageWindow: { hasMore: false, isComplete: true },
      summary: null,
      currentRevision,
    };
  }

  const visibleDescending = rows
    .filter((row) => row.recordKind === 'message')
    .map(messageFromSnapshotRow)
    .filter((row): row is CourseConversationMessageRow => Boolean(row))
    .sort((left, right) => {
      const leftSequence = bigintValue(left.sequence);
      const rightSequence = bigintValue(right.sequence);
      return leftSequence === rightSequence
        ? right.id.localeCompare(left.id)
        : leftSequence > rightSequence
          ? -1
          : 1;
    });
  const hasMore = visibleDescending.length > args.limit;
  const visible = hasMore ? visibleDescending.slice(0, args.limit) : visibleDescending;
  const nextCursor =
    hasMore && visible.length
      ? encodeCourseMessagePageCursor(visible[visible.length - 1].sequence)
      : null;
  const deletedMessageIds = Array.from(
    new Set(
      rows
        .filter((row) => row.recordKind === 'tombstone' && row.messageId)
        .map((row) => row.messageId as string),
    ),
  );
  return {
    accessRole,
    session: courseConversationSessionFromRow(conversation),
    messages: visible.reverse(),
    deletedMessageIds,
    messagePage: { hasMore, nextCursor, limit: args.limit },
    messageWindow: {
      hasMore,
      // A cursor page omits newer messages even when it is the final older
      // page, so that response is not a complete standalone snapshot.
      isComplete: !hasMore && args.beforeSequence === null,
    },
    summary: summaryFromRow(conversation),
    currentRevision,
  };
}

async function lockCourseConversation(
  prisma: CourseConversationDbClient,
  args: { userId: string; courseId: string; sessionId: string },
): Promise<void> {
  const lockKey = [
    COURSE_CONVERSATION_LOCK_PREFIX,
    args.userId,
    args.courseId,
    args.sessionId,
  ].join(':');
  await prisma.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "locked"',
    lockKey,
  );
}

async function mutateConversationRevision(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    courseId: string;
    sessionId: string;
    title: string;
    baseRevision?: number;
    clientRevision?: number;
  },
): Promise<ConversationMutationRow | null> {
  const id = makeConversationId();
  const baseRevision = args.baseRevision === undefined ? null : BigInt(args.baseRevision);
  const clientRevision = args.clientRevision === undefined ? null : BigInt(args.clientRevision);
  const rows = await tx.$queryRawUnsafe<ConversationMutationRow[]>(
    `
      WITH attempted AS (
        INSERT INTO "CourseConversation" (
          "id", "ownerId", "courseId", "sessionId", "title", "revision",
          "messageCount", "summaryThroughSequence", "summaryVersion",
          "createdAt", "updatedAt"
        )
        SELECT
          $1, $2, $3, $4, $5,
          GREATEST(COALESCE($7::bigint, 1), COALESCE($6::bigint, 0) + 1),
          0, 0, 0,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        ON CONFLICT ("ownerId", "courseId", "sessionId") DO UPDATE
        SET
          "title" = EXCLUDED."title",
          -- Message synchronization is an id-based patch protected by the
          -- advisory transaction lock above. Merge concurrent device patches
          -- in arrival order and advance the server revision instead of
          -- rejecting a harmlessly stale base revision and creating a retry
          -- livelock between tabs.
          "revision" = GREATEST(
            COALESCE($7::bigint, "CourseConversation"."revision" + 1),
            "CourseConversation"."revision" + 1
          ),
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "CourseConversation"."deletedAt" IS NULL
        RETURNING *, TRUE AS "accepted"
      )
      SELECT * FROM attempted
      UNION ALL
      SELECT current.*, FALSE AS "accepted"
      FROM "CourseConversation" AS current
      WHERE current."ownerId" = $2
        AND current."courseId" = $3
        AND current."sessionId" = $4
        AND NOT EXISTS (SELECT 1 FROM attempted)
      LIMIT 1
    `,
    id,
    args.userId,
    args.courseId,
    args.sessionId,
    args.title,
    baseRevision,
    clientRevision,
  );
  return rows[0] ?? null;
}

async function patchCourseConversationMessages(
  tx: Prisma.TransactionClient,
  args: {
    conversation: CourseConversationRow;
    messages: CourseConversationMessageWrite[];
    deletedMessageIds: string[];
  },
): Promise<{
  conversation: CourseConversationRow;
  appliedMessageIds: string[];
  appliedDeletedMessageIds: string[];
  serverDeletedMessageIds: string[];
}> {
  const deletedIds = Array.from(new Set(args.deletedMessageIds));
  const deletedIdSet = new Set(deletedIds);
  const messages = Array.from(
    new Map(args.messages.map((message) => [message.id, message] as const)).values(),
  ).filter((message) => !deletedIdSet.has(message.id));
  const now = new Date().toISOString();
  const payload = [
    ...messages.map((message) => ({
      id: message.id,
      operation: 'upsert',
      role: message.role,
      content: message.content,
      plainText: message.plainText,
      idempotencyKey: message.idempotencyKey ?? null,
      requestId: message.requestId ?? null,
      requestPayloadHash: message.requestPayloadHash ?? null,
      deletedAt: null,
      createdAt: createdAtForWrite(message.createdAt),
    })),
    ...deletedIds.map((id) => ({
      id,
      operation: 'delete',
      role: null,
      content: null,
      plainText: null,
      idempotencyKey: null,
      requestId: null,
      requestPayloadHash: null,
      deletedAt: now,
      createdAt: now,
    })),
  ];
  if (!payload.length) {
    return {
      conversation: args.conversation,
      appliedMessageIds: [],
      appliedDeletedMessageIds: [],
      serverDeletedMessageIds: [],
    };
  }

  const rows = await tx.$queryRawUnsafe<MessagePatchResultRow[]>(
    `
      WITH payload AS MATERIALIZED (
        SELECT *
        FROM jsonb_to_recordset($1::jsonb) AS item(
          "id" TEXT,
          "operation" TEXT,
          "role" TEXT,
          "content" JSONB,
          "plainText" TEXT,
          "idempotencyKey" TEXT,
          "requestId" TEXT,
          "requestPayloadHash" TEXT,
          "deletedAt" TIMESTAMP,
          "createdAt" TIMESTAMP
        )
      ),
      existing AS MATERIALIZED (
        SELECT
          payload.*,
          message."id" AS "existingId",
          message."conversationId" AS "existingConversationId",
          message."ownerId" AS "existingOwnerId",
          message."courseId" AS "existingCourseId",
          message."sequence" AS "existingSequence",
          message."deletedAt" AS "existingDeletedAt"
        FROM payload
        LEFT JOIN "CourseConversationMessage" AS message ON message."id" = payload."id"
      ),
      current_sequence AS (
        SELECT COALESCE(MAX("sequence"), 0) AS "maxSequence"
        FROM "CourseConversationMessage"
        WHERE "conversationId" = $2
      ),
      prepared AS (
        SELECT
          existing.*,
          CASE
            WHEN existing."existingId" IS NOT NULL THEN existing."existingSequence"
            ELSE current_sequence."maxSequence"
              + SUM(CASE WHEN existing."existingId" IS NULL THEN 1 ELSE 0 END)
                OVER (ORDER BY existing."createdAt", existing."id")
          END AS "assignedSequence"
        FROM existing
        CROSS JOIN current_sequence
      ),
      write_candidates AS (
        SELECT *
        FROM prepared
        WHERE "existingConversationId" IS NULL
          OR "existingConversationId" = $2
      ),
      writes AS (
        INSERT INTO "CourseConversationMessage" (
          "id", "conversationId", "ownerId", "courseId", "sequence",
          "role", "content", "plainText",
          "idempotencyKey", "requestId", "requestPayloadHash",
          "deletedAt", "createdAt", "updatedAt"
        )
        SELECT
          candidate."id",
          $2,
          $3,
          $4,
          candidate."assignedSequence",
          CASE
            WHEN candidate."operation" = 'delete' THEN NULL
            ELSE candidate."role"::"CourseConversationMessageRole"
          END,
          CASE WHEN candidate."operation" = 'delete' THEN NULL ELSE candidate."content" END,
          CASE WHEN candidate."operation" = 'delete' THEN NULL ELSE candidate."plainText" END,
          candidate."idempotencyKey",
          candidate."requestId",
          candidate."requestPayloadHash",
          candidate."deletedAt",
          candidate."createdAt",
          CURRENT_TIMESTAMP
        FROM write_candidates AS candidate
        ON CONFLICT ("id") DO UPDATE
        SET
          "role" = CASE
            WHEN EXCLUDED."deletedAt" IS NOT NULL THEN NULL
            ELSE EXCLUDED."role"
          END,
          "content" = CASE
            WHEN EXCLUDED."deletedAt" IS NOT NULL THEN NULL
            ELSE EXCLUDED."content"
          END,
          "plainText" = CASE
            WHEN EXCLUDED."deletedAt" IS NOT NULL THEN NULL
            ELSE EXCLUDED."plainText"
          END,
          "idempotencyKey" = COALESCE(
            "CourseConversationMessage"."idempotencyKey",
            EXCLUDED."idempotencyKey"
          ),
          "requestId" = COALESCE(
            "CourseConversationMessage"."requestId",
            EXCLUDED."requestId"
          ),
          "requestPayloadHash" = COALESCE(
            "CourseConversationMessage"."requestPayloadHash",
            EXCLUDED."requestPayloadHash"
          ),
          "deletedAt" = CASE
            WHEN EXCLUDED."deletedAt" IS NOT NULL
              THEN COALESCE("CourseConversationMessage"."deletedAt", EXCLUDED."deletedAt")
            ELSE "CourseConversationMessage"."deletedAt"
          END,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "CourseConversationMessage"."conversationId" = EXCLUDED."conversationId"
          AND "CourseConversationMessage"."ownerId" = EXCLUDED."ownerId"
          AND "CourseConversationMessage"."courseId" = EXCLUDED."courseId"
          AND (
            EXCLUDED."deletedAt" IS NOT NULL
            OR "CourseConversationMessage"."deletedAt" IS NULL
          )
        RETURNING "id"
      ),
      projection_values AS (
        SELECT
          COALESCE(
            SUM(
              CASE
                WHEN existing."operation" = 'upsert'
                  AND existing."existingId" IS NULL THEN 1
                WHEN existing."operation" = 'delete'
                  AND existing."existingId" IS NOT NULL
                  AND existing."existingConversationId" = $2
                  AND existing."existingDeletedAt" IS NULL THEN -1
                ELSE 0
              END
            ),
            0
          )::integer AS "messageDelta",
          (
            SELECT MAX(candidate."createdAt")
            FROM (
              SELECT message."createdAt"
              FROM "CourseConversationMessage" AS message
              WHERE message."conversationId" = $2
                AND message."deletedAt" IS NULL
                AND NOT EXISTS (
                  SELECT 1 FROM existing
                  WHERE existing."id" = message."id"
                    AND existing."operation" = 'delete'
                )
              UNION ALL
              SELECT existing."createdAt"
              FROM existing
              WHERE existing."operation" = 'upsert'
                AND existing."existingId" IS NULL
            ) AS candidate
          ) AS "nextLastMessageAt"
        FROM existing
      ),
      projection AS (
        UPDATE "CourseConversation"
        SET
          "messageCount" = GREATEST(
            0,
            "CourseConversation"."messageCount" + projection_values."messageDelta"
          ),
          "lastMessageAt" = projection_values."nextLastMessageAt",
          "summaryText" = NULL,
          "summaryThroughSequence" = 0,
          "summaryVersion" = "CourseConversation"."summaryVersion" + 1,
          "summaryUpdatedAt" = NULL
        FROM projection_values
        WHERE "CourseConversation"."id" = $2
          AND (SELECT COUNT(*) FROM writes) >= 0
        RETURNING
          "CourseConversation"."id",
          "CourseConversation"."messageCount",
          "CourseConversation"."lastMessageAt",
          "CourseConversation"."summaryVersion"
      )
      SELECT
        existing."id",
        existing."operation",
        existing."existingConversationId",
        existing."existingDeletedAt",
        writes."id" IS NOT NULL AS "written",
        projection."messageCount" AS "projectedMessageCount",
        projection."lastMessageAt" AS "projectedLastMessageAt",
        projection."summaryVersion" AS "projectedSummaryVersion"
      FROM existing
      LEFT JOIN writes ON writes."id" = existing."id"
      CROSS JOIN projection
      ORDER BY existing."createdAt", existing."id"
    `,
    JSON.stringify(payload),
    args.conversation.id,
    args.conversation.ownerId,
    args.conversation.courseId,
  );

  const conflicting = rows.find(
    (row) =>
      row.existingConversationId !== null && row.existingConversationId !== args.conversation.id,
  );
  const racedConflict = rows.find((row) => row.existingConversationId === null && !row.written);
  if (conflicting || racedConflict) {
    const conflict = conflicting ?? racedConflict;
    throw new CourseConversationRepositoryError(
      'message_conflict',
      `Message id conflict: ${conflict?.id ?? 'unknown'} already belongs to another conversation.`,
    );
  }
  const projection = rows[0];
  return {
    conversation: {
      ...args.conversation,
      messageCount: projection?.projectedMessageCount ?? args.conversation.messageCount,
      lastMessageAt: projection
        ? projection.projectedLastMessageAt
        : args.conversation.lastMessageAt,
      summaryText: null,
      summaryThroughSequence: 0,
      summaryVersion: projection?.projectedSummaryVersion ?? args.conversation.summaryVersion,
      summaryUpdatedAt: null,
    },
    appliedMessageIds: rows
      .filter((row) => row.operation === 'upsert' && row.written)
      .map((row) => row.id),
    appliedDeletedMessageIds: rows
      .filter((row) => row.operation === 'delete' && row.written)
      .map((row) => row.id),
    serverDeletedMessageIds: rows
      .filter(
        (row) =>
          row.operation === 'upsert' &&
          row.existingDeletedAt !== null &&
          row.existingConversationId === args.conversation.id,
      )
      .map((row) => row.id),
  };
}

export async function applyCourseConversationPatchInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    courseId: string;
    sessionId: string;
    title: string;
    baseRevision?: number;
    clientRevision?: number;
    messages: CourseConversationMessageWrite[];
    deletedMessageIds: string[];
  },
): Promise<CourseConversationPatchResult> {
  await lockCourseConversation(tx, args);
  const conversation = await mutateConversationRevision(tx, args);
  if (!conversation) {
    return {
      accepted: false,
      deleted: false,
      currentRevision: 0,
      conversation: null,
      appliedMessageIds: [],
      appliedDeletedMessageIds: [],
      serverDeletedMessageIds: [],
    };
  }
  const currentRevision = safeCourseConversationRevision(conversation.revision);
  if (!conversation.accepted || conversation.deletedAt) {
    return {
      accepted: false,
      deleted: Boolean(conversation.deletedAt),
      currentRevision,
      conversation,
      appliedMessageIds: [],
      appliedDeletedMessageIds: [],
      serverDeletedMessageIds: [],
    };
  }
  const applied = await patchCourseConversationMessages(tx, {
    conversation,
    messages: args.messages,
    deletedMessageIds: args.deletedMessageIds,
  });
  return {
    accepted: true,
    deleted: false,
    currentRevision,
    conversation: applied.conversation,
    appliedMessageIds: applied.appliedMessageIds,
    appliedDeletedMessageIds: applied.appliedDeletedMessageIds,
    serverDeletedMessageIds: applied.serverDeletedMessageIds,
  };
}

export async function deleteCourseConversationInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    courseId: string;
    sessionId: string;
    baseRevision?: number;
    clientRevision?: number;
  },
): Promise<CourseConversationDeleteResult> {
  await lockCourseConversation(tx, args);
  const existingRows = await tx.$queryRawUnsafe<CourseConversationRow[]>(
    `
      SELECT *
      FROM "CourseConversation"
      WHERE "ownerId" = $1 AND "courseId" = $2 AND "sessionId" = $3
      LIMIT 1
    `,
    args.userId,
    args.courseId,
    args.sessionId,
  );
  const existing = existingRows[0] ?? null;
  if (existing?.deletedAt) {
    return {
      accepted: true,
      deleted: true,
      currentRevision: safeCourseConversationRevision(existing.revision),
    };
  }
  const currentRevision = safeCourseConversationRevision(existing?.revision);
  if (currentRevision > 0 && args.baseRevision === undefined) {
    return { accepted: false, deleted: false, currentRevision };
  }
  if (args.baseRevision !== undefined && args.baseRevision !== currentRevision) {
    return { accepted: false, deleted: false, currentRevision };
  }
  if (args.clientRevision !== undefined && args.clientRevision <= currentRevision) {
    return { accepted: false, deleted: false, currentRevision };
  }
  const acceptedRevision = args.clientRevision ?? Math.max(1, currentRevision + 1);
  const id = existing?.id ?? makeConversationId();
  const rows = await tx.$queryRawUnsafe<Array<{ id: string; revision: bigint | number | string }>>(
    `
      INSERT INTO "CourseConversation" (
        "id", "ownerId", "courseId", "sessionId", "title", "revision",
        "messageCount", "summaryThroughSequence", "summaryVersion",
        "deletedAt", "createdAt", "updatedAt"
      )
      VALUES (
        $1, $2, $3, $4, $5, $6::bigint,
        0, 0, 0,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("ownerId", "courseId", "sessionId") DO UPDATE
      SET
        "revision" = EXCLUDED."revision",
        "deletedAt" = CURRENT_TIMESTAMP,
        "messageCount" = 0,
        "lastMessageAt" = NULL,
        "summaryText" = NULL,
        "summaryThroughSequence" = 0,
        "summaryVersion" = "CourseConversation"."summaryVersion" + 1,
        "summaryUpdatedAt" = NULL,
        "updatedAt" = CURRENT_TIMESTAMP
      WHERE "CourseConversation"."revision" = $7::bigint
        AND "CourseConversation"."deletedAt" IS NULL
      RETURNING "id", "revision"
    `,
    id,
    args.userId,
    args.courseId,
    args.sessionId,
    existing?.title?.trim() || '新对话',
    BigInt(acceptedRevision),
    BigInt(currentRevision),
  );
  if (!rows[0]) {
    return { accepted: false, deleted: false, currentRevision };
  }
  await tx.$executeRawUnsafe(
    `DELETE FROM "CourseConversationMessage" WHERE "conversationId" = $1`,
    rows[0].id,
  );
  return {
    accepted: true,
    deleted: true,
    currentRevision: safeCourseConversationRevision(rows[0].revision),
  };
}

export async function loadCourseQuestionHistory(
  prisma: PrismaClient,
  args: {
    userId: string;
    courseId: string;
    sessionId: string;
    maxMessages: number;
  },
): Promise<CourseQuestionHistoryResult> {
  const rows = await prisma.$queryRawUnsafe<CourseConversationSnapshotRow[]>(
    `
      WITH conversation AS (
        SELECT *
        FROM "CourseConversation"
        WHERE "ownerId" = $1 AND "courseId" = $2 AND "sessionId" = $3
        LIMIT 1
      )
      SELECT
        NULL::text AS "accessRole",
        NULL::bigint AS "totalCount",
        c."id",
        c."ownerId",
        c."courseId",
        c."sessionId",
        c."title",
        c."revision",
        c."lastMessageAt",
        c."messageCount",
        c."summaryText",
        c."summaryThroughSequence",
        c."summaryVersion",
        c."summaryUpdatedAt",
        c."deletedAt",
        c."createdAt",
        c."updatedAt",
        NULL::text AS "cursorUpdatedAt",
        CASE WHEN m."id" IS NULL THEN NULL ELSE 'message' END AS "recordKind",
        m."id" AS "messageId",
        m."conversationId" AS "messageConversationId",
        m."ownerId" AS "messageOwnerId",
        m."courseId" AS "messageCourseId",
        m."sequence" AS "messageSequence",
        m."role" AS "messageRole",
        m."content" AS "messageContent",
        m."plainText" AS "messagePlainText",
        m."idempotencyKey" AS "messageIdempotencyKey",
        m."requestId" AS "messageRequestId",
        m."requestPayloadHash" AS "messageRequestPayloadHash",
        m."deletedAt" AS "messageDeletedAt",
        m."createdAt" AS "messageCreatedAt",
        m."updatedAt" AS "messageUpdatedAt"
      FROM conversation AS c
      LEFT JOIN LATERAL (
        SELECT *
        FROM "CourseConversationMessage"
        WHERE "conversationId" = c."id"
          AND "deletedAt" IS NULL
          AND "role" IN ('user', 'assistant')
          AND "plainText" IS NOT NULL
          AND length(trim("plainText")) > 0
        ORDER BY "sequence" DESC
        LIMIT $4
      ) AS m ON TRUE
      ORDER BY m."sequence" DESC NULLS LAST
    `,
    args.userId,
    args.courseId,
    args.sessionId,
    args.maxMessages,
  );
  const conversation = rows[0] ? rowFromPageRow(rows[0]) : null;
  const messages = rows
    .map(messageFromSnapshotRow)
    .filter((row): row is CourseConversationMessageRow => Boolean(row))
    .reverse();
  return {
    conversation,
    messages,
    summary: conversation ? summaryFromRow(conversation) : null,
  };
}

export async function appendCourseConversationTurnInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    courseId: string;
    sessionId: string;
    title: string;
    userMessage: CourseConversationMessageWrite;
    assistantMessage: CourseConversationMessageWrite;
    idempotencyKey: string;
    requestPayloadHash: string;
  },
): Promise<CourseConversationTurnAppendResult> {
  await lockCourseConversation(tx, args);
  const conversationRows = await tx.$queryRawUnsafe<CourseConversationRow[]>(
    `
      SELECT *
      FROM "CourseConversation"
      WHERE "ownerId" = $1 AND "courseId" = $2 AND "sessionId" = $3
      LIMIT 1
    `,
    args.userId,
    args.courseId,
    args.sessionId,
  );
  const existing = conversationRows[0] ?? null;
  if (existing?.deletedAt) {
    throw new CourseConversationRepositoryError(
      'conversation_deleted',
      'The requested course conversation was deleted.',
    );
  }

  const existingMessages = await tx.$queryRawUnsafe<CourseConversationMessageRow[]>(
    `
      SELECT *
      FROM "CourseConversationMessage"
      WHERE "id" IN ($1, $2)
      ORDER BY "id"
    `,
    args.userMessage.id,
    args.assistantMessage.id,
  );
  const conflicting = existingMessages.find(
    (message) =>
      !existing ||
      message.conversationId !== existing.id ||
      message.ownerId !== args.userId ||
      message.courseId !== args.courseId,
  );
  if (conflicting) {
    throw new CourseConversationRepositoryError(
      'message_conflict',
      `Course question message ID conflict: ${conflicting.id}`,
    );
  }
  const mismatchedPayload = existingMessages.find(
    (message) => message.requestPayloadHash !== args.requestPayloadHash,
  );
  if (mismatchedPayload) {
    throw new CourseConversationRepositoryError(
      'idempotency_conflict',
      'The Idempotency-Key was already used with a different course question payload.',
    );
  }
  if (existingMessages.some((message) => message.deletedAt)) {
    throw new CourseConversationRepositoryError(
      'message_conflict',
      'A persisted course question message was deleted and cannot be replayed.',
    );
  }
  const hasUser = existingMessages.some((message) => message.id === args.userMessage.id);
  const hasAssistant = existingMessages.some((message) => message.id === args.assistantMessage.id);
  if (hasUser !== hasAssistant) {
    throw new CourseConversationRepositoryError(
      'message_conflict',
      'The persisted course question turn is incomplete and cannot be replayed safely.',
    );
  }
  if (hasUser && hasAssistant && existing) {
    return { conversation: existing, messages: existingMessages, replayed: true };
  }

  const effectiveTitle =
    existing?.title?.trim() && existing.title.trim() !== '新对话'
      ? existing.title.trim()
      : args.title.trim().slice(0, 200) || '新对话';
  let conversation: CourseConversationRow;
  if (existing) {
    const rows = await tx.$queryRawUnsafe<CourseConversationRow[]>(
      `
        UPDATE "CourseConversation"
        SET
          "title" = $1,
          "revision" = "revision" + 1,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = $2 AND "ownerId" = $3 AND "deletedAt" IS NULL
        RETURNING *
      `,
      effectiveTitle,
      existing.id,
      args.userId,
    );
    if (!rows[0]) {
      throw new CourseConversationRepositoryError(
        'conversation_deleted',
        'The requested course conversation was deleted.',
      );
    }
    conversation = rows[0];
  } else {
    const rows = await tx.$queryRawUnsafe<CourseConversationRow[]>(
      `
        INSERT INTO "CourseConversation" (
          "id", "ownerId", "courseId", "sessionId", "title", "revision",
          "messageCount", "summaryThroughSequence", "summaryVersion",
          "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, $4, $5, 1, 0, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING *
      `,
      makeConversationId(),
      args.userId,
      args.courseId,
      args.sessionId,
      effectiveTitle,
    );
    conversation = rows[0];
  }
  const applied = await patchCourseConversationMessages(tx, {
    conversation,
    messages: [args.userMessage, args.assistantMessage],
    deletedMessageIds: [],
  });
  if (applied.appliedMessageIds.length !== 2) {
    throw new CourseConversationRepositoryError(
      'message_conflict',
      'The course question turn could not be persisted atomically.',
    );
  }
  conversation = applied.conversation;
  const persisted = await tx.$queryRawUnsafe<CourseConversationMessageRow[]>(
    `
      SELECT *
      FROM "CourseConversationMessage"
      WHERE "id" IN ($1, $2)
      ORDER BY "sequence"
    `,
    args.userMessage.id,
    args.assistantMessage.id,
  );
  return { conversation, messages: persisted, replayed: false };
}
