import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireAdmin } from '@/lib/server/admin-auth';
import { hashPassword } from '@/lib/server/password-hash';
import { safeRoute } from '@/lib/server/json-error-response';

const createStudentSchema = z.object({
  email: z.string().trim().email().max(240),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(10).max(200),
  courseIds: z.array(z.string().trim().min(1).max(200)).max(40).default([]),
});

function studentPayload(student: {
  id: string;
  email: string | null;
  name: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  courseEnrollments: Array<{
    joinedAt: Date;
    notebookAccessLimit: number | null;
    course: {
      id: string;
      name: string;
      courseCode: string | null;
      academicYear: number | null;
      academicTerm: 'winter' | 'summer' | 'fall' | null;
    };
  }>;
}) {
  return {
    id: student.id,
    email: student.email || '',
    name: student.name || '',
    isActive: student.isActive,
    courses: student.courseEnrollments.map((enrollment) => ({
      ...enrollment.course,
      notebookAccessLimit: enrollment.notebookAccessLimit,
      joinedAt: enrollment.joinedAt.toISOString(),
    })),
    createdAt: student.createdAt.toISOString(),
    updatedAt: student.updatedAt.toISOString(),
  };
}

const studentSelect = {
  id: true,
  email: true,
  name: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  courseEnrollments: {
    orderBy: { joinedAt: 'desc' as const },
    select: {
      joinedAt: true,
      notebookAccessLimit: true,
      course: {
        select: {
          id: true,
          name: true,
          courseCode: true,
          academicYear: true,
          academicTerm: true,
        },
      },
    },
  },
};

export async function GET() {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const students = await prisma.user.findMany({
      where: { role: 'STUDENT' },
      select: studentSelect,
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      take: 500,
    });
    return NextResponse.json({ students: students.map(studentPayload) });
  });
}

export async function POST(request: Request) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const parsed = createStudentSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: '请填写有效邮箱、学生姓名和至少 10 位的初始密码。' },
        { status: 400 },
      );
    }
    const email = parsed.data.email.toLowerCase();
    const courseIds = Array.from(new Set(parsed.data.courseIds));
    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) return NextResponse.json({ error: '该邮箱已经存在。' }, { status: 409 });
    const courseCount = courseIds.length
      ? await prisma.course.count({ where: { id: { in: courseIds } } })
      : 0;
    if (courseCount !== courseIds.length) {
      return NextResponse.json({ error: '选择的课程中有课程不存在。' }, { status: 400 });
    }
    const passwordHash = await hashPassword(parsed.data.password);

    const student = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          name: parsed.data.name,
          role: 'STUDENT',
          isActive: true,
          passwordHash,
        },
        select: { id: true },
      });
      if (courseIds.length) {
        await tx.courseEnrollment.createMany({
          data: courseIds.map((courseId) => ({
            userId: created.id,
            courseId,
            priceCents: 0,
            notebookAccessLimit: null,
          })),
          skipDuplicates: true,
        });
      }
      return tx.user.findUniqueOrThrow({ where: { id: created.id }, select: studentSelect });
    });

    return NextResponse.json({ student: studentPayload(student) }, { status: 201 });
  });
}
