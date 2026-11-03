import { stageContent, undoContentDraft } from '@/lib/server/course-content-drafts';
import {
  listManagedCourseContent,
  getManagedCourseStudent,
  getManagedCourseStudentAttempts,
  listManagedCourseStudents,
  listManagedProblemGroups,
  managedReleaseStatus,
} from '@/lib/server/course-content-management';
import {
  notebookProblemGradingSchema,
  notebookProblemPublicContentSchema,
} from '@/lib/problem-bank/schema';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { formatCourseUpdateSummary } from '@/lib/course-space/course-update-summary';
import {
  CourseAdmissionError,
  getCoursePublication,
  publicationSchema,
  courseProfileSchema,
  updateCourseProfile,
  publishCourse,
  listCourseApplications,
  listMyCourseApplications,
  reviewCourseApplication,
} from '@/lib/server/course-admissions';

import {
  getNativeStoreCourseDetail,
  joinNativeStoreCourse,
  listNativeStoreCourses,
  markNativeCourseSeen,
} from '@/lib/server/native-store';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import {
  copyCourseContentToMine,
  CourseContentNotFoundError,
  PublicProblemReadOnlyError,
  courseLayersForUser,
  releaseCourseVersion,
  removeCourseContentForUser,
  restoreCourseContentForUser,
} from '@/lib/server/store-course-layers';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

