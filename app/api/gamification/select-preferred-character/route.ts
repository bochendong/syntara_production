import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireUserId } from '@/lib/server/api-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  buildGamificationDisabledSummary,
  logGamificationError,
  selectPreferredGamificationCharacter,
} from '@/lib/server/gamification';

const bodySchema = z.object({
  characterId: z.string().trim().min(1),
});

export async function POST(request: Request) {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;

  let body: { characterId: string };
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    return apiError('INVALID_REQUEST', 400, error instanceof Error ? error.message : '请求体无效');
  }

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiSuccess({ ...buildGamificationDisabledSummary() });
  }

  try {
    const summary = await prisma.$transaction((tx) =>
      selectPreferredGamificationCharacter(tx, auth.userId, body.characterId),
    );
    return apiSuccess({ ...summary });
  } catch (error) {
    logGamificationError('Failed to select preferred character', error);
    return apiError('INVALID_REQUEST', 400, error instanceof Error ? error.message : '选择签到角色失败');
  }
}
