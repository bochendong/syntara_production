import { NextRequest, NextResponse } from 'next/server';

import {
  nativeProblemAttemptUploadSchema,
  readNativeProblems,
  saveNativeProblemAttempts,
} from '@/lib/server/native-problem-sync';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

/** App 拉取网页题库：since 之后改过的题、当前全部题目 id，以及这个账号的做题进度。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
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
  const sinceParam = Number(request.nextUrl.searchParams.get('since'));
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : null;
  const data = await readNativeProblems(prisma, principal.userId, courseId, since);
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
