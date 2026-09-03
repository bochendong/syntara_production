import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireUserId } from '@/lib/server/api-auth';
import {
  getCloudUsageUserLimit,
  getCloudUsageWeekWindow,
  summarizeCloudUsage,
} from '@/lib/server/cloud-usage-limits';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { creditsFromUsd } from '@/lib/utils/credits';

export async function GET() {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;

  const prisma = getOptionalPrisma();
  const period = getCloudUsageWeekWindow();
  if (!prisma) {
    return apiSuccess({
      databaseEnabled: false,
      period: { start: period.start.toISOString(), end: period.end.toISOString() },
      usedCredits: 0,
      limitCredits: null,
      remainingCredits: null,
      requestCount: 0,
      requestLimit: null,
      remainingRequests: null,
      disabled: false,
    });
  }

  try {
    const [limit, usage] = await Promise.all([
      getCloudUsageUserLimit(prisma, auth.userId),
      summarizeCloudUsage(prisma, auth.userId),
    ]);
    const usedCredits = creditsFromUsd(usage.estimatedCostUsd, 'ceil');
    const limitCredits =
      limit?.weeklyCostLimitUsd == null ? null : creditsFromUsd(limit.weeklyCostLimitUsd, 'round');

    return apiSuccess({
      databaseEnabled: true,
      period: { start: period.start.toISOString(), end: period.end.toISOString() },
      usedCredits,
      limitCredits,
      remainingCredits: limitCredits == null ? null : Math.max(0, limitCredits - usedCredits),
      requestCount: usage.requestCount,
      requestLimit: limit?.weeklyRequestLimit ?? null,
      remainingRequests:
        limit?.weeklyRequestLimit == null
          ? null
          : Math.max(0, limit.weeklyRequestLimit - usage.requestCount),
      disabled: Boolean(limit?.disabled),
    });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : '每周用量读取失败',
    );
  }
}
