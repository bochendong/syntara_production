import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  getNativeStoreCourseDetail,
  joinNativeStoreCourse,
  listNativeStoreCourses,
  markNativeCourseSeen,
} from '@/lib/server/native-store';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

/** App 商城：机构课程列表，和网页 /store/courses 一致。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Store is unavailable.');
  }
  // ?courseId= 返回一门课的详情（章节 + 评价）；不带参数返回整个商城。
  const courseId = request.nextUrl.searchParams.get('courseId')?.trim();
  if (courseId) {
    const course = await getNativeStoreCourseDetail(prisma, principal.userId, courseId);
    if (!course) return publicApiError(requestId, 404, 'not_found', '课程不存在或已下架。');
    return publicApiSuccess(
      requestId,
      { course },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  const courses = await listNativeStoreCourses(prisma, principal.userId);
  return publicApiSuccess(
    requestId,
    { courses },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

const actionSchema = z.object({
  courseId: z.string().trim().min(1).max(200),
  action: z.enum(['join', 'seen']),
});

/** join：从商城加入课程；seen：打开过加入的课程，熄灭「有更新」。 */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Store is unavailable.');
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid store action.');
  }
  const { courseId, action } = parsed.data;
  if (action === 'seen') {
    return publicApiSuccess(requestId, {
      courseId,
      seen: await markNativeCourseSeen(prisma, principal.userId, courseId),
    });
  }
  const joined = await joinNativeStoreCourse(prisma, principal.userId, courseId);
  if (!joined) return publicApiError(requestId, 404, 'not_found', '课程不存在或已下架。');
  return publicApiSuccess(requestId, joined, { status: joined.created ? 201 : 200 });
}
