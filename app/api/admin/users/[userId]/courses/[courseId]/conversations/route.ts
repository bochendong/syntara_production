import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

const CONVERSATION_KINDS = new Set(['notebook', 'agent', 'system', 'course']);

function normalizeTake(raw: string | null): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(parsed, 1), 200);
}

type AdminConversationListRow = {
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
  summaryText: string | null;
  summaryThroughSequence: bigint | number | string | null;
  summaryVersion: number | null;
  summaryUpdatedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  totalCount: bigint | number | string;
};

function safeJsonInteger(value: bigint | number | string | null): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string; courseId: string }> },
) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法读取用户课程对话');
  }

  const { userId, courseId } = await context.params;
  const { searchParams } = new URL(request.url);
  const rawKind = searchParams.get('kind')?.trim() || '';
  if (rawKind && !CONVERSATION_KINDS.has(rawKind)) {
    return apiError('INVALID_REQUEST', 400, 'kind 必须是 notebook、agent、system 或 course');
  }
  const query = searchParams.get('query')?.trim() || '';
  const take = normalizeTake(searchParams.get('take'));

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) return apiError('INVALID_REQUEST', 404, '用户不存在');

    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: { id: true, name: true, ownerId: true },
    });
    if (!course) return apiError('INVALID_REQUEST', 404, '课程不存在');

    // A single union keeps the admin inventory coherent across the dedicated
    // /learn store and the legacy generic notebook/agent/system store. Legacy
    // learn:* rows are deliberately excluded because the migration retains
    // them after copying their canonical data into CourseConversation.
    const rows = await prisma.$queryRawUnsafe<AdminConversationListRow[]>(
      `
        WITH conversation_rows AS (
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
            conversation."messageCount",
            conversation."summaryText",
            conversation."summaryThroughSequence",
            conversation."summaryVersion",
            conversation."summaryUpdatedAt",
            conversation."createdAt",
            conversation."updatedAt"
          FROM "CourseConversation" AS conversation
          WHERE conversation."ownerId" = $1
            AND conversation."courseId" = $2
            AND ($3::text = '' OR $3::text = 'course')
            AND (
              $4::text = ''
              OR conversation."title" ILIKE ('%' || $4 || '%')
              OR conversation."sessionId" ILIKE ('%' || $4 || '%')
            )

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
            NULL::text AS "summaryText",
            NULL::bigint AS "summaryThroughSequence",
            NULL::integer AS "summaryVersion",
            NULL::timestamptz AS "summaryUpdatedAt",
            conversation."createdAt",
            conversation."updatedAt"
          FROM "Conversation" AS conversation
          LEFT JOIN "Notebook" AS notebook
            ON notebook."id" = conversation."notebookId"
          WHERE conversation."ownerId" = $1
            AND COALESCE(conversation."courseId", notebook."courseId") = $2
            AND conversation."kind" IN ('notebook', 'agent', 'system')
            AND (
              conversation."targetId" IS NULL
              OR conversation."targetId" NOT LIKE 'learn:%'
            )
            AND ($3::text = '' OR conversation."kind"::text = $3)
            AND (
              $4::text = ''
              OR conversation."title" ILIKE ('%' || $4 || '%')
              OR conversation."targetId" ILIKE ('%' || $4 || '%')
            )
        )
        SELECT
          conversation_rows.*,
          count(*) OVER () AS "totalCount"
        FROM conversation_rows
        ORDER BY conversation_rows."updatedAt" DESC, conversation_rows."id" DESC
        LIMIT $5
      `,
      userId,
      courseId,
      rawKind,
      query,
      take,
    );
    const totalCount = Number(rows[0]?.totalCount ?? 0);

    return apiSuccess({
      requestedBy: {
        userId: admin.identity.userId,
        email: admin.identity.email ?? null,
      },
      scope: { user, course },
      totalCount,
      conversations: rows.map(({ totalCount: _totalCount, ...conversation }) => ({
        ...conversation,
        revision: safeJsonInteger(conversation.revision),
        messageCount: safeJsonInteger(conversation.messageCount) ?? 0,
        summaryThroughSequence: safeJsonInteger(conversation.summaryThroughSequence),
      })),
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
