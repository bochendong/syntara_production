import { NextRequest, NextResponse } from 'next/server';

import { buildNativeNotebookArchive } from '@/lib/server/native-course-sync';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

/** App 打开一本网页笔记时下载它的完整内容，存到本机后离线可读。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(
      requestId,
      503,
      'auth_not_configured',
      'Notebook storage is unavailable.',
    );
  }
  const notebookId = request.nextUrl.searchParams.get('id')?.trim();
  if (!notebookId || notebookId.length > 200) {
    return publicApiError(requestId, 400, 'invalid_request', 'id is required.');
  }
  const archive = await buildNativeNotebookArchive(prisma, principal.userId, notebookId);
  if (!archive) return publicApiError(requestId, 404, 'not_found', 'Notebook not found.');
  return publicApiSuccess(requestId, archive, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
