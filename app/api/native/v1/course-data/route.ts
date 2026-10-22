import { NextRequest, NextResponse } from 'next/server';

import { buildNativeCourseData, listNativeMiniLecturePage } from '@/lib/server/native-course-sync';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

/** App 打开课程时拉取网页上的笔记列表、学习记忆、日历和课堂清单。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Course storage is unavailable.');
  }
  const courseId = request.nextUrl.searchParams.get('courseId')?.trim();
  if (!courseId || courseId.length > 200) {
    return publicApiError(requestId, 400, 'invalid_request', 'courseId is required.');
  }
  const searchParams = request.nextUrl.searchParams;
  // 课堂页滚到底时只取下一页课堂清单，不用整份课程数据。
  if (searchParams.get('section') === 'mini-lectures') {
    const page = await listNativeMiniLecturePage(prisma, principal.userId, courseId, {
      cursor: searchParams.get('cursor')?.trim() || null,
      limit: Number(searchParams.get('limit')) || undefined,
    });
    if (!page) return publicApiError(requestId, 400, 'invalid_request', 'Invalid cursor.');
    return publicApiSuccess(requestId, page, { headers: { 'Cache-Control': 'private, no-store' } });
  }
  const data = await buildNativeCourseData(prisma, principal.userId, courseId);
  if (!data) return publicApiError(requestId, 404, 'not_found', 'Course not found.');
  return publicApiSuccess(requestId, data, { headers: { 'Cache-Control': 'private, no-store' } });
}
