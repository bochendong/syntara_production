import { requireAdmin } from '@/lib/server/admin-auth';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  const prisma = getOptionalPrisma();
  if (!prisma) return apiError('INTERNAL_ERROR', 503, '用量数据库暂不可用');
  try {
    const { id } = await context.params;
    const row = await prisma.lLMUsageLog.findUnique({
      where: { id },
      select: { id: true, requestContent: true, responseContent: true },
    });
    if (!row) return apiError('INVALID_REQUEST', 404, '该用量记录不存在');
    const response = apiSuccess({ row });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  } catch {
    return apiError('INTERNAL_ERROR', 500, '加载用量内容失败，请重试');
  }
}
