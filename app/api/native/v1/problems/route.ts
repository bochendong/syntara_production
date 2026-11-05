import { CourseAdmissionError } from '@/lib/server/course-admissions';
import { readManagedCourseProblems } from '@/lib/server/course-content-drafts';
import { NextRequest, NextResponse } from 'next/server';

import {
  nativeProblemAttemptUploadSchema,
  readNativeProblems,
  saveNativeProblemAttempts,
} from '@/lib/server/native-problem-sync';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  parseAttemptCursor,
  readNativeProblemAttempts,
} from '@/lib/server/native-problem-attempt-history';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

/** managed=1 returns a complete shared-only workspace snapshot, including draft undo; since applies only to learning sync.
 * App 拉取网页题库：since 之后改过的题、当前全部题目 id，以及这个账号的做题进度。 */
async function getContent(request: NextRequest, requestId: string) {
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Problem storage is unavailable.');
  }
  const courseId = request.nextUrl.searchParams.get('courseId')?.trim();
  if (!courseId || courseId.length > 200) {
    return publicApiError(requestId, 400, 'invalid_request', 'courseId is required.');
  }
  if (request.nextUrl.searchParams.get('attempts') === '1') {
    const problemId = request.nextUrl.searchParams.get('problemId')?.trim();
    if (!problemId || problemId.length > 200)
      return publicApiError(requestId, 400, 'invalid_request', 'problemId is required.');
    let before;
    try {
      before = parseAttemptCursor(request.nextUrl.searchParams.get('before'));
    } catch {
      return publicApiError(requestId, 400, 'invalid_request', 'Invalid attempt cursor.');
    }
    const data = await readNativeProblemAttempts(
      prisma,
      principal.userId,
      courseId,
      problemId,
      before,
    );
    return data
      ? publicApiSuccess(requestId, data, NO_STORE)
      : publicApiError(requestId, 404, 'not_found', 'Problem not found.');
  }
  const sinceParam = Number(request.nextUrl.searchParams.get('since'));
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : null;
  const data =
    request.nextUrl.searchParams.get('managed') === '1'
      ? await readManagedCourseProblems(prisma, principal.userId, courseId)
      : await readNativeProblems(prisma, principal.userId, courseId, since);
  if (!data) return publicApiError(requestId, 404, 'not_found', 'Course not found.');
  return publicApiSuccess(requestId, data, NO_STORE);
}

/** App 上的作答传到网页题库；按作答 id 去重，可以放心重传。 */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Problem storage is unavailable.');
  }
  const parsed = nativeProblemAttemptUploadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Invalid problem attempt upload.',
      parsed.error.flatten(),
    );
  }
  const data = await saveNativeProblemAttempts(prisma, principal.userId, parsed.data);
  if (!data) return publicApiError(requestId, 404, 'not_found', 'Course not found.');
  return publicApiSuccess(requestId, { courseId: parsed.data.courseId, ...data }, NO_STORE);
}

export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  try {
    return await getContent(request, requestId);
  } catch (error) {
    if (error instanceof CourseAdmissionError)
      return publicApiError(
        requestId,
        error.status,
        error.status === 403
          ? 'unauthorized'
          : error.status === 404
            ? 'not_found'
            : 'invalid_request',
        error.message,
      );
    throw error;
  }
}
