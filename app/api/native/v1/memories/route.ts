import { NextRequest, NextResponse } from 'next/server';

import {
  nativeMemorySyncSchema,
  readNativeMemories,
  syncNativeMemories,
} from '@/lib/server/native-memory-store';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

const NO_STORE = { headers: { 'Cache-Control': 'private, no-store' } };

/** App 自己写的学习记忆（网页看不到），手机 / iPad / 电脑三端互通。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Memory storage is unavailable.');
  }
  const courseId = request.nextUrl.searchParams.get('courseId')?.trim();
  if (!courseId || courseId.length > 200) {
    return publicApiError(requestId, 400, 'invalid_request', 'courseId is required.');
  }
  const data = await readNativeMemories(prisma, principal.userId, courseId);
  if (!data) return publicApiError(requestId, 404, 'not_found', 'Course not found.');
  return publicApiSuccess(requestId, { courseId, ...data }, NO_STORE);
}

/** 推上本机的记忆和复习时间，合并后返回服务器上的完整版本。 */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Memory storage is unavailable.');
  }
  const parsed = nativeMemorySyncSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Invalid memory sync.',
      parsed.error.flatten(),
    );
  }
  const data = await syncNativeMemories(prisma, principal.userId, parsed.data);
  if (!data) return publicApiError(requestId, 404, 'not_found', 'Course not found.');
  return publicApiSuccess(requestId, { courseId: parsed.data.courseId, ...data }, NO_STORE);
}
