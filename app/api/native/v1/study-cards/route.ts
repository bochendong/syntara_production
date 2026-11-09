import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';
import {
  CardCollectionError,
  drawStudyCard,
  favoriteStudyCard,
  getStudyCardCollection,
} from '@/lib/server/study-card-collection';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  return publicApiSuccess(requestId, await getStudyCardCollection(principal.userId));
}
const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('draw'), drawRequestId: z.string().uuid() }),
  z.object({
    action: z.literal('favorite'),
    cardId: z.string().min(1).max(100),
    favorite: z.boolean(),
  }),
]);
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const body = schema.safeParse(await request.json().catch(() => null));
  if (!body.success) return publicApiError(requestId, 400, 'invalid_request', '请求无效。');
  try {
    return publicApiSuccess(
      requestId,
      body.data.action === 'draw'
        ? await drawStudyCard(principal.userId, body.data.drawRequestId)
        : await favoriteStudyCard(principal.userId, body.data.cardId, body.data.favorite),
    );
  } catch (error) {
    if (error instanceof CardCollectionError)
      return publicApiError(requestId, error.status, 'invalid_request', error.message);
    throw error;
  }
}
