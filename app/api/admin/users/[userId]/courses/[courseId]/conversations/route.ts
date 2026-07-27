import type { Prisma } from '@prisma/client';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

const CONVERSATION_KINDS = new Set(['notebook', 'agent', 'system', 'course']);

function normalizeTake(raw: string | null): number {
  const parsed = Number.parseInt(raw || '', 10);
  if (!Number.isFinite(parsed)) return 100;
  return Math.min(Math.max(parsed, 1), 200);
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

    const where: Prisma.ConversationWhereInput = {
      ownerId: userId,
      courseId,
      ...(rawKind ? { kind: rawKind as 'notebook' | 'agent' | 'system' | 'course' } : {}),
      ...(query
        ? {
            OR: [
              { title: { contains: query, mode: 'insensitive' } },
              { targetId: { contains: query, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    // Keep these sequential for the small connection budget used by the
    // managed database proxy.
    const conversations = await prisma.conversation.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take,
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
    const totalCount = await prisma.conversation.count({ where });

    return apiSuccess({
      requestedBy: {
        userId: admin.identity.userId,
        email: admin.identity.email ?? null,
      },
      scope: { user, course },
      totalCount,
      conversations: conversations.map(({ _count, ...conversation }) => ({
        ...conversation,
        messageCount: _count.messages,
      })),
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
