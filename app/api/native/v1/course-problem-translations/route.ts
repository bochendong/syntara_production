import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveAdminConsoleViewer } from '@/lib/server/admin-console';
import {
  ProblemTranslationConflict,
  readCourseProblemTranslations,
  updateCourseProblemTranslations,
} from '@/lib/server/course-problem-translation-updates';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';
export const maxDuration = 120;

async function handle(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const db = getOptionalPrisma();
  if (!db) return publicApiError(requestId, 503, 'auth_not_configured', 'Storage unavailable.');
  if (!(await resolveAdminConsoleViewer(db, principal.userId)))
    return publicApiError(requestId, 403, 'unauthorized', 'Administrator access is required.');
  const courseId = request.nextUrl.searchParams.get('courseId')?.trim();
  if (!courseId || courseId.length > 200)
    return publicApiError(requestId, 400, 'invalid_request', 'courseId is required.');
  try {
    const result =
      request.method === 'GET'
        ? await readCourseProblemTranslations(db, courseId)
        : await (async () => {
            const body = await request.text();
            if (Buffer.byteLength(body, 'utf8') > 2_000_000)
              return publicApiError(requestId, 413, 'invalid_request', 'Payload exceeds 2 MB.');
            return updateCourseProblemTranslations(db, courseId, JSON.parse(body));
          })();
    if (result instanceof NextResponse) return result;
    return publicApiSuccess(requestId, result, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof ProblemTranslationConflict)
      return publicApiError(requestId, 409, 'idempotency_conflict', error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return publicApiError(requestId, 400, 'invalid_request', 'Invalid translation update.');
    throw error;
  }
}

export const GET = handle;
export const POST = handle;
