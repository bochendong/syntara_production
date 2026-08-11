import { NextResponse } from 'next/server';
import { z } from 'zod';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { activateSpeedupTeacherCourses } from '@/lib/server/speedup-course-provisioning';
import { SpeedupSsoError } from '@/lib/server/speedup-sso';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const activateCoursesSchema = z.object({
  courseIds: z
    .array(
      z
        .string()
        .trim()
        .regex(/^\d{1,20}$/),
    )
    .min(1)
    .max(100),
});

export async function POST(request: Request) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const payload = activateCoursesSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json({ error: '请选择至少一门有效的 Speedup 课程。' }, { status: 400 });
    }

    try {
      const activated = await activateSpeedupTeacherCourses(
        teacher.userId,
        Array.from(new Set(payload.data.courseIds)),
      );
      return NextResponse.json(
        { activated },
        { status: activated.some((course) => course.created) ? 201 : 200 },
      );
    } catch (error) {
      if (error instanceof SpeedupSsoError) {
        return NextResponse.json({ error: error.publicMessage }, { status: error.status });
      }
      throw error;
    }
  });
}
