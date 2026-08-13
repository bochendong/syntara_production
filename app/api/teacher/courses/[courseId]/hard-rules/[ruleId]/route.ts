import { NextResponse } from 'next/server';
import { z } from 'zod';

import { COURSE_HARD_RULE_MAX_CHARS } from '@/lib/server/course-hard-rules';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { hasTeacherCourseAccess } from '@/lib/server/external-course-access';

export const runtime = 'nodejs';

const updateRuleSchema = z.object({
  content: z.string().trim().min(1).max(COURSE_HARD_RULE_MAX_CHARS),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ courseId: string; ruleId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, ruleId } = await context.params;
    if (!(await hasTeacherCourseAccess(prisma, teacher.userId, courseId))) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const payload = updateRuleSchema.parse(await request.json());
    const existing = await prisma.courseHardRule.findFirst({
      where: { id: ruleId, courseId, ownerId: teacher.userId, course: { ownerId: teacher.userId } },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: 'Hard Rule not found' }, { status: 404 });
    const rule = await prisma.courseHardRule.update({
      where: { id: existing.id },
      data: { content: payload.content },
    });
    return NextResponse.json({ storage: 'postgresql', rule });
  });
}
