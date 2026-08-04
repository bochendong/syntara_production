import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireAdmin } from '@/lib/server/admin-auth';
import { hashPassword } from '@/lib/server/password-hash';
import { safeRoute } from '@/lib/server/json-error-response';

const updateTeacherSchema = z.object({
  email: z.string().trim().email().max(240).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  password: z.string().min(10).max(200).optional(),
  isActive: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ teacherId: string }> }) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const { teacherId } = await context.params;
    const parsed = updateTeacherSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: '没有可更新的老师字段。' }, { status: 400 });
    }
    const current = await prisma.user.findFirst({
      where: { id: teacherId, role: 'TEACHER' },
      select: { id: true },
    });
    if (!current) return NextResponse.json({ error: '老师账号不存在。' }, { status: 404 });
    const teacher = await prisma.user.update({
      where: { id: teacherId },
      data: {
        ...(parsed.data.email ? { email: parsed.data.email.toLowerCase() } : {}),
        ...(parsed.data.name ? { name: parsed.data.name } : {}),
        ...(parsed.data.isActive !== undefined ? { isActive: parsed.data.isActive } : {}),
        ...(parsed.data.password ? { passwordHash: await hashPassword(parsed.data.password) } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { courses: true } },
      },
    });
    return NextResponse.json({
      teacher: {
        id: teacher.id,
        email: teacher.email || '',
        name: teacher.name || '',
        isActive: teacher.isActive,
        courseCount: teacher._count.courses,
        createdAt: teacher.createdAt.toISOString(),
        updatedAt: teacher.updatedAt.toISOString(),
      },
    });
  });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ teacherId: string }> },
) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const { teacherId } = await context.params;
    const deleted = await prisma.user.deleteMany({ where: { id: teacherId, role: 'TEACHER' } });
    if (deleted.count === 0) {
      return NextResponse.json({ error: '老师账号不存在。' }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  });
}
