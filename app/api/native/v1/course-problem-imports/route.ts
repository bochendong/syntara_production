import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { COURSE_PROBLEM_IMPORT_GUIDE } from '@/lib/course-problem-import-guide';
import {
  CourseProblemImportError,
  createStructuredCourseProblemImportService,
} from '@/lib/server/course-problem-import';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { nativePlatformApiAuthMode } from '@/lib/server/native-platform-access';
import {
  listBackendImportCourses,
  getBackendImportCourseContext,
} from '@/lib/server/course-import-catalog';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';
export const maxDuration = 300;

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

/** Prepared structured questions only; never performs AI extraction or accepts an owner/operator override. */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  if (nativePlatformApiAuthMode() === 'shared-test')
    return publicApiError(
      requestId,
      403,
      'invalid_request',
      'An authenticated course owner is required.',
    );
  if (!getOptionalPrisma())
    return publicApiError(
      requestId,
      503,
      'auth_not_configured',
      'Question storage is unavailable.',
    );
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 2_000_000)
      return publicApiError(requestId, 413, 'invalid_request', 'Import exceeds 2 MB.');
    const input = requestSchema.parse(JSON.parse(raw));
    const service = createStructuredCourseProblemImportService();
    const actor = { userId: principal.userId, keyId: principal.keyId };
    const result =
      input.mode === 'preview'
        ? await service.preview(input.data, actor)
        : await service.commit(input.data, actor, input.expectedHash || '');
    return publicApiSuccess(requestId, result);
  } catch (error) {
    if (error instanceof CourseProblemImportError)
      return publicApiError(
        requestId,
        error.status,
        error.status === 403
          ? 'unauthorized'
          : error.status === 404
            ? 'not_found'
            : error.status === 409
              ? 'idempotency_conflict'
              : 'invalid_request',
        error.message,
      );
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return publicApiError(
        requestId,
        400,
        'invalid_request',
        'Invalid structured question import.',
      );
    return publicApiError(
      requestId,
      500,
      'internal_error',
      'Question import failed; inspect the operation before retrying.',
    );
  }
}

/** Backend discovery only; ordinary enrollment does not reveal the full course catalog. */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  if (nativePlatformApiAuthMode() === 'shared-test')
    return publicApiError(
      requestId,
      403,
      'unauthorized',
      'Authenticated backend import access is required.',
    );
  const db = getOptionalPrisma();
  if (!db)
    return publicApiError(requestId, 503, 'auth_not_configured', 'Course storage is unavailable.');
  try {
    const input = z
      .object({
        cursor: z.string().max(200).optional(),
        courseId: z.string().trim().min(1).max(200).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(Object.fromEntries(request.nextUrl.searchParams));
    const result = input.courseId
      ? await getBackendImportCourseContext(db, principal, input.courseId)
      : await listBackendImportCourses(db, principal, input);
    if (!result)
      return publicApiError(
        requestId,
        403,
        'unauthorized',
        input.courseId
          ? 'This course is unavailable or no matching content import authority exists.'
          : 'A wildcard import grant or existing administrator is required.',
      );
    return publicApiSuccess(requestId, { ...result, importGuide: COURSE_PROBLEM_IMPORT_GUIDE });
  } catch (error) {
    if (error instanceof z.ZodError)
      return publicApiError(requestId, 400, 'invalid_request', 'Invalid course catalog query.');
    return publicApiError(requestId, 500, 'internal_error', 'Course catalog is unavailable.');
  }
}
