import { Prisma } from '@/lib/server/generated-prisma';
import { createLogger } from '@/lib/logger';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import type { DbClient } from '@/lib/server/repositories/types';
import { estimateTrackedModelUsageRetailCostUsd } from '@/lib/utils/openai-pricing';

const log = createLogger('CloudUsageLimits');

export type UsageLimitScope = 'global' | 'user';

export type CloudUsageSummary = {
  estimatedCostUsd: number;
  requestCount: number;
};

export type CloudUsageGlobalLimit = {
  enabled: boolean;
  weeklyCostLimitUsd: number | null;
  weeklyRequestLimit: number | null;
  periodTimezone: string;
  updatedBy: string | null;
  updatedAt: string | null;
};

export type CloudUsageUserLimit = {
  userId: string;
  weeklyCostLimitUsd: number | null;
  weeklyRequestLimit: number | null;
  disabled: boolean;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
};

type LimitRow = {
  enabled?: boolean;
  weeklyCostLimitUsd: Prisma.Decimal | number | string | null;
  weeklyRequestLimit: number | null;
  periodTimezone?: string | null;
  disabled?: boolean;
  note?: string | null;
  updatedBy?: string | null;
  updatedAt?: Date | string | null;
};

type LLMUsageCostRow = {
  providerId: string;
  modelId: string;
  modelString: string;
  inputTokens: number;
  outputTokens: number;
};

type CostLogAggregateRow = {
  estimatedCostUsd: Prisma.Decimal | number | string | null;
  requestCount: number | null;
};

function toNullableNumber(
  value: Prisma.Decimal | number | string | null | undefined,
): number | null {
  if (value == null) return null;
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number.parseFloat(value)
        : value.toNumber();
  return Number.isFinite(parsed) ? parsed : null;
}

export function getCloudUsageWeekWindow(now = new Date()): { start: Date; end: Date } {
  const start = new Date(now);
  const day = start.getUTCDay();
  const daysSinceMonday = day === 0 ? 6 : day - 1;
  start.setUTCDate(start.getUTCDate() - daysSinceMonday);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 7);
  return { start, end };
}

