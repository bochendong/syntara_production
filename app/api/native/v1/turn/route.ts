import { NextRequest, NextResponse } from 'next/server';

import {
  nativeTeachingTurnRequestSchema,
  runNativeTeachingTurn,
} from '@/features/native-api/server/teaching-turn';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';
import { withRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';
export const maxDuration = 180;
const MAX_NATIVE_TURN_BODY_BYTES = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_NATIVE_TURN_BODY_BYTES) {
    return publicApiError(
      requestId,
      413,
      'invalid_request',
      'Native teaching-turn context exceeds the 2 MB request limit.',
    );
  }

  const parsed = nativeTeachingTurnRequestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Invalid native teaching-turn request.',
      parsed.error.flatten(),
    );
  }

  try {
    const result = await withRequestContext(
      {
        userId: principal.userId,
        route: '/api/native/v1/turn',
        operationCode: 'native_teaching_turn',
        chargeReason: '原生端教学回合',
      },
      () => runNativeTeachingTurn(request, parsed.data),
    );
    return publicApiSuccess(requestId, result);
  } catch (error) {
    return publicApiError(
      requestId,
      500,
      'generation_failed',
      error instanceof Error ? error.message : 'Native teaching turn failed.',
    );
  }
}
