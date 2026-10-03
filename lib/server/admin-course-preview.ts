import type { Session } from 'next-auth';
import { requireAdmin } from '@/lib/server/admin-auth';
import { resolveAdminStudentPreviewId } from '@/lib/server/admin-student-preview';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

/** A signed preview token is effective only while the real administrator is authenticated. */
export async function resolveAdminCoursePreviewSession(): Promise<Session | null> {
  const id = await resolveAdminStudentPreviewId();
  if (!id) return null;
  const admin = await requireAdmin();
  if ('response' in admin) return null;
  const db = getOptionalPrisma();
  if (!db) return null;
  const user = await db.user.findFirst({
    where: { id, isActive: true, role: { in: ['STUDENT', 'TEACHER'] } },
    select: { id: true, name: true, email: true, image: true, role: true, isActive: true },
  });
  if (!user) return null;
  return { user, expires: new Date(Date.now() + 60 * 60 * 1000).toISOString() } as Session;
}

/** Read access for an authenticated administrator previewing the stored course owner. */
export async function isAdminTeacherCourseOwnerPreview(
  userId: string,
  courseId: string,
): Promise<boolean> {
  const session = await resolveAdminCoursePreviewSession();
  if (session?.user?.id !== userId || session.user.role !== 'TEACHER') return false;
  const db = getOptionalPrisma();
  if (!db) return false;
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: { ownerId: true },
  });
  return course?.ownerId === userId;
}
