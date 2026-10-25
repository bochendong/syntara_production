import type { PrismaClient } from '@/lib/server/generated-prisma';
import {
  findCourseAccessRole,
  removeCourseEnrollmentForUser,
} from '@/lib/server/repositories/course-enrollment-repository';
import { deleteOwnedCourseWithNotebooks } from '@/lib/server/repositories/course-repository';
import { recordTutorialStep } from '@/lib/server/onboarding';

export type CourseRemovalResult =
  | { status: 'deleted' }
  | { status: 'removed' }
  | { status: 'not_found' }
  | { status: 'locked'; message: string };

/**
 * 从自己的课程列表里删掉一门课：自己建的课连同笔记一起删除；
 * 从商城加入的课只退出（删报名），机构的课程本身不动。网页和 App 共用。
 */
export async function removeCourseForUser(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
): Promise<CourseRemovalResult> {
  const accessRole = await findCourseAccessRole(prisma, userId, courseId);
  if (!accessRole) return { status: 'not_found' };

  if (accessRole === 'owner') {
    const externalBinding = await prisma.externalCourseBinding.findUnique({
      where: { courseId },
      select: { id: true },
    });
    if (externalBinding) {
      return { status: 'locked', message: 'Speedup 托管课程不能在 Syntara 中永久删除。' };
    }
    await deleteOwnedCourseWithNotebooks(prisma, userId, courseId);
    return { status: 'deleted' };
  }

  const { removedEnrollment, removedLegacyPurchases } = await prisma.$transaction(async (tx) => ({
    removedEnrollment: await removeCourseEnrollmentForUser(tx, userId, courseId),
    removedLegacyPurchases: await tx.coursePurchase.deleteMany({
      where: { buyerId: userId, sourceCourseId: courseId },
    }),
  }));
  if (removedEnrollment === 0 && removedLegacyPurchases.count === 0) return { status: 'not_found' };
  await recordTutorialStep(prisma, userId, courseId, 'delete');
  return { status: 'removed' };
}
