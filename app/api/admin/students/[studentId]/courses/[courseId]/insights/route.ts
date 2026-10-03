import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { loadStudentCourseInsights } from '@/lib/server/student-course-insights';

export async function GET(
  _request: Request,
  context: { params: Promise<{ studentId: string; courseId: string }> },
) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const { studentId, courseId } = await context.params;
    const insights = await loadStudentCourseInsights(studentId, courseId);
    return insights
      ? NextResponse.json(insights)
      : NextResponse.json({ error: '学生未加入该课程' }, { status: 404 });
  });
}
