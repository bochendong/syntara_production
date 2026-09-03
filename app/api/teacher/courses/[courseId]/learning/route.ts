import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import {
  loadCourseLearningOverview,
  parseLearningRange,
} from '@/features/teacher-analytics/server/course-learning-analytics';

export async function GET(request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
      select: { id: true },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    const range = parseLearningRange(new URL(request.url).searchParams.get('range'));
    return NextResponse.json(await loadCourseLearningOverview({ prisma, courseId, range }));
  });
}
