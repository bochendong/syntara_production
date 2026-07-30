import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

type AdminConversationDbClient = Pick<PrismaClient, '$queryRawUnsafe' | '$executeRawUnsafe'>;

type AdminConversationRow = {
  storage: 'course_conversation' | 'legacy_conversation';
  id: string;
  ownerId: string;
  courseId: string;
  notebookId: string | null;
  kind: 'course' | 'notebook' | 'agent' | 'system';
  targetId: string | null;
  sessionId: string | null;
  title: string;
  meta: unknown;
  revision: bigint | number | string | null;
  deletedAt: Date | string | null;
  lastMessageAt: Date | string | null;
  messageCount: number | bigint | string;
  activeMessageCount: number | bigint | string;
  summaryText: string | null;
  summaryThroughSequence: bigint | number | string | null;
  summaryVersion: number | null;
  summaryUpdatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AdminConversationMessageRow = {
  id: string;
  conversationId: string;
  ownerId: string;
  courseId: string | null;
  sequence: bigint | number | string | null;
  role: string | null;
  senderAgentId: string | null;
  targetAgentId: string | null;
  content: unknown;
  plainText: string | null;
  meta: unknown;
  idempotencyKey: string | null;
  requestId: string | null;
  requestPayloadHash: string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

function normalizeMessageLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(Math.max(parsed, 1), 1000);
}

function safeJsonInteger(value: bigint | number | string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function publicConversation(conversation: AdminConversationRow) {
  return {
    ...conversation,
    revision: safeJsonInteger(conversation.revision),
    messageCount: safeJsonInteger(conversation.messageCount) ?? 0,
    activeMessageCount: safeJsonInteger(conversation.activeMessageCount) ?? 0,
    summaryThroughSequence: safeJsonInteger(conversation.summaryThroughSequence),
  };
}

async function findAdminConversation(
  db: AdminConversationDbClient,
  args: { userId: string; courseId: string; conversationId: string },
): Promise<AdminConversationRow | null> {
  const rows = await db.$queryRawUnsafe<AdminConversationRow[]>(
    `
      SELECT scoped_conversation.*
      FROM (
        SELECT
          'course_conversation'::text AS "storage",
          conversation."id",
          conversation."ownerId",
          conversation."courseId",
          NULL::text AS "notebookId",
          'course'::text AS "kind",
          ('learn:' || conversation."sessionId")::text AS "targetId",
          conversation."sessionId",
          conversation."title",
          NULL::jsonb AS "meta",
          conversation."revision",
          conversation."deletedAt",
          conversation."lastMessageAt",
          (
            SELECT count(*)::integer
            FROM "CourseConversationMessage" AS message
            WHERE message."conversationId" = conversation."id"
          ) AS "messageCount",
          conversation."messageCount" AS "activeMessageCount",
          conversation."summaryText",
          conversation."summaryThroughSequence",
          conversation."summaryVersion",
          conversation."summaryUpdatedAt",
          conversation."createdAt",
          conversation."updatedAt"
        FROM "CourseConversation" AS conversation
        WHERE conversation."id" = $3
          AND conversation."ownerId" = $1
          AND conversation."courseId" = $2

        UNION ALL

        SELECT
          'legacy_conversation'::text AS "storage",
          conversation."id",
          conversation."ownerId",
          COALESCE(conversation."courseId", notebook."courseId") AS "courseId",
          conversation."notebookId",
          conversation."kind"::text AS "kind",
          conversation."targetId",
          NULL::text AS "sessionId",
          COALESCE(NULLIF(trim(conversation."title"), ''), '新对话') AS "title",
          conversation."meta",
          NULL::bigint AS "revision",
          NULL::timestamptz AS "deletedAt",
          (
            SELECT max(message."createdAt")
            FROM "Message" AS message
            WHERE message."conversationId" = conversation."id"
          ) AS "lastMessageAt",
          (
            SELECT count(*)::integer
            FROM "Message" AS message
            WHERE message."conversationId" = conversation."id"
          ) AS "messageCount",
          (
            SELECT count(*)::integer
            FROM "Message" AS message
            WHERE message."conversationId" = conversation."id"
          ) AS "activeMessageCount",
          NULL::text AS "summaryText",
          NULL::bigint AS "summaryThroughSequence",
          NULL::integer AS "summaryVersion",
          NULL::timestamptz AS "summaryUpdatedAt",
          conversation."createdAt",
          conversation."updatedAt"
        FROM "Conversation" AS conversation
        LEFT JOIN "Notebook" AS notebook
          ON notebook."id" = conversation."notebookId"
        WHERE conversation."id" = $3
          AND conversation."ownerId" = $1
          AND COALESCE(conversation."courseId", notebook."courseId") = $2
          AND conversation."kind" IN ('notebook', 'agent', 'system')
          AND (
            conversation."targetId" IS NULL
            OR conversation."targetId" NOT LIKE 'learn:%'
          )
      ) AS scoped_conversation
      LIMIT 1
    `,
    args.userId,
    args.courseId,
    args.conversationId,
  );
  return rows[0] ?? null;
}

async function listAdminConversationMessages(
  db: AdminConversationDbClient,
  conversation: AdminConversationRow,
  limit: number,
): Promise<AdminConversationMessageRow[]> {
  if (conversation.storage === 'course_conversation') {
    return db.$queryRawUnsafe<AdminConversationMessageRow[]>(
      `
        SELECT
          message."id",
          message."conversationId",
          message."ownerId",
          message."courseId",
          message."sequence",
          message."role"::text AS "role",
          NULL::text AS "senderAgentId",
          NULL::text AS "targetAgentId",
          message."content",
          message."plainText",
          NULL::jsonb AS "meta",
          message."idempotencyKey",
          message."requestId",
          message."requestPayloadHash",
          message."deletedAt",
          message."createdAt",
          message."updatedAt"
        FROM "CourseConversationMessage" AS message
        WHERE message."conversationId" = $1
          AND message."ownerId" = $2
          AND message."courseId" = $3
        ORDER BY message."sequence" ASC, message."id" ASC
        LIMIT $4
      `,
      conversation.id,
      conversation.ownerId,
      conversation.courseId,
      limit,
    );
  }

  return db.$queryRawUnsafe<AdminConversationMessageRow[]>(
    `
      SELECT
        message."id",
        message."conversationId",
        message."ownerId",
        NULL::text AS "courseId",
        NULL::bigint AS "sequence",
        message."role",
        message."senderAgentId",
        message."targetAgentId",
        message."content",
        message."plainText",
        message."meta",
        NULL::text AS "idempotencyKey",
        NULL::text AS "requestId",
        NULL::text AS "requestPayloadHash",
        NULL::timestamptz AS "deletedAt",
        message."createdAt",
        message."createdAt" AS "updatedAt"
      FROM "Message" AS message
      WHERE message."conversationId" = $1
        AND message."ownerId" = $2
      ORDER BY message."createdAt" ASC, message."id" ASC
      LIMIT $3
    `,
    conversation.id,
    conversation.ownerId,
    limit,
  );
}

export async function GET(
  request: Request,
  context: {
    params: Promise<{ userId: string; courseId: string; conversationId: string }>;
  },
) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法读取指定对话');
  }

  const { userId, courseId, conversationId } = await context.params;
  const messageLimit = normalizeMessageLimit(new URL(request.url).searchParams.get('messageLimit'));

  try {
    const conversation = await findAdminConversation(prisma, {
      userId,
      courseId,
      conversationId,
    });
    if (!conversation) {
      return apiError('INVALID_REQUEST', 404, '指定用户和课程下不存在该对话');
    }
    const messages = await listAdminConversationMessages(prisma, conversation, messageLimit);
    const messageCount = safeJsonInteger(conversation.messageCount) ?? 0;

    return apiSuccess({
      requestedBy: {
        userId: admin.identity.userId,
        email: admin.identity.email ?? null,
      },
      conversation: publicConversation(conversation),
      messages: messages.map((message) => ({
        ...message,
        sequence: safeJsonInteger(message.sequence),
      })),
      returnedMessageCount: messages.length,
      messagesTruncated: messages.length < messageCount,
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}

export async function DELETE(
  request: Request,
  context: {
    params: Promise<{ userId: string; courseId: string; conversationId: string }>;
  },
) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法删除指定对话');
  }

  const { userId, courseId, conversationId } = await context.params;
  const confirmation = new URL(request.url).searchParams.get('confirm')?.trim();
  if (confirmation !== conversationId) {
    return apiError(
      'INVALID_REQUEST',
      400,
      '永久删除需要 confirm 查询参数，且其值必须等于 conversationId',
    );
  }

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const conversation = await findAdminConversation(tx, {
          userId,
          courseId,
          conversationId,
        });
        if (!conversation) return null;

        let deleted: number;
        if (conversation.storage === 'course_conversation') {
          await tx.$executeRawUnsafe(
            `
              UPDATE "CourseQuestionRun"
              SET "conversationId" = NULL
              WHERE "conversationId" = $1
                AND "ownerId" = $2
                AND "courseId" = $3
            `,
            conversationId,
            userId,
            courseId,
          );
          deleted = await tx.$executeRawUnsafe(
            `
              DELETE FROM "CourseConversation"
              WHERE "id" = $1
                AND "ownerId" = $2
                AND "courseId" = $3
            `,
            conversationId,
            userId,
            courseId,
          );
        } else {
          deleted = await tx.$executeRawUnsafe(
            `
                  DELETE FROM "Conversation"
                  WHERE "id" = $1
                    AND "ownerId" = $2
                    AND (
                      "courseId" = $3
                      OR (
                        "courseId" IS NULL
                        AND "notebookId" IN (
                          SELECT "id"
                          FROM "Notebook"
                          WHERE "courseId" = $3
                        )
                      )
                    )
                    AND "kind" IN ('notebook', 'agent', 'system')
                `,
            conversationId,
            userId,
            courseId,
          );
        }
        if (deleted !== 1) return null;
        return {
          conversation,
          messageCount: safeJsonInteger(conversation.messageCount) ?? 0,
        };
      },
      { maxWait: 20_000, timeout: 60_000 },
    );
    if (!result) {
      return apiError('INVALID_REQUEST', 404, '指定用户和课程下不存在该对话');
    }

    return apiSuccess({
      deletedConversation: publicConversation(result.conversation),
      deletedMessageCount: result.messageCount,
      deletedBy: {
        userId: admin.identity.userId,
        email: admin.identity.email ?? null,
      },
      recoverable: false,
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
