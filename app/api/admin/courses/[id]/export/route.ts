import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { archiveResponse, buildAdminCourseArchive } from '@/lib/server/admin-course-export';

export const runtime = 'nodejs';
export const maxDuration = 300;

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  const db = getOptionalPrisma();
  if (!db) return NextResponse.json({ error: '数据库不可用' }, { status: 503 });
  const { id } = await context.params;
  const course = await db.course.findUnique({ where: { id }, select: { id: true, ownerId: true } });
  if (!course) return NextResponse.json({ error: '课程不存在' }, { status: 404 });
  const zip = await buildAdminCourseArchive(db, [course.id]);
  return archiveResponse(zip, `course-${course.id}`);
}
