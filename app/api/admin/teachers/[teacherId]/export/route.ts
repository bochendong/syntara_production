import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { archiveResponse, buildAdminCourseArchive } from '@/lib/server/admin-course-export';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(_request: Request, context: { params: Promise<{ teacherId: string }> }) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  const db = getOptionalPrisma();
  if (!db) return NextResponse.json({ error: '数据库不可用' }, { status: 503 });
  const { teacherId } = await context.params;
  const teacher = await db.user.findFirst({
    where: { id: teacherId, role: 'TEACHER' },
    select: { id: true, name: true, email: true },
  });
  if (!teacher) return NextResponse.json({ error: '老师不存在' }, { status: 404 });
  const courses = await db.course.findMany({
    where: { ownerId: teacher.id },
    select: { id: true },
  });
  const zip = await buildAdminCourseArchive(
    db,
    courses.map((course) => course.id),
  );
  return archiveResponse(zip, `teacher-courses-${teacher.id}`);
}
