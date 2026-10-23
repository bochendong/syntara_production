import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { uploadNativeMaterial } from '@/lib/server/native-materials';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

const uploadSchema = z.object({
  courseId: z.string().trim().min(1).max(200),
  kind: z.enum(['notes', 'problems']),
  clientId: z.string().uuid(),
  name: z.string().max(400),
  text: z.string().min(1).max(1_000_000),
});

/** App 资料页上传的笔记 / 题目写进账号，网页和其他设备同步后都能看到。 */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Material storage is unavailable.');
  }
  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid material upload.');
  }
  const result = await uploadNativeMaterial(prisma, principal.userId, parsed.data);
  if (result.status === 'not_found') {
    return publicApiError(requestId, 404, 'not_found', result.message);
  }
  if (result.status === 'forbidden') {
    return publicApiError(requestId, 403, 'invalid_request', result.message);
  }
  if (result.status === 'conflict') {
    return publicApiError(requestId, 409, 'invalid_request', result.message);
  }
  return publicApiSuccess(requestId, result, { status: 201 });
}
