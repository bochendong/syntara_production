import { NextResponse } from 'next/server';
import { z } from 'zod';

import { COURSE_HARD_RULE_LIMIT, COURSE_HARD_RULE_MAX_CHARS } from '@/lib/server/course-hard-rules';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';

export const runtime = 'nodejs';

const createRuleSchema = z.object({
  content: z.string().trim().min(1).max(COURSE_HARD_RULE_MAX_CHARS),
});

async function requireOwnedCourse(courseId: string) {
  const teacher = await requireTeacher();
  if ('response' in teacher) return teacher;
  const course = await prisma.course.findFirst({
    where: { id: courseId, ownerId: teacher.userId },
    select: { id: true, ownerId: true },
  });
  if (!course) {
    return { response: NextResponse.json({ error: 'Course not found' }, { status: 404 }) } as const;
  }
  return { teacher, course } as const;
}

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const { courseId } = await context.params;
    const access = await requireOwnedCourse(courseId);
    if (!('course' in access)) return access.response;
    const rules = await prisma.courseHardRule.findMany({
      where: { courseId, ownerId: access.course.ownerId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    });
    return NextResponse.json({ storage: 'postgresql', rules });
  });
}

export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const { courseId } = await context.params;
    const access = await requireOwnedCourse(courseId);
    if (!('course' in access)) return access.response;
    const payload = createRuleSchema.parse(await request.json());
    const aggregate = await prisma.courseHardRule.aggregate({
      where: { courseId, ownerId: access.course.ownerId },
      _count: { _all: true },
      _max: { position: true },
    });
    if (aggregate._count._all >= COURSE_HARD_RULE_LIMIT) {
      return NextResponse.json(
        { error: `每门课程最多添加 ${COURSE_HARD_RULE_LIMIT} 条 Hard Rule` },
        { status: 409 },
      );
    }
    const rule = await prisma.courseHardRule.create({
      data: {
        courseId,
        ownerId: access.course.ownerId,
        content: payload.content,
        position: (aggregate._max.position ?? -1) + 1,
      },
    });
    return NextResponse.json({ storage: 'postgresql', rule }, { status: 201 });
  });
}
