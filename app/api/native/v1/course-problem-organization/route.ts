import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  organizeCourseProblems,
  CourseProblemOrganizationError,
} from '@/lib/server/course-problem-organization';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { nativePlatformApiAuthMode } from '@/lib/server/native-platform-access';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';
export const maxDuration = 120;
const requestSchema = z
  .object({
    mode: z.enum(['preview', 'commit']),
    data: z.unknown(),
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();

/** Only the course owner can reorganize existing public questions; no content import or grading. */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  if (nativePlatformApiAuthMode() === 'shared-test')
    return publicApiError(
      requestId,
      403,
      'unauthorized',
      'An authenticated course owner is required.',
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
    const text = await request.text();
    if (Buffer.byteLength(text, 'utf8') > 2_000_000)
      return publicApiError(requestId, 413, 'invalid_request', 'Organization exceeds 2 MB.');
    const input = requestSchema.parse(JSON.parse(text));
    return publicApiSuccess(
      requestId,
      await organizeCourseProblems(
        db,
        principal.userId,
        input.data,
        input.mode,
        input.expectedHash,
      ),
    );
  } catch (error) {
    if (error instanceof CourseProblemOrganizationError)
      return publicApiError(
        requestId,
        error.status,
        error.status === 404
          ? 'not_found'
          : error.status === 409
            ? 'idempotency_conflict'
            : 'invalid_request',
        error.message,
      );
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return publicApiError(requestId, 400, 'invalid_request', 'Invalid course organization.');
    if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034')
      return publicApiError(
        requestId,
        409,
        'idempotency_conflict',
        'Concurrent course edit; review a fresh preview.',
      );
    return publicApiError(
      requestId,
      500,
      'internal_error',
      'Organization failed; inspect current metadata before retrying.',
    );
  }
}
