import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { uploadNativeMaterial } from '@/lib/server/native-materials';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { nativePlatformApiAuthMode } from '@/lib/server/native-platform-access';
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
  scope: z.literal('shared').optional(),
  mode: z.enum(['preview', 'commit']).optional(),
  expectedHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  language: z.enum(['zh-CN', 'en-US']).optional(),
});

/** App 资料页上传的笔记 / 题目写进账号，网页和其他设备同步后都能看到。 */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(
      requestId,
      503,
      'auth_not_configured',
      'Material storage is unavailable.',
    );
  }
  const parsed = uploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid material upload.');
  }
  if (
    (parsed.data.mode && !parsed.data.scope) ||
    (parsed.data.scope && parsed.data.kind !== 'notes')
  )
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Shared imports require reviewed Markdown notes.',
    );
  if (parsed.data.scope && nativePlatformApiAuthMode() === 'shared-test')
    return publicApiError(
      requestId,
      403,
      'unauthorized',
      'Authenticated shared import access is required.',
    );
  const result = await uploadNativeMaterial(prisma, principal.userId, parsed.data, {
    keyId: principal.keyId,
  });
  if (result.status === 'not_found') {
    return publicApiError(requestId, 404, 'not_found', result.message);
  }
  if (result.status === 'forbidden') {
    return publicApiError(requestId, 403, 'invalid_request', result.message);
  }
  if (result.status === 'conflict') {
    return publicApiError(requestId, 409, 'invalid_request', result.message);
  }
  return publicApiSuccess(requestId, result, { status: result.status === 'preview' ? 200 : 201 });
}
