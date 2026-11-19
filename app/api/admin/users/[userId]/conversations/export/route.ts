import { apiError } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { isDatabaseUnavailableError } from '@/lib/server/json-error-response';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const conversationFields = {
  id: true,
  courseId: true,
  title: true,
  createdAt: true,
  updatedAt: true,
} as const;

const messageFields = {
  id: true,
  role: true,
  content: true,
  plainText: true,
  createdAt: true,
} as const;

export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  if (process.env.SYNTARA_APP_ENV !== 'staging') {
    return apiError('INVALID_REQUEST', 404, '接口不存在');
  }

  try {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;

    const db = getOptionalPrisma();
    if (!db) return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法导出聊天记录');

    const { userId } = await context.params;
    const exportData = await db.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
        if (!user) return null;

        const courseChats = await tx.courseConversation.findMany({
          where: { ownerId: userId, deletedAt: null },
          select: {
            ...conversationFields,
            sessionId: true,
            messages: {
              where: { ownerId: userId, deletedAt: null },
              orderBy: { sequence: 'asc' },
              select: { ...messageFields, sequence: true, requestId: true },
            },
          },
        });
        const otherChats = await tx.conversation.findMany({
          // The legacy course rows are retained as migration sources.
          where: { ownerId: userId, kind: { in: ['notebook', 'agent', 'system'] } },
          select: {
            ...conversationFields,
            kind: true,
            targetId: true,
            notebookId: true,
            notebook: { select: { courseId: true } },
            messages: {
              where: { ownerId: userId },
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              select: {
                ...messageFields,
                senderAgentId: true,
                targetAgentId: true,
                meta: true,
              },
            },
          },
        });
        return { courseChats, otherChats };
      },
      { isolationLevel: 'RepeatableRead', timeout: 60_000 },
    );
    if (!exportData) return apiError('INVALID_REQUEST', 404, '用户不存在');

    const conversations = [
      ...exportData.courseChats.map(({ messages, ...conversation }) => ({
        ...conversation,
        kind: 'course' as const,
        messages: messages.map(({ sequence, ...message }) => ({
          ...message,
          // The database constrains sequence to the safe integer range.
          sequence: Number(sequence),
        })),
      })),
      ...exportData.otherChats.map(({ notebook, ...conversation }) => ({
        ...conversation,
        courseId: conversation.courseId ?? notebook?.courseId ?? null,
      })),
    ].sort(
      (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id, 'en'),
    );

    const filenameId = userId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
    return Response.json(
      {
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        userId,
        conversationCount: conversations.length,
        messageCount: conversations.reduce((total, chat) => total + chat.messages.length, 0),
        conversations,
      },
      {
        headers: {
          'Cache-Control': 'private, no-store',
          'Content-Disposition': `attachment; filename="user-${filenameId}-conversations.json"`,
        },
      },
    );
  } catch (error) {
    if (isDatabaseUnavailableError(error)) {
      return apiError('INTERNAL_ERROR', 503, '数据库暂时不可用，无法导出聊天记录');
    }
    console.error('[admin/conversations/export] export failed', error);
    return apiError('INTERNAL_ERROR', 500, '聊天记录导出失败');
  }
}
