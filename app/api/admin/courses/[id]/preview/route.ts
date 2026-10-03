import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  ADMIN_STUDENT_PREVIEW_COOKIE,
  issueAdminStudentPreviewToken,
} from '@/lib/server/admin-student-preview';

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const { id } = await context.params;
    const course = await prisma.course.findUnique({ where: { id }, select: { ownerId: true } });
    if (!course) return NextResponse.json({ error: '课程不存在' }, { status: 404 });
    const studentId = request.nextUrl.searchParams.get('studentId')?.trim();
    const user = await prisma.user.findFirst({
      where: {
        id: studentId || course.ownerId,
        isActive: true,
        role: studentId ? 'STUDENT' : 'TEACHER',
      },
      select: { id: true },
    });
    if (!user) return NextResponse.json({ error: '对应账号不存在或已停用' }, { status: 404 });
    if (studentId) {
      const enrolled = await prisma.courseEnrollment.findFirst({
        where: { courseId: id, userId: studentId },
      });
      if (!enrolled) return NextResponse.json({ error: '该学生未加入课程' }, { status: 403 });
    }
    const token = issueAdminStudentPreviewToken(user.id);
    if (!token) return NextResponse.json({ error: '预览签名未配置' }, { status: 503 });
    const destination = studentId
      ? `/course/${encodeURIComponent(id)}`
      : `/teacher/courses/${encodeURIComponent(id)}`;
    const response = NextResponse.redirect(new URL(destination, request.url));
    response.headers.set('Cache-Control', 'private, no-store');
    response.cookies.set(ADMIN_STUDENT_PREVIEW_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 4 * 60 * 60,
    });
    return response;
  });
}
