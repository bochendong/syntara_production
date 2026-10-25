import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { formatCourseUpdateSummary } from '@/lib/course-space/course-update-summary';

import {
  getNativeStoreCourseDetail,
  joinNativeStoreCourse,
  listNativeStoreCourses,
  markNativeCourseSeen,
} from '@/lib/server/native-store';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import {
  copyCourseContentToMine,
  CourseContentNotFoundError,
  courseLayersForUser,
  releaseCourseVersion,
  removeCourseContentForUser,
  restoreCourseContentForUser,
} from '@/lib/server/store-course-layers';
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
  // ?layersOf= 返回加入的课里自己隐藏的内容、「新」笔记、自己的笔记和更新摘要，给课程页用。
  const layersOf = request.nextUrl.searchParams.get('layersOf')?.trim();
  if (layersOf) {
    if (!(await findCourseAccessRole(prisma, principal.userId, layersOf)))
      return publicApiError(requestId, 404, 'not_found', '课程不存在或没有权限。');
    return publicApiSuccess(
      requestId,
      await courseLayersForUser(prisma, principal.userId, layersOf),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
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

const actionSchema = z.union([
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.enum(['join', 'seen', 'release']),
  }),
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.enum(['remove', 'restore', 'copy']),
    targetType: z.enum(['notebook', 'problem']),
    targetId: z.string().trim().min(1).max(200),
  }),
]);

/**
 * join：从商城加入课程；seen：打开过加入的课程，熄灭「有更新」。
 * remove / restore / copy：加入的课里删除（公有内容只对自己隐藏）、恢复隐藏、复制到自己的私有层。
 */
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
  if ('targetType' in parsed.data) {
    const target = {
      userId: principal.userId,
      courseId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
    };
    try {
      if (parsed.data.action === 'restore') {
        await restoreCourseContentForUser(prisma, target);
        return publicApiSuccess(requestId, { restored: true });
      }
      if (parsed.data.action === 'copy') {
        return publicApiSuccess(requestId, await copyCourseContentToMine(prisma, target), {
          status: 201,
        });
      }
      return publicApiSuccess(requestId, {
        result: await removeCourseContentForUser(prisma, target),
      });
    } catch (error) {
      if (error instanceof CourseContentNotFoundError)
        return publicApiError(requestId, 404, 'not_found', error.message);
      throw error;
    }
  }
  if (action === 'release') {
    const course = await prisma.course.findFirst({
      where: { id: courseId, ownerId: principal.userId, organizationId: { not: null } },
      select: { id: true },
    });
    if (!course)
      return publicApiError(requestId, 403, 'not_found', '只有机构课程的发布者可以发布新版。');
    const release = await releaseCourseVersion(prisma, courseId);
    return publicApiSuccess(requestId, { ...release, text: formatCourseUpdateSummary(release) });
  }
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
