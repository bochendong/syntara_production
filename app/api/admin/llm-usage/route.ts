import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { estimateTrackedModelUsageBaseCostUsd } from '@/lib/utils/openai-pricing';

const PAGE_SIZE = 20;

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const requestedPage = Number(new URL(request.url).searchParams.get('page'));
  const page =
    Number.isSafeInteger(requestedPage) && requestedPage > 0 && requestedPage <= 100_000
      ? requestedPage
      : 1;

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiSuccess({
      summary: {
        totalRequests: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        estimatedCostUsd: 0,
      },
      rows: [],
      pagination: { page, pageSize: PAGE_SIZE, total: 0, totalPages: 1 },
    });
  }

  try {
    const [rows, aggregate, costRows] = await Promise.all([
      prisma.lLMUsageLog.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        select: {
          id: true,
          userId: true,
          userEmail: true,
          userName: true,
          route: true,
          source: true,
          providerId: true,
          modelId: true,
          modelString: true,
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
        },
      }),
      prisma.lLMUsageLog.aggregate({
        _count: { id: true },
        _sum: {
          inputTokens: true,
          outputTokens: true,
          totalTokens: true,
        },
      }),
      prisma.lLMUsageLog.groupBy({
        by: ['providerId', 'modelId', 'modelString'],
        _sum: {
          inputTokens: true,
          outputTokens: true,
        },
      }),
    ]);

    const mappedRows = rows.map((row: (typeof rows)[number]) => {
      const estimatedCostUsd = estimateTrackedModelUsageBaseCostUsd({
        providerId: row.providerId,
        modelId: row.modelId,
        modelString: row.modelString,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      });
      return {
        id: row.id,
        userId: row.userId,
        userEmail: row.user?.email?.trim() || row.userEmail?.trim() || null,
        userName: row.user?.name?.trim() || row.userName?.trim() || null,
        route: row.route,
        source: row.source,
        providerId: row.providerId,
        modelId: row.modelId,
        modelString: row.modelString,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
        totalTokens: row.totalTokens,
        estimatedCostUsd,
        createdAt: row.createdAt,
      };
    });

    const estimatedCostUsd = costRows.reduce(
      (sum, row) =>
        sum +
        (estimateTrackedModelUsageBaseCostUsd({
          providerId: row.providerId,
          modelId: row.modelId,
          modelString: row.modelString,
          inputTokens: row._sum.inputTokens,
          outputTokens: row._sum.outputTokens,
        }) ?? 0),
      0,
    );

    return apiSuccess({
      summary: {
        totalRequests: aggregate._count.id,
        totalInputTokens: aggregate._sum.inputTokens ?? 0,
        totalOutputTokens: aggregate._sum.outputTokens ?? 0,
        totalTokens: aggregate._sum.totalTokens ?? 0,
        estimatedCostUsd,
      },
      rows: mappedRows,
      pagination: {
        page,
        pageSize: PAGE_SIZE,
        total: aggregate._count.id,
        totalPages: Math.max(1, Math.ceil(aggregate._count.id / PAGE_SIZE)),
      },
    });
  } catch (error) {
    return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
  }
}
