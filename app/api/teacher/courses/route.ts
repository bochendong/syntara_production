import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { pickStableCourseAvatarUrl } from '@/lib/constants/course-avatars';

export async function GET() {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const courses = await prisma.course.findMany({
      where: { ownerId: teacher.userId },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json({
      courses: courses.map((course) => ({
        ...course,
        accessRole: 'owner' as const,
        avatarUrl: course.avatarUrl?.trim() || pickStableCourseAvatarUrl(course.id),
      })),
    });
  });
}