function normalizeGlobalLimit(row: LimitRow | null | undefined): CloudUsageGlobalLimit {
  return {
    enabled: Boolean(row?.enabled),
    weeklyCostLimitUsd: toNullableNumber(row?.weeklyCostLimitUsd),
    weeklyRequestLimit: row?.weeklyRequestLimit ?? null,
    periodTimezone: row?.periodTimezone || 'UTC',
    updatedBy: row?.updatedBy ?? null,
    updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

function normalizeUserLimit(
  userId: string,
  row: LimitRow | null | undefined,
): CloudUsageUserLimit | null {
  if (!row) return null;
  return {
    userId,
    weeklyCostLimitUsd: toNullableNumber(row.weeklyCostLimitUsd),
    weeklyRequestLimit: row.weeklyRequestLimit ?? null,
    disabled: Boolean(row.disabled),
    note: row.note ?? null,
    updatedBy: row.updatedBy ?? null,
    updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
  };
}

function overCostLimit(summary: CloudUsageSummary, limit: number | null): boolean {
  return limit != null && limit >= 0 && summary.estimatedCostUsd >= limit;
}

function overRequestLimit(summary: CloudUsageSummary, limit: number | null): boolean {
  return limit != null && limit >= 0 && summary.requestCount >= limit;
}

function assertWithinLimit(args: {
  scope: UsageLimitScope;
  summary: CloudUsageSummary;
  costLimit: number | null;
  requestLimit: number | null;
}): void {
  if (overCostLimit(args.summary, args.costLimit)) {
    throw new Error(
      args.scope === 'global'
        ? '全站云端每周成本上限已达到，API 调用已暂停'
        : '你的本周 AI 用量已用完，将在下周一恢复',
    );
  }
  if (overRequestLimit(args.summary, args.requestLimit)) {
    throw new Error(
      args.scope === 'global'
        ? '全站云端每周请求数上限已达到，API 调用已暂停'
        : '你的本周 AI 请求次数已用完，将在下周一恢复',
    );
  }
}

export async function getCloudUsageGlobalLimit(db: DbClient): Promise<CloudUsageGlobalLimit> {
  const rows = await db.$queryRaw<LimitRow[]>(
    Prisma.sql`
      SELECT "enabled", "weeklyCostLimitUsd", "weeklyRequestLimit", "periodTimezone", "updatedBy", "updatedAt"
      FROM "CloudUsageGlobalLimit"
      WHERE "id" = 'global'
      LIMIT 1
    `,
  );
  return normalizeGlobalLimit(rows[0]);
}

export async function getCloudUsageUserLimit(
  db: DbClient,
  userId: string,
): Promise<CloudUsageUserLimit | null> {
  const rows = await db.$queryRaw<LimitRow[]>(
    Prisma.sql`
      SELECT "weeklyCostLimitUsd", "weeklyRequestLimit", "disabled", "note", "updatedBy", "updatedAt"
      FROM "CloudUsageUserLimit"
      WHERE "userId" = ${userId}
      LIMIT 1
    `,
  );
  return normalizeUserLimit(userId, rows[0]);
}

export async function summarizeCloudUsage(
  db: DbClient,
  userId?: string | null,
): Promise<CloudUsageSummary> {
  const { start, end } = getCloudUsageWeekWindow();
  const llmRows = userId
    ? await db.$queryRaw<LLMUsageCostRow[]>(
        Prisma.sql`
          SELECT "providerId", "modelId", "modelString", "inputTokens", "outputTokens"
          FROM "LLMUsageLog"
          WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND "userId" = ${userId}
        `,
      )
    : await db.$queryRaw<LLMUsageCostRow[]>(
        Prisma.sql`
          SELECT "providerId", "modelId", "modelString", "inputTokens", "outputTokens"
          FROM "LLMUsageLog"
          WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
        `,
      );

  const llmCost = llmRows.reduce((sum, row) => {
    return (
      sum +
      (estimateTrackedModelUsageRetailCostUsd({
        providerId: row.providerId,
        modelId: row.modelId,
        modelString: row.modelString,
        inputTokens: row.inputTokens,
        outputTokens: row.outputTokens,
      }) ?? 0)
    );
  }, 0);

  const costRows = userId
    ? await db.$queryRaw<CostLogAggregateRow[]>(
        Prisma.sql`
          SELECT
            COALESCE(SUM("estimatedCostUsd"), 0) AS "estimatedCostUsd",
            COALESCE(SUM("requestCount"), 0)::int AS "requestCount"
          FROM "CloudUsageCostLog"
          WHERE "createdAt" >= ${start} AND "createdAt" < ${end} AND "userId" = ${userId}
        `,
      )
    : await db.$queryRaw<CostLogAggregateRow[]>(
        Prisma.sql`
          SELECT
            COALESCE(SUM("estimatedCostUsd"), 0) AS "estimatedCostUsd",
            COALESCE(SUM("requestCount"), 0)::int AS "requestCount"
          FROM "CloudUsageCostLog"
          WHERE "createdAt" >= ${start} AND "createdAt" < ${end}
        `,
      );

  return {
    estimatedCostUsd: llmCost + (toNullableNumber(costRows[0]?.estimatedCostUsd) ?? 0),
    requestCount: llmRows.length + (costRows[0]?.requestCount ?? 0),
  };
}

export async function assertCloudUsageAllowed(userId?: string | null): Promise<void> {
  const prisma = getOptionalPrisma();
  if (!prisma) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('云端额度数据库不可用，API 调用已暂停');
    }
    return;
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(927314560)`);

      const globalLimit = await getCloudUsageGlobalLimit(tx);
      if (globalLimit.enabled) {
        const globalSummary = await summarizeCloudUsage(tx);
        assertWithinLimit({
          scope: 'global',
          summary: globalSummary,
          costLimit: globalLimit.weeklyCostLimitUsd,
          requestLimit: globalLimit.weeklyRequestLimit,
        });
      }

      const normalizedUserId = userId?.trim();
      if (!normalizedUserId) return;

      const userLimit = await getCloudUsageUserLimit(tx, normalizedUserId);
      if (!userLimit) return;
      if (userLimit.disabled) {
        throw new Error('该用户的云端 API 调用已被管理员暂停');
      }

      const userSummary = await summarizeCloudUsage(tx, normalizedUserId);
      assertWithinLimit({
        scope: 'user',
        summary: userSummary,
        costLimit: userLimit.weeklyCostLimitUsd,
        requestLimit: userLimit.weeklyRequestLimit,
      });
    });
  } catch (error) {
    if (error instanceof Error && /CloudUsage/.test(error.message)) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('云端额度数据库表不可用，API 调用已暂停');
      }
      log.warn('Cloud usage limit tables are unavailable; skipping cloud quota check', error);
      return;
    }
    throw error;
  }
}

export async function recordCloudUsageCost(args: {
  userId?: string | null;
  route?: string | null;
  source?: string | null;
  estimatedCostUsd?: number | null;
  requestCount?: number | null;
  metadata?: Prisma.InputJsonObject;
}): Promise<void> {
  const prisma = getOptionalPrisma();
  if (!prisma) return;

  const estimatedCostUsd =
    typeof args.estimatedCostUsd === 'number' && Number.isFinite(args.estimatedCostUsd)
      ? Math.max(0, args.estimatedCostUsd)
      : 0;
  const requestCount =
    typeof args.requestCount === 'number' && Number.isFinite(args.requestCount)
      ? Math.max(1, Math.round(args.requestCount))
      : 1;
  if (estimatedCostUsd <= 0 && requestCount <= 0) return;

  try {
    const metadataJson = JSON.stringify(args.metadata ?? null);
    await prisma.$executeRaw(
      Prisma.sql`
        INSERT INTO "CloudUsageCostLog" ("userId", "route", "source", "estimatedCostUsd", "requestCount", "metadata")
        VALUES (
          ${args.userId?.trim() || null},
          ${args.route?.trim() || 'unknown'},
          ${args.source?.trim() || 'service'},
          ${estimatedCostUsd},
          ${requestCount},
          CAST(${metadataJson} AS jsonb)
        )
      `,
    );
  } catch (error) {
    log.warn('Failed to record cloud usage cost', error);
  }
}
