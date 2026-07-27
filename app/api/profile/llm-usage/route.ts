import { apiSuccess } from '@/lib/server/api-response';
import { requireUserId } from '@/lib/server/api-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  estimateOpenAITextUsageRetailCostCredits,
  estimateOpenAITextUsageRetailCostUsd,
} from '@/lib/utils/openai-pricing';

const DEFAULT_RECORDS_PAGE_SIZE = 8;
const MAX_RECORDS_PAGE_SIZE = 50;
const SPEND_CHART_DAYS = 30;
const MAX_SPEND_CHART_SERIES = 8;

const usageRecordSelect = {
  id: true,
  route: true,
  source: true,
  providerId: true,
  modelId: true,
  modelString: true,
  inputTokens: true,
  outputTokens: true,
  totalTokens: true,
  createdAt: true,
} as const;

type UsageSummary = {
  totalCalls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  estimatedCostCredits: number;
};

type ModelBreakdownRow = {
  modelString: string;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  estimatedCostCredits: number | null;
};

type SpendChartPoint = {
  date: string;
  label: string;
};

type SpendChartSeriesRow = {
  modelString: string;
  estimatedCostUsd: number;
  estimatedCostCredits: number;
  cumulativeEstimatedCostUsd: number[];
  cumulativeEstimatedCostCredits: number[];
};

type SpendChart = {
  periodLabel: string;
  startDate: string;
  endDate: string;
  dates: SpendChartPoint[];
  series: SpendChartSeriesRow[];
  totalEstimatedCostUsd: number;
  totalEstimatedCostCredits: number;
};

type UsageRecordRow = {
  id: string;
  route: string;
  source: string;
  providerId: string;
  modelId: string;
  modelString: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number | null;
  estimatedCostCredits: number | null;
  createdAt: string;
};

function buildEmptySummary(): UsageSummary {
  return {
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
    estimatedCostCredits: 0,
  };
}

function buildDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildSpendChart(args: {
  rows: Array<{
    createdAt: Date;
    providerId: string;
    modelId: string;
    modelString: string;
    inputTokens: number;
    outputTokens: number;
  }>;
  dayCount?: number;
  maxSeries?: number;
}): SpendChart {
  const dayCount = Math.max(1, args.dayCount ?? SPEND_CHART_DAYS);
  const maxSeries = Math.max(1, args.maxSeries ?? MAX_SPEND_CHART_SERIES);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const startDate = new Date(today);
  startDate.setDate(today.getDate() - (dayCount - 1));

  const labelFormatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  });

  const dates: SpendChartPoint[] = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    return {
      date: buildDateKey(date),
      label: labelFormatter.format(date),
    };
  });

  const spendByModelByDay = new Map<string, Map<string, { usd: number; credits: number }>>();
  const totalByModel = new Map<string, { usd: number; credits: number }>();

  for (const row of args.rows) {
    const estimatedCostUsd = estimateOpenAITextUsageRetailCostUsd({
      providerId: row.providerId,
      modelId: row.modelId,
      modelString: row.modelString,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
    });
    const estimatedCostCredits = estimateOpenAITextUsageRetailCostCredits({
      providerId: row.providerId,
      modelId: row.modelId,
      modelString: row.modelString,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
    });
    if (estimatedCostUsd == null || estimatedCostCredits == null) {
      continue;
    }

    const dayKey = buildDateKey(row.createdAt);
    if (dayKey < dates[0]?.date || dayKey > dates[dates.length - 1]?.date) {
      continue;
    }

    const currentTotal = totalByModel.get(row.modelString) ?? { usd: 0, credits: 0 };
    currentTotal.usd += estimatedCostUsd;
    currentTotal.credits += estimatedCostCredits;
    totalByModel.set(row.modelString, currentTotal);

    const byDay = spendByModelByDay.get(row.modelString) ?? new Map<string, { usd: number; credits: number }>();
    const currentDay = byDay.get(dayKey) ?? { usd: 0, credits: 0 };
    currentDay.usd += estimatedCostUsd;
    currentDay.credits += estimatedCostCredits;
    byDay.set(dayKey, currentDay);
    spendByModelByDay.set(row.modelString, byDay);
  }

  const sortedModels = [...totalByModel.entries()].sort((a, b) => b[1].usd - a[1].usd);
  const shouldGroupOther = sortedModels.length > maxSeries;
  const topModels = sortedModels
    .slice(0, shouldGroupOther ? maxSeries - 1 : maxSeries)
    .map(([modelString]) => modelString);
  const otherModels = sortedModels.slice(topModels.length).map(([modelString]) => modelString);
  const seriesNames = otherModels.length > 0 ? [...topModels, 'other'] : topModels;

  const series: SpendChartSeriesRow[] = seriesNames.map((seriesName) => {
    let cumulativeEstimatedCostUsd = 0;
    let cumulativeEstimatedCostCredits = 0;

    return {
      modelString: seriesName === 'other' ? '其他模型' : seriesName,
      estimatedCostUsd:
        seriesName === 'other'
          ? otherModels.reduce((sum, modelString) => sum + (totalByModel.get(modelString)?.usd ?? 0), 0)
          : totalByModel.get(seriesName)?.usd ?? 0,
      estimatedCostCredits:
        seriesName === 'other'
          ? otherModels.reduce(
              (sum, modelString) => sum + (totalByModel.get(modelString)?.credits ?? 0),
              0,
            )
          : totalByModel.get(seriesName)?.credits ?? 0,
      cumulativeEstimatedCostUsd: dates.map(({ date }) => {
        const nextValue =
          seriesName === 'other'
            ? otherModels.reduce(
                (sum, modelString) => sum + (spendByModelByDay.get(modelString)?.get(date)?.usd ?? 0),
                0,
              )
            : spendByModelByDay.get(seriesName)?.get(date)?.usd ?? 0;
        cumulativeEstimatedCostUsd += nextValue;
        return Number(cumulativeEstimatedCostUsd.toFixed(6));
      }),
      cumulativeEstimatedCostCredits: dates.map(({ date }) => {
        const nextValue =
          seriesName === 'other'
            ? otherModels.reduce(
                (sum, modelString) =>
                  sum + (spendByModelByDay.get(modelString)?.get(date)?.credits ?? 0),
                0,
              )
            : spendByModelByDay.get(seriesName)?.get(date)?.credits ?? 0;
        cumulativeEstimatedCostCredits += nextValue;
        return Math.round(cumulativeEstimatedCostCredits);
      }),
    };
  });

  const totalEstimatedCostUsd = series.reduce((sum, row) => sum + row.estimatedCostUsd, 0);
  const totalEstimatedCostCredits = series.reduce((sum, row) => sum + row.estimatedCostCredits, 0);

  return {
    periodLabel: `近 ${dayCount} 天`,
    startDate: dates[0]?.date ?? buildDateKey(startDate),
    endDate: dates[dates.length - 1]?.date ?? buildDateKey(today),
    dates,
    series,
    totalEstimatedCostUsd,
    totalEstimatedCostCredits,
  };
}

