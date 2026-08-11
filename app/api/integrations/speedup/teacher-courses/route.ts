import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { listSpeedupTeacherCourseOptions } from '@/lib/server/speedup-course-provisioning';
import { SpeedupSsoError } from '@/lib/server/speedup-sso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    try {
      const courses = await listSpeedupTeacherCourseOptions(teacher.userId);
      return NextResponse.json(
        { courses },
        { headers: { 'Cache-Control': 'no-store, max-age=0' } },
      );
    } catch (error) {
      if (error instanceof SpeedupSsoError) {
        return NextResponse.json({ error: error.publicMessage }, { status: error.status });
      }
      throw error;
    }
  });
}
