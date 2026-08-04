import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { ADMIN_STUDENT_PREVIEW_COOKIE } from '@/lib/server/admin-student-preview';

export async function DELETE() {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_STUDENT_PREVIEW_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  return response;
}
