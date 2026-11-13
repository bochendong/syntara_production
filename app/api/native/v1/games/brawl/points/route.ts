import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  readBrawlPracticePoints,
  transferBrawlPracticePoints,
} from '@/lib/server/brawl-practice-points';
import { SHARED_NATIVE_PLATFORM_PRINCIPAL } from '@/lib/server/native-platform-access';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

const transferSchema = z.object({
  id: z.string().uuid(),
});

async function handle(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  if (principal === SHARED_NATIVE_PLATFORM_PRINCIPAL)
    return publicApiError(requestId, 401, 'unauthorized', 'A signed-in account is required.');
  const db = getOptionalPrisma();
  if (!db)
    return publicApiError(requestId, 503, 'auth_not_configured', 'Points storage is unavailable.');
  if (request.method === 'GET') {
    const balance = await readBrawlPracticePoints(db, principal.userId);
    return publicApiSuccess(requestId, { account: principal.userId, balance });
  }
  const input = transferSchema.safeParse(await request.json().catch(() => null));
  if (!input.success)
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid point transfer.');
  const points = await transferBrawlPracticePoints(db, principal.userId, input.data.id);
  return publicApiSuccess(requestId, { points });
}

export const GET = handle;
export const POST = handle;
