import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { codePreflightSchema, validateCodeQuestion } from '@/lib/server/course-code-preflight';
import { getBackendImportCourseContext } from '@/lib/server/course-import-catalog';
import { nativePlatformApiAuthMode } from '@/lib/server/native-platform-access';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';
export const maxDuration = 300;
let inFlight = 0;
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  if (process.env.SYNTARA_APP_ENV !== 'staging')
    return publicApiError(requestId, 404, 'not_found', 'Not found.');
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  if (nativePlatformApiAuthMode() === 'shared-test' || !principal.keyId)
    return publicApiError(
      requestId,
      403,
      'unauthorized',
      'A device-scoped course import authority is required.',
    );
  const db = getOptionalPrisma();
  if (!db)
    return publicApiError(
      requestId,
      503,
      'auth_not_configured',
      'Question storage is unavailable.',
    );
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 250_000)
      return publicApiError(requestId, 413, 'invalid_request', 'Preflight exceeds 250 KB.');
    const input = codePreflightSchema.parse(JSON.parse(raw));
    const access = await getBackendImportCourseContext(db, principal, input.courseId);
    if (!access)
      return publicApiError(requestId, 403, 'unauthorized', 'Course import authority is required.');
    if (inFlight >= 2)
      return publicApiError(requestId, 429, 'invalid_request', 'Preflight is busy; retry later.');
    inFlight++;
    try {
      const result = await validateCodeQuestion(input, {
        userId: principal.userId,
        keyId: principal.keyId,
      });
      return publicApiSuccess(requestId, result, {
        headers: { 'Cache-Control': 'private, no-store' },
      });
    } finally {
      inFlight--;
    }
  } catch (e) {
    if (e instanceof z.ZodError || e instanceof SyntaxError)
      return publicApiError(requestId, 400, 'invalid_request', 'Invalid preflight request.');
    return publicApiError(requestId, 500, 'internal_error', 'Code preflight failed.');
  }
}