/** App 商城：机构课程列表，和网页 /store/courses 一致。 */
async function getStore(request: NextRequest, requestId: string) {
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Store is unavailable.');
  }
  const managementOf = request.nextUrl.searchParams.get('managementOf')?.trim();
  if (managementOf) {
    const kind = request.nextUrl.searchParams.get('kind');
    if (managementOf.length > 200 || (kind !== 'notes' && kind !== 'problems'))
      throw new CourseAdmissionError(400, '请求无效。');
    return publicApiSuccess(
      requestId,
      await listManagedCourseContent(
        prisma,
        principal.userId,
        managementOf,
        kind,
        Number(request.nextUrl.searchParams.get('page') || 1),
        request.nextUrl.searchParams.get('query') || '',
        request.nextUrl.searchParams.get('group')?.slice(0, 220) || undefined,
      ),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  // 自己的加入申请（待批准、未通过）：App 侧边栏显示。
  if (request.nextUrl.searchParams.get('myApplications')) {
    return publicApiSuccess(requestId, await listMyCourseApplications(prisma, principal.userId), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  // 一个学生在这门课的学情：仅课程主人、课程老师和管理员；私有课程只有基本信息。
  const studentOf = request.nextUrl.searchParams.get('studentOf')?.trim();
  if (studentOf) {
    const studentId = request.nextUrl.searchParams.get('userId')?.trim() ?? '';
    if (studentOf.length > 200 || !studentId || studentId.length > 200)
      throw new CourseAdmissionError(400, '请求无效。');
    const problemId = request.nextUrl.searchParams.get('problemId')?.trim();
    const attemptId = request.nextUrl.searchParams.get('attemptId')?.trim();
    if (
      (problemId && problemId.length > 200) ||
      (attemptId && (!problemId || attemptId.length > 200))
    )
      throw new CourseAdmissionError(400, '请求无效。');
    return publicApiSuccess(
      requestId,
      problemId
        ? await getManagedCourseStudentAttempts(
            prisma,
            principal.userId,
            studentOf,
            studentId,
            problemId,
            Number(request.nextUrl.searchParams.get('page') || 1),
            attemptId,
          )
        : await getManagedCourseStudent(prisma, principal.userId, studentOf, studentId),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  // 课程管理页：题库分组、学生（按学期）、发布状态。只给能管理这门课的人。
  for (const [param, load] of [
    ['problemGroupsOf', listManagedProblemGroups],
    ['studentsOf', listManagedCourseStudents],
    ['releaseOf', managedReleaseStatus],
  ] as const) {
    const id = request.nextUrl.searchParams.get(param)?.trim();
    if (!id) continue;
    if (id.length > 200) throw new CourseAdmissionError(400, '课程 ID 无效。');
    return publicApiSuccess(requestId, await load(prisma, principal.userId, id), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }
  const publicationOf = request.nextUrl.searchParams.get('publicationOf')?.trim();
  const applicationsOf = request.nextUrl.searchParams.get('applicationsOf')?.trim();
  if (publicationOf || applicationsOf) {
    const id = publicationOf || applicationsOf!;
    if (id.length > 200) throw new CourseAdmissionError(400, '课程 ID 无效。');
    return publicApiSuccess(
      requestId,
      publicationOf
        ? { publication: await getCoursePublication(prisma, principal.userId, id) }
        : await listCourseApplications(
            prisma,
            principal.userId,
            id,
            Number(request.nextUrl.searchParams.get('page') || 1),
            request.nextUrl.searchParams.get('query') || '',
          ),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  // ?layersOf= 返回加入的课里自己隐藏的内容、「新」笔记、自己的笔记和更新摘要，给课程页用。
  const layersOf = request.nextUrl.searchParams.get('layersOf')?.trim();
  if (layersOf) {
    if (!(await findCourseAccessRole(prisma, principal.userId, layersOf)))
      return publicApiError(requestId, 404, 'not_found', '课程不存在或没有权限。');
    return publicApiSuccess(
      requestId,
      await courseLayersForUser(prisma, principal.userId, layersOf),
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  // ?courseId= 返回一门课的详情（章节 + 评价）；不带参数返回整个商城。
  const courseId = request.nextUrl.searchParams.get('courseId')?.trim();
  if (courseId) {
    const course = await getNativeStoreCourseDetail(prisma, principal.userId, courseId);
    if (!course) return publicApiError(requestId, 404, 'not_found', '课程不存在或已下架。');
    return publicApiSuccess(
      requestId,
      { course },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  }
  const courses = await listNativeStoreCourses(prisma, principal.userId);
  return publicApiSuccess(
    requestId,
    { courses },
    { headers: { 'Cache-Control': 'private, no-store' } },
  );
}

const actionSchema = z.union([
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.literal('undo-managed-content'),
    kind: z.enum(['notes', 'problems']),
    id: z.string().trim().min(1).max(200),
  }),
  z
    .object({
      courseId: z.string().trim().min(1).max(200),
      action: z.literal('add-managed-content'),
      kind: z.enum(['notes', 'problems']),
      title: z.string().trim().min(1).max(200),
      text: z.string().trim().min(1).max(1000000),
    })
    .refine((value) => value.kind !== 'problems' || value.text.length <= 12000),
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.literal('delete-managed-content'),
    kind: z.enum(['notes', 'problems']),
    id: z.string().trim().min(1).max(200),
  }),
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.literal('update-managed-note'),
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200).optional(),
    sections: z
      .array(
        z.object({
          id: z.string().trim().min(1).max(200),
          markdown: z.string().max(1000000),
        }),
      )
      .max(200)
      .optional(),
  }),
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.literal('update-managed-problem'),
    id: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['draft', 'published']).optional(),
    difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
    chapterId: z.string().trim().min(1).max(200).nullable().optional(),
    notebookId: z.string().trim().min(1).max(200).nullable().optional(),
    publicContent: notebookProblemPublicContentSchema.optional(),
    grading: notebookProblemGradingSchema.optional(),
  }),
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.literal('update-course-profile'),
    profile: courseProfileSchema,
  }),
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.literal('publish'),
    publication: publicationSchema,
  }),
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.literal('review-application'),
    applicationId: z.string().trim().min(1).max(200),
    decision: z.enum(['approved', 'rejected']),
  }),
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.enum(['join', 'seen', 'release']),
    answers: z
      .record(z.string().max(60), z.string().max(500))
      .refine((value) => Object.keys(value).length <= 8)
      .optional(),
  }),
  z.object({
    courseId: z.string().trim().min(1).max(200),
    action: z.enum(['remove', 'restore', 'copy']),
    targetType: z.enum(['notebook', 'problem']),
    targetId: z.string().trim().min(1).max(200),
  }),
]);

/**
 * join：从商城加入课程；seen：打开过加入的课程，熄灭「有更新」。
 * remove / restore / copy：加入的课里删除（公有内容只对自己隐藏）、恢复隐藏、复制到自己的私有层。
 */
