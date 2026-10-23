import type { PrismaClient } from '@/lib/server/generated-prisma';
import { pickStableCourseAvatarUrl } from '@/lib/constants/course-avatars';
import { normalizeCourseDisplay } from '@/lib/course-space/course-display-name';
import {
  findCourseAccessRole,
  markCourseEnrollmentSeen,
} from '@/lib/server/repositories/course-enrollment-repository';
import {
  listCoursePurchasesForSources,
  listPublicStoreCoursesForUser,
} from '@/lib/server/repositories/store-repository';
import { cloneStoreCourseForUser } from '@/lib/server/services/store-purchase-service';

/** App 商城的一门机构课程（和网页 /store/courses 同一份数据）。 */
export type NativeStoreCourse = {
  id: string;
  name: string;
  courseCode: string | null;
  description: string | null;
  avatarUrl: string;
  organization: { id: string; name: string; logoUrl: string | null; verified: boolean } | null;
  notebookCount: number;
  joined: boolean;
  updatedAt: string;
};

export async function listNativeStoreCourses(
  prisma: PrismaClient,
  userId: string,
): Promise<NativeStoreCourse[]> {
  const rows = await listPublicStoreCoursesForUser(prisma, userId);
  const joined = new Set(
    (
      await listCoursePurchasesForSources(
        prisma,
        userId,
        rows.map((row) => row.id),
      )
    ).map((row) => row.sourceCourseId),
  );
  return rows.map((row) => {
    const display = normalizeCourseDisplay(row);
    return {
      id: row.id,
      name: display.name,
      courseCode: display.courseCode ?? null,
      description: row.description ?? null,
      avatarUrl: row.avatarUrl?.trim() || pickStableCourseAvatarUrl(row.id),
      organization: row.organization
        ? {
            id: row.organization.id,
            name: row.organization.name,
            logoUrl: row.organization.logoUrl,
            verified: row.organization.verified,
          }
        : null,
      notebookCount: row.notebookCount || row._count.notebooks,
      joined: joined.has(row.id),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/** 从商城加入一门课：只写一条 CourseEnrollment（引用，不复制内容）。 */
export async function joinNativeStoreCourse(prisma: PrismaClient, userId: string, courseId: string) {
  const result = await cloneStoreCourseForUser(prisma, userId, courseId);
  return result.status === 'not_found' ? null : { courseId, created: result.status === 'created' };
}

/** 打开加入的机构课程后熄灭「有更新」；自己建的课程没有这一步。 */
export async function markNativeCourseSeen(prisma: PrismaClient, userId: string, courseId: string) {
  if ((await findCourseAccessRole(prisma, userId, courseId)) !== 'enrolled') return false;
  await markCourseEnrollmentSeen(prisma, userId, courseId);
  return true;
}

/** 课程列表上的机构名和「有更新」标记，按课程 id 返回。 */
export async function loadNativeCourseStoreMeta(
  prisma: PrismaClient,
  userId: string,
  courseIds: string[],
) {
  if (!courseIds.length) return new Map<string, { organizationName: string | null; hasUpdate: boolean }>();
  const [courses, enrollments] = await Promise.all([
    prisma.course.findMany({
      where: { id: { in: courseIds } },
      select: { id: true, contentVersion: true, organization: { select: { name: true } } },
    }),
    prisma.courseEnrollment
      .findMany({
        where: { userId, courseId: { in: courseIds } },
        select: { courseId: true, seenContentVersion: true },
      })
      // 老库还没跑这次迁移时，列表照常返回，只是没有更新标记。
      .catch(() => []),
  ]);
  const seen = new Map(enrollments.map((row) => [row.courseId, row.seenContentVersion]));
  return new Map(
    courses.map((course) => {
      const seenVersion = seen.get(course.id);
      return [
        course.id,
        {
          organizationName: course.organization?.name ?? null,
          hasUpdate: seenVersion !== undefined && seenVersion < course.contentVersion,
        },
      ];
    }),
  );
}
