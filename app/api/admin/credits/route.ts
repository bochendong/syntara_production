import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { applyCreditDelta, ensureUserCreditsInitialized } from '@/lib/server/credits';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { CreditTransactionKind } from '@prisma/client';

function normalizeSearch(raw: string | null): string {
  return raw?.trim().toLowerCase() || '';
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法搜索用户积分账户');
  }

  const { searchParams } = new URL(request.url);
  const query = normalizeSearch(searchParams.get('query'));

  if (!query) {
    return apiSuccess({ users: [] });
  }

  try {
    const rows = await prisma.user.findMany({
      where: {
        email: {
          contains: query,
          mode: 'insensitive',
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 10,
      select: {
        id: true,
        email: true,
        name: true,
        creditsBalance: true,
        createdAt: true,
      },
    });

    return apiSuccess({
      users: rows.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.name,
        creditsBalance: row.creditsBalance,
        createdAt: row.createdAt,
      })),
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiError('INTERNAL_ERROR', 503, '数据库不可用，无法发放积分');
  }

  let body: {
    userId?: string;
    amount?: number;
    note?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return apiError('INVALID_REQUEST', 400, '请求体不是有效 JSON');
  }

  const userId = body.userId?.trim();
  const amount =
    typeof body.amount === 'number' && Number.isFinite(body.amount) ? Math.round(body.amount) : 0;
  const note = body.note?.trim() || '';

  if (!userId) {
    return apiError('MISSING_REQUIRED_FIELD', 400, '缺少用户 ID');
  }
  if (amount <= 0) {
    return apiError('INVALID_REQUEST', 400, '积分数必须大于 0');
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      await ensureUserCreditsInitialized(tx, userId);
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, creditsBalance: true },
      });
      if (!user) {
        throw new Error('用户不存在');
      }

      const balance = await applyCreditDelta(tx, {
        userId,
        delta: amount,
        kind: CreditTransactionKind.WELCOME_BONUS,
        description: note ? `Admin grant: ${note}` : 'Admin grant',
        referenceType: 'admin_grant',
        referenceId: admin.identity.userId,
        metadata: {
          adminUserId: admin.identity.userId,
          adminEmail: admin.identity.email ?? null,
          note: note || null,
        },
      });

      return {
        id: user.id,
        email: user.email,
        name: user.name,
        balance,
      };
    });

    return apiSuccess({
      user: result,
      granted: amount,
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
