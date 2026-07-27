import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

function normalizeMessageLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return 500;
  return Math.min(Math.max(parsed, 1), 1000);
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
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, ownerId: userId, courseId },
      select: {
        id: true,
        ownerId: true,
        courseId: true,
        notebookId: true,
        kind: true,
        targetId: true,
        title: true,
        meta: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { messages: true } },
      },
    });
    if (!conversation) {
      return apiError('INVALID_REQUEST', 404, '指定用户和课程下不存在该对话');
    }

    const messages = await prisma.message.findMany({
      where: { conversationId, ownerId: userId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: messageLimit,
      select: {
        id: true,
        conversationId: true,
        ownerId: true,
        role: true,
        senderAgentId: true,
        targetAgentId: true,
        content: true,
        plainText: true,
        meta: true,
        createdAt: true,
      },
    });

    const { _count, ...conversationData } = conversation;
    return apiSuccess({
      requestedBy: {
        userId: admin.identity.userId,
        email: admin.identity.email ?? null,
      },
      conversation: {
        ...conversationData,
        messageCount: _count.messages,
      },
      messages,
      returnedMessageCount: messages.length,
      messagesTruncated: messages.length < _count.messages,
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
        const conversation = await tx.conversation.findFirst({
          where: { id: conversationId, ownerId: userId, courseId },
          select: {
            id: true,
            ownerId: true,
            courseId: true,
            notebookId: true,
            kind: true,
            targetId: true,
            title: true,
            createdAt: true,
            updatedAt: true,
          },
        });
        if (!conversation) return null;

        const messageCount = await tx.message.count({
          where: { conversationId, ownerId: userId },
        });
        const deleted = await tx.conversation.deleteMany({
          where: { id: conversationId, ownerId: userId, courseId },
        });
        if (deleted.count !== 1) return null;
        return { conversation, messageCount };
      },
      { maxWait: 20_000, timeout: 60_000 },
    );
    if (!result) {
      return apiError('INVALID_REQUEST', 404, '指定用户和课程下不存在该对话');
    }

    return apiSuccess({
      deletedConversation: result.conversation,
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
