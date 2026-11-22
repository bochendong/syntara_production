import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { resolveAdminConsoleViewer } from '@/lib/server/admin-console';
import {
  CourseProblemRevisionConflict,
  reviseCourseProblems,
} from '@/lib/server/course-problem-revisions';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: NextRequest) {
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
    const body = await request.text();
    if (Buffer.byteLength(body, 'utf8') > 2_000_000)
      return publicApiError(requestId, 413, 'invalid_request', 'Payload exceeds 2 MB.');
    return publicApiSuccess(requestId, await reviseCourseProblems(db, courseId, JSON.parse(body)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof CourseProblemRevisionConflict)
      return publicApiError(requestId, 409, 'idempotency_conflict', error.message);
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return publicApiError(requestId, 400, 'invalid_request', 'Invalid question revision.');
    throw error;
  }
}
