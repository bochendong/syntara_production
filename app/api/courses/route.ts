import { normalizeCourseDisplay, storeCourseCode } from '@/lib/course-space/course-display-name';
import { loadNativeCourseStoreMeta } from '@/lib/server/native-store';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  pickRandomCourseAvatarUrl,
  pickStableCourseAvatarUrl,
} from '@/lib/constants/course-avatars';
import {
  createOwnedCourse,
  listAccessibleCoursesForUser,
} from '@/lib/server/repositories/course-repository';
import { reconcileSpeedupCourseMembershipsIfAvailable } from '@/lib/server/speedup-course-provisioning';

function isTransientDatabaseConnectionError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  return code === 'P1001' || code === 'P1002' || code === 'P2024';
}

async function readAccessibleCourses(userId: string, userEmail: string | null) {
  const read = () => listAccessibleCoursesForUser(prisma, userId, userEmail);

  try {
    return await read();
  } catch (error) {
    if (!isTransientDatabaseConnectionError(error)) throw error;
    // This Prisma client is shared by every route in the Next.js process.
    // Disconnecting it here interrupts the other parallel `/learn` requests
    // and can turn one pool timeout into a cascade of reconnects.
    return read();
  }
}

const createCourseSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional(),
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
  purpose: z.enum(['research', 'university', 'daily']).default('daily'),
  university: z.string().trim().max(120).optional(),
  courseCode: z.string().trim().max(60).optional(),
  avatarUrl: z.string().trim().max(2048).optional(),
  listedInCourseStore: z.boolean().optional(),
  coursePriceCents: z.number().int().min(0).max(100000000).optional(),
});

export async function GET() {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { userId, userEmail } = auth;

    await reconcileSpeedupCourseMembershipsIfAvailable(userId);

    const courses = await readAccessibleCourses(userId, userEmail);
    const storeMeta = await loadNativeCourseStoreMeta(
      prisma,
      userId,
      courses.map((course) => course.id),
    ).catch(() => new Map<string, { organizationName: string | null }>());

    return NextResponse.json(
      {
        courses: courses.map((course) => {
          const display = normalizeCourseDisplay(course);
          const organizationName = storeMeta.get(course.id)?.organizationName;
          return {
            ...display,
            // 从商城加入的课和商城里一样带学校前缀（UTM-CSC 108），App 课程列表同一规则。
            courseCode: organizationName
              ? storeCourseCode({ ...display, university: course.university, organizationName })
              : display.courseCode,
            avatarUrl: course.avatarUrl?.trim() || pickStableCourseAvatarUrl(course.id),
            joinedAt: course.joinedAt ?? undefined,
            sourceOwnerName: course.sourceOwnerName ?? undefined,
          };
        }),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

export async function POST(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { userId } = auth;

    const payload = createCourseSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const avatarUrl = payload.data.avatarUrl?.trim() || pickRandomCourseAvatarUrl();

    // 新建的课程是用户自己的；上架商城只对机构课程开放（见 PATCH /api/courses/[id]）。
    const { listedInCourseStore: _listedInCourseStore, ...rest } = payload.data;
    const course = await createOwnedCourse(prisma, userId, {
      ...rest,
      avatarUrl,
    });

    return NextResponse.json({ course }, { status: 201 });
  });
}
