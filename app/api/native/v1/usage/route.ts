import { NextRequest, NextResponse } from 'next/server';

import {
  getCloudUsageUserLimit,
  getCloudUsageWeekWindow,
  summarizeCloudUsage,
} from '@/lib/server/cloud-usage-limits';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

/** App 的「本周用量」：和网页侧边栏 /api/profile/weekly-usage 同一份数据，改用设备令牌鉴权。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;

  const prisma = getOptionalPrisma();
  const period = getCloudUsageWeekWindow();
  const periodJson = { start: period.start.toISOString(), end: period.end.toISOString() };
  if (!prisma) {
    return publicApiSuccess(requestId, {
      databaseEnabled: false,
      period: periodJson,
      usedUsd: 0,
      limitUsd: null,
      remainingUsd: null,
      requestCount: 0,
      requestLimit: null,
      remainingRequests: null,
      disabled: false,
    });
  }

  try {
    const [limit, usage] = await Promise.all([
      getCloudUsageUserLimit(prisma, principal.userId),
      summarizeCloudUsage(prisma, principal.userId),
    ]);
    const usedUsd = usage.estimatedCostUsd;
    const limitUsd = limit?.weeklyCostLimitUsd ?? null;
    const requestLimit = limit?.weeklyRequestLimit ?? null;
    return publicApiSuccess(requestId, {
      databaseEnabled: true,
      period: periodJson,
      usedUsd,
      limitUsd,
      remainingUsd: limitUsd == null ? null : Math.max(0, limitUsd - usedUsd),
      requestCount: usage.requestCount,
      requestLimit,
      remainingRequests:
        requestLimit == null ? null : Math.max(0, requestLimit - usage.requestCount),
      disabled: Boolean(limit?.disabled),
    });
  } catch (error) {
    return publicApiError(
      requestId,
      500,
      'upstream_error',
      error instanceof Error ? error.message : '每周用量读取失败',
    );
  }
}
