import type { Prisma, CreditAccountType } from '@/lib/server/generated-prisma';
import { createLogger } from '@/lib/logger';
import { creditsFromTokenUsage } from '@/lib/utils/credits';
import {
  getUserCreditBalances as getLedgerCreditBalances,
  type ApplyCreditDeltaArgs,
  type UserCreditBalances,
} from '@/lib/server/repositories/credit-ledger-repository';
import type { DbClient } from '@/lib/server/repositories/types';
import {
  estimateOpenAIImageGenerationRetailCostUsd,
  estimateOpenAITextUsageBaseCostUsd,
  estimateOpenAITextUsageRetailCostCredits,
  estimateOpenAITextUsageRetailCostUsd,
  estimateWebSearchRetailCostUsd,
  OPENAI_RETAIL_MARKUP_MULTIPLIER,
} from '@/lib/utils/openai-pricing';
import { assertCloudUsageAllowed, recordCloudUsageCost } from '@/lib/server/cloud-usage-limits';

const log = createLogger('Credits');

interface ChargeCreditsForUsdArgs {
  userId?: string | null;
  usdCost?: number | null;
  requestedCreditsCostOverride?: number | null;
  route?: string | null;
  source?: string | null;
  descriptionPrefix: string;
  referenceType: string;
  referenceId?: string | null;
  metadata?: Prisma.InputJsonObject;
}

export async function getUserCreditBalances(
  db: DbClient,
  userId: string,
): Promise<UserCreditBalances> {
  return getLedgerCreditBalances(db, userId);
}

async function chargeCreditsForUsdCost(args: ChargeCreditsForUsdArgs): Promise<{
  requestedCreditsCost: number;
  chargedCredits: number;
  previousBalance: number;
  nextBalance: number;
} | null> {
  // Retain web-search cost accounting without creating credit transactions.
  if (args.referenceType === 'web_search') {
    await recordCloudUsageCost({
      userId: args.userId?.trim(),
      route: args.route,
      source: args.source ?? 'web-search',
      estimatedCostUsd: Number.isFinite(args.usdCost) ? Math.max(0, args.usdCost ?? 0) : 0,
      requestCount:
        typeof args.metadata?.callCount === 'number' && Number.isFinite(args.metadata.callCount)
          ? args.metadata.callCount
          : 1,
      metadata: args.metadata,
    });
  }
  return null;
}

export async function ensureUserCreditsInitialized(
  _db: DbClient,
  _userId: string,
): Promise<number> {
  return 0;
}

export async function applyCreditDelta(
  _db: DbClient,
  _args: ApplyCreditDeltaArgs,
): Promise<number> {
  throw new Error('积分系统已停用');
}

export async function assertUserHasCredits(
  userId?: string | null,
  _accountType: CreditAccountType = 'COMPUTE',
): Promise<void> {
  await assertCloudUsageAllowed(userId?.trim());
}

export async function convertCashCredits(_args: {
  userId: string;
  amount: number;
  targetAccountType: Extract<CreditAccountType, 'COMPUTE' | 'PURCHASE'>;
}): Promise<{ cashBalance: number; targetBalance: number }> {
  throw new Error('积分转换已停用');
}

