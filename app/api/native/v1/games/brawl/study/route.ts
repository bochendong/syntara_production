import { NextRequest, NextResponse } from 'next/server';

import { brawlStudyPrompts, readBrawlStudy } from '@/lib/server/brawl-study';
import { SHARED_NATIVE_PLATFORM_PRINCIPAL } from '@/lib/server/native-platform-access';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

/** App 用来决定要不要提示「去游戏里领」：连续学习天数、没领的限定奖励、今天的免费单抽、待转入的做题积分。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  if (principal === SHARED_NATIVE_PLATFORM_PRINCIPAL)
    return publicApiError(requestId, 401, 'unauthorized', 'A signed-in account is required.');
  const db = getOptionalPrisma();
  if (!db)
    return publicApiError(requestId, 503, 'auth_not_configured', 'Game storage is unavailable.');
  const userId = principal.userId;
  try {
    const account = await db.user.findUnique({
      where: { id: userId },
      select: { role: true, brawlPracticePoints: true },
    });
    if (!account || account.role === 'TEACHER' || account.role === 'ADMIN')
      return publicApiError(requestId, 403, 'unauthorized', 'Study rewards are for students.');
    const [study, save] = await Promise.all([
      readBrawlStudy(db, userId, request.nextUrl.searchParams.get('timeZone')),
      db.brawlCloudSave.findUnique({ where: { userId }, select: { data: true } }),
    ]);
    const data = save?.data && typeof save.data === 'object' ? save.data : null;
    return publicApiSuccess(requestId, {
      day: study.day,
      streak: study.streak,
      best: study.best,
      pendingPoints: account.brawlPracticePoints,
      ...brawlStudyPrompts(study, data as Parameters<typeof brawlStudyPrompts>[1]),
    });
  } catch (error) {
    console.error('[brawl-study] request failed', error);
    return publicApiError(requestId, 500, 'internal_error', 'Study rewards are unavailable.');
  }
}
