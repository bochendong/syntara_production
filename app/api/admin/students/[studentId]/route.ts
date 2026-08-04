import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireAdmin } from '@/lib/server/admin-auth';
import { hashPassword } from '@/lib/server/password-hash';
import { safeRoute } from '@/lib/server/json-error-response';

const updateStudentSchema = z.object({
  email: z.string().trim().email().max(240).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(10).max(200).optional(),
  isActive: z.boolean().optional(),
  courseIds: z.array(z.string().trim().min(1).max(200)).max(40).optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ studentId: string }> }) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const { studentId } = await context.params;
    const parsed = updateStudentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: '没有可更新的学生字段。' }, { status: 400 });
    }
    const current = await prisma.user.findFirst({
      where: { id: studentId, role: 'STUDENT' },
      select: { id: true },
    });
    if (!current) return NextResponse.json({ error: '学生账号不存在。' }, { status: 404 });

    const courseIds = parsed.data.courseIds
      ? Array.from(new Set(parsed.data.courseIds))
      : undefined;
    if (courseIds) {
      const courseCount = courseIds.length
        ? await prisma.course.count({ where: { id: { in: courseIds } } })
        : 0;
      if (courseCount !== courseIds.length) {
        return NextResponse.json({ error: '选择的课程中有课程不存在。' }, { status: 400 });
      }
    }
    const passwordHash = parsed.data.password
      ? await hashPassword(parsed.data.password)
      : undefined;

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: studentId },
        data: {
          ...(parsed.data.email ? { email: parsed.data.email.toLowerCase() } : {}),
          ...(parsed.data.name ? { name: parsed.data.name } : {}),
          ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
          ...(passwordHash ? { passwordHash } : {}),
        },
      });
      if (courseIds) {
        await tx.courseEnrollment.deleteMany({
          where: { userId: studentId, courseId: { notIn: courseIds } },
        });
        if (courseIds.length) {
          await tx.courseEnrollment.createMany({
            data: courseIds.map((courseId) => ({
              userId: studentId,
              courseId,
              priceCents: 0,
              notebookAccessLimit: null,
            })),
            skipDuplicates: true,
          });
        }
      }
    });
    return NextResponse.json({ success: true });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ studentId: string }> },
) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const { studentId } = await context.params;
    const deleted = await prisma.user.deleteMany({ where: { id: studentId, role: 'STUDENT' } });
    if (!deleted.count) return NextResponse.json({ error: '学生账号不存在。' }, { status: 404 });
    return NextResponse.json({ success: true });
  });
}