async function postStore(request: NextRequest, requestId: string) {
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Store is unavailable.');
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid store action.');
  }
  const { courseId, action } = parsed.data;
  if (parsed.data.action === 'undo-managed-content') {
    const input = parsed.data;
    await prisma.$transaction((tx) =>
      undoContentDraft(tx, principal.userId, courseId, input.kind, input.id),
    );
    return publicApiSuccess(requestId, { restored: true });
  }
  if (parsed.data.action === 'add-managed-content') {
    const input = parsed.data;
    await prisma.$transaction((tx) =>
      stageContent(tx, principal.userId, courseId, input.kind, null, {
        title: input.title,
        text: input.text,
      }),
    );
    return publicApiSuccess(requestId, { saved: true });
  }
  if (parsed.data.action === 'delete-managed-content') {
    const input = parsed.data;
    await prisma.$transaction((tx) =>
      stageContent(tx, principal.userId, courseId, input.kind, input.id, {}, true),
    );
    return publicApiSuccess(requestId, { deleted: true });
  }
  if (parsed.data.action === 'update-managed-note') {
    const { id, title, sections } = parsed.data;
    await prisma.$transaction((tx) =>
      stageContent(tx, principal.userId, courseId, 'notes', id, { title, sections }),
    );
    return publicApiSuccess(requestId, { saved: true });
  }
  if (parsed.data.action === 'update-managed-problem') {
    const { id, courseId: _course, action: _action, ...patch } = parsed.data;
    await prisma.$transaction(
      (tx) => stageContent(tx, principal.userId, courseId, 'problems', id, patch),
      { timeout: 60000 },
    );
    return publicApiSuccess(requestId, { saved: true });
  }
  if (parsed.data.action === 'update-course-profile') {
    const profile = parsed.data.profile;
    return publicApiSuccess(requestId, {
      publication: await prisma.$transaction((tx) =>
        updateCourseProfile(tx, principal.userId, courseId, profile),
      ),
    });
  }
  if (parsed.data.action === 'publish') {
    const publication = parsed.data.publication;
    return publicApiSuccess(requestId, {
      publication: await prisma.$transaction((tx) =>
        publishCourse(tx, principal.userId, courseId, publication),
      ),
    });
  }
  if (parsed.data.action === 'review-application') {
    const input = parsed.data;
    return publicApiSuccess(
      requestId,
      await prisma.$transaction((tx) =>
        reviewCourseApplication(
          tx,
          principal.userId,
          courseId,
          input.applicationId,
          input.decision,
        ),
      ),
    );
  }
  if ('targetType' in parsed.data) {
    const target = {
      userId: principal.userId,
      courseId,
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
    };
    try {
      if (parsed.data.action === 'restore') {
        await restoreCourseContentForUser(prisma, target);
        return publicApiSuccess(requestId, { restored: true });
      }
      if (parsed.data.action === 'copy') {
        return publicApiSuccess(requestId, await copyCourseContentToMine(prisma, target), {
          status: 201,
        });
      }
      return publicApiSuccess(requestId, {
        result: await removeCourseContentForUser(prisma, target),
      });
    } catch (error) {
      if (error instanceof CourseContentNotFoundError)
        return publicApiError(requestId, 404, 'not_found', error.message);
      if (error instanceof PublicProblemReadOnlyError)
        return publicApiError(requestId, 403, 'invalid_request', error.message);
      throw error;
    }
  }
  if (action === 'release') {
    const release = await releaseCourseVersion(prisma, courseId, principal.userId);
    return publicApiSuccess(requestId, { ...release, text: formatCourseUpdateSummary(release) });
  }
  if (action === 'seen') {
    return publicApiSuccess(requestId, {
      courseId,
      seen: await markNativeCourseSeen(prisma, principal.userId, courseId),
    });
  }
  const joined = await joinNativeStoreCourse(
    prisma,
    principal.userId,
    courseId,
    'answers' in parsed.data ? parsed.data.answers : undefined,
  );
  if (!joined) return publicApiError(requestId, 404, 'not_found', '课程不存在或已下架。');
  return publicApiSuccess(requestId, joined, { status: joined.created ? 201 : 200 });
}

async function storeRequest(
  request: NextRequest,
  handler: (request: NextRequest, requestId: string) => Promise<Response>,
) {
  const requestId = publicApiRequestId(request);
  try {
    return await handler(request, requestId);
  } catch (error) {
    if (error instanceof CourseAdmissionError)
      return publicApiError(
        requestId,
        error.status,
        error.status === 404
          ? 'not_found'
          : error.status === 403
            ? 'unauthorized'
            : 'invalid_request',
        error.message,
      );
    throw error;
  }
}
export function GET(request: NextRequest) {
  return storeRequest(request, getStore);
}
export function POST(request: NextRequest) {
  return storeRequest(request, postStore);
}
