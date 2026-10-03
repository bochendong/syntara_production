import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import { loadStudentCourseInsights } from '@/lib/server/student-course-insights';

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string; studentId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, studentId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
      select: { id: true },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    const insights = await loadStudentCourseInsights(studentId, courseId);
    return insights
      ? NextResponse.json(insights)
      : NextResponse.json({ error: '学生未加入该课程' }, { status: 404 });
  });
}
