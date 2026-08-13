import { NextResponse } from 'next/server';
import { z } from 'zod';

import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';

const updateProgressLimitSchema = z.object({
  userId: z.string().trim().min(1).max(200),
  notebookAccessLimit: z.number().int().min(0).nullable(),
});

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
      select: {
        id: true,
        name: true,
        courseCode: true,
        academicYear: true,
        academicTerm: true,
        externalBinding: { select: { id: true } },
        _count: { select: { notebooks: { where: { removedAt: null } } } },
      },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const enrollments = await prisma.courseEnrollment.findMany({
      where: {
        courseId,
        user: {
          isActive: true,
          ...(course.externalBinding
            ? {
                externalCourseMemberships: {
                  some: {
                    bindingId: course.externalBinding.id,
                    role: 'STUDENT',
                    active: true,
                  },
                },
              }
            : {}),
        },
      },
      orderBy: { joinedAt: 'desc' },
      select: {
        joinedAt: true,
        notebookAccessLimit: true,
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
        notebookCount: course._count.notebooks,
      },
      students: enrollments.map((enrollment) => ({
        userId: enrollment.user.id,
        name: enrollment.user.name?.trim() || enrollment.user.email?.split('@')[0] || '未命名学生',
        email: enrollment.user.email || '未提供',
        avatarUrl: enrollment.user.image || undefined,
        notebookAccessLimit: enrollment.notebookAccessLimit,
        grantedAt: enrollment.joinedAt.getTime(),
      })),
    });
  });
}

export async function PATCH(request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    const parsed = updateProgressLimitSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid progress limit' }, { status: 400 });
    }
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
      select: {
        id: true,
        externalBinding: { select: { id: true } },
        _count: { select: { notebooks: { where: { removedAt: null } } } },
      },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    if (
      parsed.data.notebookAccessLimit !== null &&
      parsed.data.notebookAccessLimit > course._count.notebooks
    ) {
      return NextResponse.json({ error: '开放数量超过课程笔记本总数。' }, { status: 400 });
    }
    const updated = await prisma.courseEnrollment.updateMany({
      where: {
        courseId,
        userId: parsed.data.userId,
        ...(course.externalBinding
          ? {
              user: {
                externalCourseMemberships: {
                  some: {
                    bindingId: course.externalBinding.id,
                    role: 'STUDENT',
                    active: true,
                  },
                },
              },
            }
          : {}),
      },
      data: { notebookAccessLimit: parsed.data.notebookAccessLimit },
    });
    if (!updated.count)
      return NextResponse.json({ error: '学生不在这门课程中。' }, { status: 404 });
    return NextResponse.json({ success: true, storage: 'postgresql' });
  });
}
