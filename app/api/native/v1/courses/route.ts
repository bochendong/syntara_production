import { z } from 'zod';
import { nativeBrowserEnabled } from '@/lib/server/native-browser-auth';
import { createOwnedCourse } from '@/lib/server/repositories/course-repository';
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
import { visibleNativeCourses } from '@/lib/server/native-staging-course';
import { loadNativeCourseStoreMeta } from '@/lib/server/native-store';

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
  const courses = visibleNativeCourses(
    process.env,
    principal.userId,
    await listAccessibleCoursesForUser(prisma, principal.userId, user?.email),
  );
  const storeMeta = await loadNativeCourseStoreMeta(
    prisma,
    principal.userId,
    courses.map((course) => course.id),
  ).catch(() => new Map<string, { organizationName: string | null; hasUpdate: boolean }>());
  return publicApiSuccess(requestId, {
    courses: courses.map((course) => {
      const display = normalizeCourseDisplay(course);
      const meta = storeMeta.get(course.id);
      return {
        id: course.id,
        name: display.name,
        courseCode: display.courseCode ?? null,
        description: course.description ?? null,
        language: course.language,
        avatarUrl: course.avatarUrl?.trim() || pickStableCourseAvatarUrl(course.id),
        accessRole: course.accessRole,
        organizationName: meta?.organizationName ?? null,
        hasUpdate: meta?.hasUpdate ?? false,
        updatedAt: course.updatedAt.toISOString(),
      };
    }),
  });
}

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).default(''),
});
/** Explicit user creation only; listing never creates a course. */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  if (!nativeBrowserEnabled()) return publicApiError(requestId, 404, 'not_found', 'Not found.');
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const payload = createSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success)
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      '请输入 1–120 字的课程名称，介绍不超过 2000 字。',
    );
  const prisma = getOptionalPrisma();
  if (!prisma)
    return publicApiError(requestId, 503, 'auth_not_configured', 'Course storage is unavailable.');
  const course = await createOwnedCourse(prisma, principal.userId, {
    ...payload.data,
    language: 'zh-CN',
    tags: [],
    purpose: 'daily',
  });
  return publicApiSuccess(
    requestId,
    {
      course: {
        id: course.id,
        name: course.name,
        description: course.description,
        courseCode: course.courseCode,
        language: course.language,
        updatedAt: course.updatedAt.toISOString(),
        accessRole: 'owner',
      },
    },
    { status: 201 },
  );
}
