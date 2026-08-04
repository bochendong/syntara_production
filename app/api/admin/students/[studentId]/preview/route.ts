import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireAdmin } from '@/lib/server/admin-auth';
import {
  ADMIN_STUDENT_PREVIEW_COOKIE,
  issueAdminStudentPreviewToken,
} from '@/lib/server/admin-student-preview';
import { safeRoute } from '@/lib/server/json-error-response';

export async function POST(_request: Request, context: { params: Promise<{ studentId: string }> }) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const { studentId } = await context.params;
    const student = await prisma.user.findFirst({
      where: { id: studentId, role: 'STUDENT', isActive: true },
      select: { id: true },
    });
    if (!student) return NextResponse.json({ error: '学生账号不存在或已停用。' }, { status: 404 });
    const token = issueAdminStudentPreviewToken(student.id);
    if (!token) return NextResponse.json({ error: '预览签名未配置。' }, { status: 503 });
    const response = NextResponse.json({ success: true, redirectUrl: '/student?preview=1' });
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