function mapUsageRow(row: {
  id: string;
  route: string;
  source: string;
  providerId: string;
  modelId: string;
  modelString: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  createdAt: Date;
}): UsageRecordRow {
  const estimatedCostUsd = estimateOpenAITextUsageRetailCostUsd({
    providerId: row.providerId,
    modelId: row.modelId,
    modelString: row.modelString,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  });
  const estimatedCostCredits = estimateOpenAITextUsageRetailCostCredits({
    providerId: row.providerId,
    modelId: row.modelId,
    modelString: row.modelString,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
  });

  return {
    id: row.id,
    route: row.route,
    source: row.source,
    providerId: row.providerId,
    modelId: row.modelId,
    modelString: row.modelString,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    estimatedCostUsd,
    estimatedCostCredits,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function GET(request: Request) {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;

  const url = new URL(request.url);
  const pageRaw = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSizeRaw = parseInt(url.searchParams.get('pageSize') || String(DEFAULT_RECORDS_PAGE_SIZE), 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;
  const pageSize = Math.min(
    MAX_RECORDS_PAGE_SIZE,
    Math.max(1, Number.isFinite(pageSizeRaw) ? pageSizeRaw : DEFAULT_RECORDS_PAGE_SIZE),
  );

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiSuccess({
      databaseEnabled: false,
      summary: buildEmptySummary(),
      spendChart: buildSpendChart({ rows: [] }),
      modelBreakdown: [] as ModelBreakdownRow[],
      usageRecords: [] as UsageRecordRow[],
      latestRecord: null as UsageRecordRow | null,
      pagination: {
        page: 1,
        pageSize,
        totalCount: 0,
        totalPages: 1,
      },
    });
  }

  const userId = auth.userId;

  const [aggregate, modelGroups, recordsTotal, latestRow] = await Promise.all([
    prisma.lLMUsageLog.aggregate({
      where: { userId },
      _count: { id: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
      },
    }),
    prisma.lLMUsageLog.groupBy({
      by: ['modelString'],
      where: { userId },
      _count: { id: true },
      _sum: {
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
      },
    }),
    prisma.lLMUsageLog.count({ where: { userId } }),
    prisma.lLMUsageLog.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: usageRecordSelect,
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(recordsTotal / pageSize));
  const safePage = Math.min(page, totalPages);
  const skip = (safePage - 1) * pageSize;
  const spendChartStartDate = new Date();
  spendChartStartDate.setHours(0, 0, 0, 0);
  spendChartStartDate.setDate(spendChartStartDate.getDate() - (SPEND_CHART_DAYS - 1));

  const recordsPage = await prisma.lLMUsageLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip,
    take: pageSize,
    select: usageRecordSelect,
  });

  const spendChartRows = await prisma.lLMUsageLog.findMany({
    where: {
      userId,
      createdAt: {
        gte: spendChartStartDate,
      },
    },
    orderBy: { createdAt: 'asc' },
    select: {
      createdAt: true,
      providerId: true,
      modelId: true,
      modelString: true,
      inputTokens: true,
      outputTokens: true,
    },
  });

  const modelBreakdown: ModelBreakdownRow[] = modelGroups
    .map((g) => {
      const inputTokens = g._sum.inputTokens ?? 0;
      const outputTokens = g._sum.outputTokens ?? 0;
      return {
        modelString: g.modelString,
        requestCount: g._count.id,
        inputTokens,
        outputTokens,
        totalTokens: g._sum.totalTokens ?? 0,
        estimatedCostUsd: estimateOpenAITextUsageRetailCostUsd({
          modelString: g.modelString,
          inputTokens,
          outputTokens,
        }),
        estimatedCostCredits: estimateOpenAITextUsageRetailCostCredits({
          modelString: g.modelString,
          inputTokens,
          outputTokens,
        }),
      };
    })
    .sort((a, b) => {
      const costDiff = (b.estimatedCostUsd ?? 0) - (a.estimatedCostUsd ?? 0);
      if (costDiff !== 0) return costDiff;
      if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
      return b.requestCount - a.requestCount;
    });

  const estimatedCostUsd = modelBreakdown.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0);
  const estimatedCostCredits = modelBreakdown.reduce(
    (sum, row) => sum + (row.estimatedCostCredits ?? 0),
    0,
  );
  const spendChart = buildSpendChart({ rows: spendChartRows });

  return apiSuccess({
    databaseEnabled: true,
    summary: {
      totalCalls: aggregate._count.id,
      totalInputTokens: aggregate._sum.inputTokens ?? 0,
      totalOutputTokens: aggregate._sum.outputTokens ?? 0,
      totalTokens: aggregate._sum.totalTokens ?? 0,
      estimatedCostUsd,
      estimatedCostCredits,
    },
    spendChart,
    modelBreakdown,
    usageRecords: recordsPage.map(mapUsageRow),
    latestRecord: latestRow ? mapUsageRow(latestRow) : null,
    pagination: {
      page: safePage,
      pageSize,
      totalCount: recordsTotal,
      totalPages,
    },
  });
}
