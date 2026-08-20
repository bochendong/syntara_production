import {
  findCourseAccessRole,
  type CourseAccessRole,
} from '@/lib/server/repositories/course-enrollment-repository';
import { requireServerSession } from '@/lib/server/auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

/** `undefined` means auth/database was unavailable and the client should retry. */
export async function currentCoursePageAccess(
  courseId: string,
): Promise<CourseAccessRole | null | undefined> {
  const session = await requireServerSession();
  const userId = session?.user?.id?.trim();
  const prisma = getOptionalPrisma();
  if (!userId || !prisma) return undefined;
  try {
    return await findCourseAccessRole(prisma, userId, courseId);
  } catch {
    return undefined;
  }
}
