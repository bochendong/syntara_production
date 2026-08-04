import { NextResponse } from 'next/server';

import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ownerId: teacher.userId },
      select: {
        id: true,
        name: true,
        courseCode: true,
        academicYear: true,
        academicTerm: true,
      },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const enrollments = await prisma.courseEnrollment.findMany({
      where: { courseId, user: { isActive: true } },
      orderBy: { joinedAt: 'desc' },
      select: {
        joinedAt: true,
        user: { select: { id: true, name: true, email: true, image: true } },
      },
    });

    return NextResponse.json({
      storage: 'postgresql',
      course: {
        id: course.id,
        code: course.courseCode?.trim() || course.name,
        name: course.name,
        academicYear: course.academicYear,
        term: course.academicTerm,
      },
      students: enrollments.map((enrollment) => ({
        userId: enrollment.user.id,
        name: enrollment.user.name?.trim() || enrollment.user.email?.split('@')[0] || '未命名学生',
        email: enrollment.user.email || '未提供',
        avatarUrl: enrollment.user.image || undefined,
        grantedAt: enrollment.joinedAt.getTime(),
      })),
    });
  });
}
