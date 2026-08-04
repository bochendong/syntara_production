import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireAdmin } from '@/lib/server/admin-auth';
import { hashPassword } from '@/lib/server/password-hash';
import { safeRoute } from '@/lib/server/json-error-response';

const createTeacherSchema = z.object({
  email: z.string().trim().email().max(240),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(10).max(200),
});

export async function GET() {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const teachers = await prisma.user.findMany({
      where: { role: 'TEACHER' },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { courses: true } },
      },
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      take: 250,
    });
    return NextResponse.json({
      teachers: teachers.map((teacher) => ({
        id: teacher.id,
        email: teacher.email || '',
        name: teacher.name || '',
        isActive: teacher.isActive,
        courseCount: teacher._count.courses,
        createdAt: teacher.createdAt.toISOString(),
        updatedAt: teacher.updatedAt.toISOString(),
      })),
    });
  });
}

export async function POST(request: Request) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const parsed = createTeacherSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: '请填写有效邮箱、老师姓名和至少 10 位的初始密码。' },
        { status: 400 },
      );
    }
    const email = parsed.data.email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return NextResponse.json({ error: '该邮箱已经存在。' }, { status: 409 });
    }
    const teacher = await prisma.user.create({
      data: {
        email,
        name: parsed.data.name,
        role: 'TEACHER',
        isActive: true,
        passwordHash: await hashPassword(parsed.data.password),
      },
      select: {
        id: true,
        email: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return NextResponse.json(
      {
        teacher: {
          ...teacher,
          courseCount: 0,
          createdAt: teacher.createdAt.toISOString(),
          updatedAt: teacher.updatedAt.toISOString(),
        },
      },
      { status: 201 },
    );
  });
}
