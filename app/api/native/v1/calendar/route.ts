import { NextRequest, NextResponse } from 'next/server';
import {
  nativeCalendarMutationSchema,
  syncNativeCalendar,
} from '@/lib/server/native-calendar-sync';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { readBoundedCalendarJson } from '@/features/learning-calendar/server/http';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma)
    return publicApiError(
      requestId,
      503,
      'auth_not_configured',
      'Calendar storage is unavailable.',
    );
  const body = await readBoundedCalendarJson(request);
  if (!body.ok) return body.response;
  const parsed = nativeCalendarMutationSchema.safeParse(body.value);
  if (!parsed.success)
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid calendar sync.');
  try {
    const result = await syncNativeCalendar(prisma, principal.userId, parsed.data);
    if (!result) return publicApiError(requestId, 404, 'not_found', 'Course not found.');
    return publicApiSuccess(requestId, result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (cause) {
    console.warn('[native-calendar] sync failed', cause instanceof Error ? cause.name : 'unknown');
    return publicApiError(
      requestId,
      409,
      'request_in_progress',
      '日历同步暂时未完成，将自动重试。',
    );
  }
}
