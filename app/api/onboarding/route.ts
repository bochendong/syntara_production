import { NextResponse } from 'next/server';
import { z } from 'zod';

import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { getOnboardingState, ONBOARDING_STEPS, updateOnboarding } from '@/lib/server/onboarding';
import { prisma } from '@/lib/server/prisma';

/** 网页的新手引导进度；和 App 的 /api/native/v1/onboarding 是同一份。 */
export async function GET() {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    if ('previewedByAdmin' in auth) {
      return NextResponse.json({ onboarding: { status: 'done', completed: [], next: null } });
    }
    return NextResponse.json(
      { onboarding: await getOnboardingState(prisma, auth.userId) },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('complete'), step: z.enum(ONBOARDING_STEPS) }),
  z.object({ action: z.literal('skip') }),
  z.object({ action: z.literal('finish') }),
  z.object({ action: z.literal('restart') }),
]);

export async function POST(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    if ('previewedByAdmin' in auth) {
      return NextResponse.json({ error: '预览学生时不能修改引导进度。' }, { status: 403 });
    }
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid onboarding action.' }, { status: 400 });
    }
    return NextResponse.json({
      onboarding: await updateOnboarding(prisma, auth.userId, parsed.data),
    });
  });
}
