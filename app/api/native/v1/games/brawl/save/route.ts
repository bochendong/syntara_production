import { NextRequest, NextResponse } from 'next/server';

import {
  brawlCloudActionSchema,
  openBrawlSave,
  writeBrawlSave,
} from '@/lib/server/brawl-cloud-save';
import { SHARED_NATIVE_PLATFORM_PRINCIPAL } from '@/lib/server/native-platform-access';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
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
  if (principal === SHARED_NATIVE_PLATFORM_PRINCIPAL)
    return publicApiError(requestId, 401, 'unauthorized', 'A signed-in account is required.');
  const db = getOptionalPrisma();
  if (!db)
    return publicApiError(
      requestId,
      503,
      'auth_not_configured',
      'Game save storage is unavailable.',
    );
  const body = await request.text();
  if (body.length > 65_536)
    return publicApiError(requestId, 400, 'invalid_request', 'Game save exceeds the size limit.');
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid game save.');
  }
  const input = brawlCloudActionSchema.safeParse(raw);
  if (!input.success)
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid game save.');
  const userId = principal.userId;
  if (input.data.account !== userId)
    return publicApiError(requestId, 403, 'unauthorized', 'The game account has changed.');
  try {
    const data =
      input.data.action === 'open'
        ? await openBrawlSave(db, userId, input.data)
        : await writeBrawlSave(db, userId, input.data);
    return publicApiSuccess(requestId, data);
  } catch (error) {
    console.error('[brawl-save] request failed', error);
    return publicApiError(requestId, 500, 'internal_error', 'Game save is unavailable.');
  }
}
