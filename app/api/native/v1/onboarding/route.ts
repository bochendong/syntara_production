import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getOnboardingState, ONBOARDING_STEPS, updateOnboarding } from '@/lib/server/onboarding';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  getSpeedupPhoneState,
  parsePhoneLast4,
  saveSpeedupPhoneLast4,
} from '@/lib/server/speedup-phone';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

/** 新手引导进度：存在账号上，网页、电脑、iPad、手机看到的是同一步。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Onboarding is unavailable.');
  }
  // ?part=speedup-phone：学生登录后的 Speedup 手机尾号弹窗要不要出现。
  if (request.nextUrl.searchParams.get('part') === 'speedup-phone') {
    return publicApiSuccess(
      requestId,
      { speedupPhone: await getSpeedupPhoneState(prisma, principal.userId) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  return publicApiSuccess(
    requestId,
    { onboarding: await getOnboardingState(prisma, principal.userId) },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete'), step: z.enum(ONBOARDING_STEPS) }),
  z.object({ action: z.literal('skip') }),
  z.object({ action: z.literal('finish') }),
  z.object({ action: z.literal('restart') }),
]);

/** complete：做成了一步；skip：跳过整个引导；restart：从「我的」里重新看一遍。 */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Onboarding is unavailable.');
  }
  const body = await request.json().catch(() => null);
  if (body && typeof body === 'object' && 'action' in body && body.action === 'speedup-phone') {
    const last4 = parsePhoneLast4((body as { last4?: unknown }).last4);
    if (!last4) return publicApiError(requestId, 400, 'invalid_request', '请输入 4 位数字。');
    return publicApiSuccess(requestId, {
      speedupPhone: await saveSpeedupPhoneLast4(prisma, principal.userId, last4),
    });
  }
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid onboarding action.');
  }
  return publicApiSuccess(requestId, {
    onboarding: await updateOnboarding(prisma, principal.userId, parsed.data),
  });
}
