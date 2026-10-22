import { NextRequest, NextResponse } from 'next/server';

import { normalizeCourseDisplay } from '@/lib/course-space/course-display-name';
import { pickStableCourseAvatarUrl } from '@/lib/constants/course-avatars';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';
import { listAccessibleCoursesForUser } from '@/lib/server/repositories/course-repository';
import { nativeStagingCourseForUser } from '@/lib/server/native-staging-course';

export const runtime = 'nodejs';

/** App 的课程列表与网页一致：账号拥有、报名或购买的课程。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Course storage is unavailable.');
  }
  const user = await prisma.user.findUnique({
    where: { id: principal.userId },
    select: { email: true },
  });
  let courses = await listAccessibleCoursesForUser(prisma, principal.userId, user?.email);
  const fixture =
    courses.length === 0 ? nativeStagingCourseForUser(process.env, principal.userId) : null;
  if (fixture) {
    await prisma.course.upsert({ where: { id: fixture.id }, create: fixture, update: {} });
    courses = await listAccessibleCoursesForUser(prisma, principal.userId, user?.email);
  }
  return publicApiSuccess(requestId, {
    courses: courses.map((course) => {
      const display = normalizeCourseDisplay(course);
      return {
        id: course.id,
        name: display.name,
        courseCode: display.courseCode ?? null,
        description: course.description ?? null,
        language: course.language,
        avatarUrl: course.avatarUrl?.trim() || pickStableCourseAvatarUrl(course.id),
        accessRole: course.accessRole,
        updatedAt: course.updatedAt.toISOString(),
      };
    }),
  });
}