export async function chargeCreditsForTokenUsage(args: {
  userId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cachedInputTokens?: number | null;
  totalTokens?: number | null;
  route?: string | null;
  source?: string | null;
  modelString?: string | null;
  notebookGenerationSessionId?: string | null;
  notebookGenerationTaskId?: string | null;
  notebookId?: string | null;
  notebookName?: string | null;
  courseId?: string | null;
  courseName?: string | null;
  sceneId?: string | null;
  sceneTitle?: string | null;
  sceneOrder?: number | null;
  sceneType?: string | null;
  operationCode?: string | null;
  chargeReason?: string | null;
  serviceLabel?: string | null;
}): Promise<void> {
  const userId = args.userId?.trim();
  if (!userId) {
    if (args.route?.startsWith('/api/generate/')) {
      log.warn('Skipped generation compute charge because request had no userId', {
        route: args.route ?? null,
        source: args.source ?? null,
        modelString: args.modelString ?? null,
        totalTokens: args.totalTokens ?? 0,
      });
    }
    return;
  }

  const estimatedBaseUsdCost = estimateOpenAITextUsageBaseCostUsd({
    providerId: args.providerId,
    modelId: args.modelId,
    modelString: args.modelString,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cachedInputTokens: args.cachedInputTokens,
  });
  const estimatedUsdCost = estimateOpenAITextUsageRetailCostUsd({
    providerId: args.providerId,
    modelId: args.modelId,
    modelString: args.modelString,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    cachedInputTokens: args.cachedInputTokens,
  });
  const requestedCreditsCost =
    estimateOpenAITextUsageRetailCostCredits({
      providerId: args.providerId,
      modelId: args.modelId,
      modelString: args.modelString,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      cachedInputTokens: args.cachedInputTokens,
    }) ?? creditsFromTokenUsage(args.totalTokens);
  if (requestedCreditsCost <= 0) {
    if (args.route?.startsWith('/api/generate/')) {
      log.info('Skipped generation compute charge because token usage was zero', {
        userId,
        route: args.route ?? null,
        source: args.source ?? null,
        totalTokens: args.totalTokens ?? 0,
      });
    }
    return;
  }

  const chargeSummary = await chargeCreditsForUsdCost({
    userId,
    usdCost: estimatedUsdCost,
    requestedCreditsCostOverride: estimatedUsdCost == null ? requestedCreditsCost : undefined,
    route: args.route,
    source: args.source,
    descriptionPrefix: 'LLM usage charge',
    referenceType: 'llm_usage',
    referenceId: args.route?.trim() || undefined,
    metadata: {
      providerId: args.providerId ?? null,
      modelId: args.modelId ?? null,
      inputTokens: args.inputTokens ?? 0,
      outputTokens: args.outputTokens ?? 0,
      cachedInputTokens: args.cachedInputTokens ?? 0,
      totalTokens: args.totalTokens ?? 0,
      route: args.route ?? null,
      source: args.source ?? null,
      modelString: args.modelString ?? null,
      notebookGenerationSessionId: args.notebookGenerationSessionId ?? null,
      notebookGenerationTaskId: args.notebookGenerationTaskId ?? null,
      notebookId: args.notebookId ?? null,
      notebookName: args.notebookName ?? null,
      courseId: args.courseId ?? null,
      courseName: args.courseName ?? null,
      sceneId: args.sceneId ?? null,
      sceneTitle: args.sceneTitle ?? null,
      sceneOrder:
        typeof args.sceneOrder === 'number' && Number.isFinite(args.sceneOrder)
          ? Math.max(0, Math.round(args.sceneOrder))
          : null,
      sceneType: args.sceneType ?? null,
      operationCode: args.operationCode ?? null,
      chargeReason: args.chargeReason ?? null,
      serviceLabel: args.serviceLabel ?? null,
      estimatedBaseUsdCost,
      retailMarkupMultiplier: estimatedUsdCost == null ? null : OPENAI_RETAIL_MARKUP_MULTIPLIER,
      pricingMode: estimatedUsdCost == null ? 'legacy-token-fallback' : 'openai-retail',
    },
  });

  if (!chargeSummary) {
    if (args.route?.startsWith('/api/generate/')) {
      log.warn('Generation compute charge resolved to zero because balance is empty', {
        userId,
        route: args.route ?? null,
        source: args.source ?? null,
        totalTokens: args.totalTokens ?? 0,
        requestedCreditsCost,
      });
    }
    return;
  }

  if (args.route?.startsWith('/api/generate/')) {
    log.info('Charged compute credits for generation usage', {
      userId,
      route: args.route ?? null,
      source: args.source ?? null,
      modelString: args.modelString ?? null,
      totalTokens: args.totalTokens ?? 0,
      requestedCreditsCost: chargeSummary.requestedCreditsCost,
      chargedCredits: chargeSummary.chargedCredits,
      previousBalance: chargeSummary.previousBalance,
      nextBalance: chargeSummary.nextBalance,
    });
  }
}

