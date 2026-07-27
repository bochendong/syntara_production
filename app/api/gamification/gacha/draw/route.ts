import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireUserId } from '@/lib/server/api-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  buildGamificationDisabledSummary,
  drawGamificationGacha,
  logGamificationError,
} from '@/lib/server/gamification';
import type { GamificationGachaBannerId } from '@/lib/types/gamification';

const bodySchema = z.object({
  bannerId: z.enum(['avatar', 'live2d']),
  drawCount: z.union([z.literal(1), z.literal(10)]),
});

export async function POST(request: Request) {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;

  let body: { bannerId: GamificationGachaBannerId; drawCount: 1 | 10 };
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    return apiError('INVALID_REQUEST', 400, error instanceof Error ? error.message : '请求体无效');
  }

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiSuccess({
      success: true,
      databaseEnabled: false,
      bannerId: body.bannerId,
      drawCount: body.drawCount,
      cost: 0,
      remainingPurchaseBalance: 0,
      rewards: [],
      summary: buildGamificationDisabledSummary(),
    });
  }

  try {
    const result = await prisma.$transaction((tx) =>
      drawGamificationGacha(tx, auth.userId, body.bannerId, body.drawCount),
    );
    return apiSuccess({ ...result });
  } catch (error) {
    logGamificationError('Failed to draw gacha', error);
    return apiError('INVALID_REQUEST', 400, error instanceof Error ? error.message : '抽卡失败');
  }
}
