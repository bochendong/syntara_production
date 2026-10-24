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
  sceneCount: number;
  problemCount: number;
  /** 已加入的人数（含自己），用来排「热门」。 */
  learnerCount: number;
  averageRating: number;
  reviewCount: number;
  purpose: string;
  university: string | null;
  tags: string[];
  joined: boolean;
  updatedAt: string;
};

/** 商城详情页：章节（机构的笔记本）和几条评价。 */
export type NativeStoreCourseDetail = NativeStoreCourse & {
  notebooks: Array<{
    id: string;
    name: string;
    description: string | null;
    sceneCount: number;
    problemCount: number;
  }>;
  reviews: Array<{ id: string; rating: number; comment: string | null; reviewerName: string }>;
};

async function loadStoreStats(prisma: PrismaClient, courseIds: string[]) {
  if (!courseIds.length) {
    return {
      learners: new Map<string, number>(),
      ratings: new Map<string, { sum: number; count: number }>(),
    };
  }
  const [learnerRows, reviewRows] = await Promise.all([
    prisma.courseEnrollment
      .groupBy({ by: ['courseId'], where: { courseId: { in: courseIds } }, _count: { _all: true } })
      .catch(() => [] as Array<{ courseId: string; _count: { _all: number } }>),
    prisma.courseReview.groupBy({
      by: ['courseId'],
      where: { courseId: { in: courseIds } },
      _sum: { rating: true },
      _count: { _all: true },
    }),
  ]);
  return {
    learners: new Map(learnerRows.map((row) => [row.courseId, row._count._all])),
    ratings: new Map(
      reviewRows.map((row) => [
        row.courseId,
        { sum: row._sum.rating ?? 0, count: row._count._all },
      ]),
    ),
  };
}

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
  const stats = await loadStoreStats(
    prisma,
    rows.map((row) => row.id),
  );
  return rows.map((row) => {
    const display = normalizeCourseDisplay(row);
    const rating = stats.ratings.get(row.id);
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
      sceneCount:
        row.sceneCount || row.notebooks.reduce((sum, nb) => sum + (nb.sceneCount ?? 0), 0),
      problemCount: row.publishedProblemCount,
      learnerCount: stats.learners.get(row.id) ?? 0,
      averageRating: rating?.count ? Math.round((rating.sum / rating.count) * 10) / 10 : 0,
      reviewCount: rating?.count ?? 0,
      purpose: row.purpose,
      university: row.university ?? null,
      tags: row.tags,
      joined: joined.has(row.id),
      updatedAt: row.updatedAt.toISOString(),
    };
  });
}

/** 从商城加入一门课：只写一条 CourseEnrollment（引用，不复制内容）。 */
export async function joinNativeStoreCourse(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
) {
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
  if (!courseIds.length)
    return new Map<string, { organizationName: string | null; hasUpdate: boolean }>();
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

/** 商城详情：列表里的字段 + 章节 + 最近的评价。下架或不存在时返回 null。 */
export async function getNativeStoreCourseDetail(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
): Promise<NativeStoreCourseDetail | null> {
  const course = (await listNativeStoreCourses(prisma, userId)).find(
    (item) => item.id === courseId,
  );
  if (!course) return null;
  const [notebooks, reviews] = await Promise.all([
    prisma.notebook.findMany({
      where: {
        courseId,
        removedAt: null,
        owner: { courses: { some: { id: courseId } } },
      },
      orderBy: { createdAt: 'asc' },
      take: 60,
      select: {
        id: true,
        name: true,
        description: true,
        sceneCount: true,
        publishedProblemCount: true,
      },
    }),
    prisma.courseReview.findMany({
      where: { courseId },
      orderBy: { updatedAt: 'desc' },
      take: 6,
      select: {
        id: true,
        rating: true,
        comment: true,
        reviewer: { select: { name: true, email: true } },
      },
    }),
  ]);
  return {
    ...course,
    notebooks: notebooks.map((notebook) => ({
      id: notebook.id,
      name: notebook.name,
      description: notebook.description,
      sceneCount: notebook.sceneCount,
      problemCount: notebook.publishedProblemCount,
    })),
    reviews: reviews.map((review) => ({
      id: review.id,
      rating: review.rating,
      comment: review.comment,
      reviewerName: review.reviewer.name?.trim() || review.reviewer.email?.split('@')[0] || '同学',
    })),
  };
}