export async function chargeCreditsForImageGeneration(args: {
  userId?: string | null;
  providerId?: string | null;
  modelId?: string | null;
  route?: string | null;
  prompt?: string | null;
  notebookGenerationSessionId?: string | null;
  notebookGenerationTaskId?: string | null;
  notebookId?: string | null;
  notebookName?: string | null;
  courseId?: string | null;
  courseName?: string | null;
  sceneId?: string | null;
  sceneTitle?: string | null;
  sceneOrder?: number | null;
  sceneType?: string | null;
  operationCode?: string | null;
  chargeReason?: string | null;
  serviceLabel?: string | null;
  usage?: {
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    textInputTokens?: number | null;
    imageInputTokens?: number | null;
  } | null;
}): Promise<void> {
  const providerId = args.providerId?.trim().toLowerCase();
  if (providerId && providerId !== 'openai-image') return;

  const estimatedUsdCost = estimateOpenAIImageGenerationRetailCostUsd({
    modelId: args.modelId,
    ...args.usage,
  });
  if (estimatedUsdCost == null || estimatedUsdCost <= 0) return;

  await chargeCreditsForUsdCost({
    userId: args.userId,
    usdCost: estimatedUsdCost,
    route: args.route,
    source: 'image-generation',
    descriptionPrefix: 'Image generation charge',
    referenceType: 'image_generation',
    referenceId: args.route?.trim() || undefined,
    metadata: {
      providerId: args.providerId ?? null,
      modelId: args.modelId ?? null,
      notebookGenerationSessionId: args.notebookGenerationSessionId ?? null,
      notebookGenerationTaskId: args.notebookGenerationTaskId ?? null,
      notebookId: args.notebookId ?? null,
      notebookName: args.notebookName ?? null,
      courseId: args.courseId ?? null,
      courseName: args.courseName ?? null,
      sceneId: args.sceneId ?? null,
      sceneTitle: args.sceneTitle ?? null,
      sceneOrder:
        typeof args.sceneOrder === 'number' && Number.isFinite(args.sceneOrder)
          ? Math.max(0, Math.round(args.sceneOrder))
          : null,
      sceneType: args.sceneType ?? null,
      operationCode: args.operationCode ?? null,
      chargeReason: args.chargeReason ?? null,
      serviceLabel: args.serviceLabel ?? null,
      promptPreview: args.prompt?.trim().slice(0, 200) || null,
      inputTokens: args.usage?.inputTokens ?? 0,
      outputTokens: args.usage?.outputTokens ?? 0,
      totalTokens: args.usage?.totalTokens ?? 0,
      textInputTokens: args.usage?.textInputTokens ?? 0,
      imageInputTokens: args.usage?.imageInputTokens ?? 0,
      retailMarkupMultiplier: OPENAI_RETAIL_MARKUP_MULTIPLIER,
    },
  });
}

export async function chargeCreditsForWebSearch(args: {
  userId?: string | null;
  route?: string | null;
  query?: string | null;
  callCount?: number | null;
  source?: string | null;
  notebookGenerationSessionId?: string | null;
  notebookGenerationTaskId?: string | null;
  notebookId?: string | null;
  notebookName?: string | null;
  courseId?: string | null;
  courseName?: string | null;
  sceneId?: string | null;
  sceneTitle?: string | null;
  sceneOrder?: number | null;
  sceneType?: string | null;
  operationCode?: string | null;
  chargeReason?: string | null;
  serviceLabel?: string | null;
}): Promise<void> {
  const callCount =
    typeof args.callCount === 'number' && !Number.isNaN(args.callCount)
      ? Math.max(0, Math.round(args.callCount))
      : 1;
  if (callCount <= 0) return;

  const estimatedUsdCost = estimateWebSearchRetailCostUsd(callCount);
  await chargeCreditsForUsdCost({
    userId: args.userId,
    usdCost: estimatedUsdCost,
    route: args.route,
    source: args.source ?? 'web-search',
    descriptionPrefix: 'Web search charge',
    referenceType: 'web_search',
    referenceId: args.route?.trim() || undefined,
    metadata: {
      notebookGenerationSessionId: args.notebookGenerationSessionId ?? null,
      notebookGenerationTaskId: args.notebookGenerationTaskId ?? null,
      notebookId: args.notebookId ?? null,
      notebookName: args.notebookName ?? null,
      courseId: args.courseId ?? null,
      courseName: args.courseName ?? null,
      sceneId: args.sceneId ?? null,
      sceneTitle: args.sceneTitle ?? null,
      sceneOrder:
        typeof args.sceneOrder === 'number' && Number.isFinite(args.sceneOrder)
          ? Math.max(0, Math.round(args.sceneOrder))
          : null,
      sceneType: args.sceneType ?? null,
      operationCode: args.operationCode ?? null,
      chargeReason: args.chargeReason ?? null,
      serviceLabel: args.serviceLabel ?? null,
      queryPreview: args.query?.trim().slice(0, 200) || null,
      callCount,
      retailMarkupMultiplier: OPENAI_RETAIL_MARKUP_MULTIPLIER,
    },
  });
}
