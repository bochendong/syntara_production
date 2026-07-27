import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireUserId } from '@/lib/server/api-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  buildGamificationDisabledEvent,
  claimGamificationReward,
  logGamificationError,
} from '@/lib/server/gamification';
import type { GamificationClaimKind } from '@/lib/types/gamification';

const bodySchema = z.object({
  kind: z.enum(['daily_sign_in', 'daily_tasks', 'streak_bonus']),
});

export async function POST(request: Request) {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;

  let body: { kind: GamificationClaimKind };
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    return apiError('INVALID_REQUEST', 400, error instanceof Error ? error.message : '请求体无效');
  }

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiSuccess({ ...buildGamificationDisabledEvent('lesson_milestone_completed') });
  }

  try {
    const result = await prisma.$transaction((tx) =>
      claimGamificationReward(tx, auth.userId, body.kind),
    );
    return apiSuccess({ ...result });
  } catch (error) {
    logGamificationError('Failed to claim gamification reward', error);
    return apiError('INVALID_REQUEST', 400, error instanceof Error ? error.message : '领取奖励失败');
  }
}
