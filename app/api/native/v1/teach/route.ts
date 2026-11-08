import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';
import {
  ClassroomError,
  addClassMemberByEmail,
  applyClassSessionAction,
  createDraftSession,
  deleteDraftSession,
  deleteEndedSession,
  ensureCurrentTermClass,
  getClassOverview,
  getClassSessionDashboard,
  getClassSessionProblemPreview,
  getClassSessionProblemPreviews,
  getLiveSessionForCourse,
  getSessionStudentAnswers,
  importSessionsAsDrafts,
  listImportableSessions,
  listSessionProblemChoices,
  listTeachableCourses,
  removeClassMember,
  resetClassJoinCode,
  startClassSession,
  type ClassroomViewer,
} from '@/lib/server/teacher-classroom';
import {
  claimCourse,
  listClaimableCourses,
  releaseCourseClaim,
} from '@/lib/server/teacher-course-claim';

export const runtime = 'nodejs';

/**
 * App 里的「教学」页（网页版 / iPad / 电脑 App）。
 * 能不能看某门课、某个班按关系判断（班级老师），不看账号角色，所以同一个账号可以既教又学。
 */
async function viewerFor(request: NextRequest, requestId: string) {
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Teaching is unavailable.');
  }
  const user = await prisma.user.findUnique({
    where: { id: principal.userId },
    select: { role: true, isActive: true },
  });
  if (!user?.isActive) return publicApiError(requestId, 403, 'unauthorized', '账号不可用。');
  return { userId: principal.userId, role: user.role } satisfies ClassroomViewer;
}

function classroomError(requestId: string, error: unknown) {
  if (error instanceof ClassroomError) {
    return publicApiError(
      requestId,
      error.status,
      error.status === 404 ? 'not_found' : 'invalid_request',
      error.message,
    );
  }
  throw error;
}

/**
 * ?classId= 班级；?sessionId= 一节课；?choices=<sessionId> 可以加的题；
 * ?answers=<sessionId>&problemId=&userId= 一个学生一道题的提交；
 * ?importFor=<classId> 可以导入的往届课；?liveCourse=<courseId> 这门课正在上的那节；
 * ?claim=1&q= 可以认领的课；都没有 = 课程列表。
 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const viewer = await viewerFor(request, requestId);
  if (viewer instanceof NextResponse) return viewer;
  const query = request.nextUrl.searchParams;
  try {
    const classId = query.get('classId');
    const sessionId = query.get('sessionId');
    const choices = query.get('choices');
    const preview = query.get('preview');
    if (preview) {
      const problemId = query.get('problemId');
      if (preview.length > 200 || problemId === '' || (problemId?.length ?? 0) > 200) {
        return publicApiError(requestId, 400, 'invalid_request', '请求无效。');
      }
      return publicApiSuccess(
        requestId,
        problemId === null
          ? { problems: await getClassSessionProblemPreviews(viewer, preview) }
          : { problem: await getClassSessionProblemPreview(viewer, preview, problemId) },
      );
    }
    if (query.get('claim')) {
      return publicApiSuccess(
        requestId,
        await listClaimableCourses(viewer, (query.get('q') || '').slice(0, 80)),
      );
    }
    const answers = query.get('answers');
    const importFor = query.get('importFor');
    const liveCourse = query.get('liveCourse');
    if (answers) {
      const problemId = query.get('problemId');
      const userId = query.get('userId');
      if (!problemId || !userId) {
        return publicApiError(requestId, 400, 'invalid_request', '请求无效。');
      }
      return publicApiSuccess(
        requestId,
        await getSessionStudentAnswers(viewer, answers, problemId, userId),
      );
    }
    if (importFor) {
      return publicApiSuccess(requestId, {
        classes: await listImportableSessions(viewer, importFor),
      });
    }
    if (liveCourse) {
      return publicApiSuccess(requestId, {
        live: await getLiveSessionForCourse(viewer, liveCourse),
      });
    }
    if (choices) {
      return publicApiSuccess(requestId, {
        problems: await listSessionProblemChoices(viewer, choices),
      });
    }
    if (sessionId) {
      return publicApiSuccess(requestId, await getClassSessionDashboard(viewer, sessionId));
    }
    if (classId) return publicApiSuccess(requestId, await getClassOverview(viewer, classId));
    return publicApiSuccess(requestId, await listTeachableCourses(viewer));
  } catch (error) {
    return classroomError(requestId, error);
  }
}

const id = z.string().trim().min(1).max(200);
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open-class'), courseId: id }),
  z.object({ action: z.literal('claim'), courseId: id }),
  z.object({ action: z.literal('release-claim'), courseId: id }),
  z.object({ action: z.literal('add-member'), classId: id, email: z.string().trim().email() }),
  z.object({ action: z.literal('remove-member'), classId: id, userId: id }),
  z.object({ action: z.literal('reset-code'), classId: id }),
  z.object({ action: z.literal('start-session'), classId: id, sessionId: id.optional() }),
  z.object({ action: z.literal('create-draft'), classId: id }),
  z.object({ action: z.literal('delete-draft'), sessionId: id }),
  z.object({ action: z.literal('delete-ended'), sessionId: id }),
  z.object({ action: z.literal('rename'), sessionId: id, name: z.string().trim().min(1).max(80) }),
  z.object({
    action: z.literal('import-sessions'),
    classId: id,
    sessionIds: z.array(id).min(1).max(40),
  }),
  z.object({ action: z.literal('add'), sessionId: id, problemIds: z.array(id).min(1).max(400) }),
  z.object({ action: z.literal('remove'), sessionId: id, problemId: id }),
  z.object({
    action: z.literal('reorder'),
    sessionId: id,
    problemIds: z.array(id).min(1).max(400),
  }),
  z.object({ action: z.literal('lock'), sessionId: id, locked: z.boolean() }),
  z.object({ action: z.literal('end'), sessionId: id }),
]);

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const viewer = await viewerFor(request, requestId);
  if (viewer instanceof NextResponse) return viewer;
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return publicApiError(requestId, 400, 'invalid_request', '请求无效。');
  const input = parsed.data;
  try {
    switch (input.action) {
      case 'claim':
        await claimCourse(viewer, input.courseId);
        return publicApiSuccess(requestId, await listTeachableCourses(viewer));
      case 'release-claim':
        await releaseCourseClaim(viewer, input.courseId);
        return publicApiSuccess(requestId, await listTeachableCourses(viewer));
      case 'open-class':
        return publicApiSuccess(requestId, {
          classId: await ensureCurrentTermClass(viewer, input.courseId),
        });
      case 'add-member':
        await addClassMemberByEmail(viewer, input.classId, input.email);
        return publicApiSuccess(requestId, await getClassOverview(viewer, input.classId));
      case 'remove-member':
        await removeClassMember(viewer, input.classId, input.userId);
        return publicApiSuccess(requestId, await getClassOverview(viewer, input.classId));
      case 'reset-code':
        await resetClassJoinCode(viewer, input.classId);
        return publicApiSuccess(requestId, await getClassOverview(viewer, input.classId));
      case 'start-session':
        return publicApiSuccess(requestId, {
          sessionId: await startClassSession(viewer, input.classId, input.sessionId),
        });
      case 'create-draft':
        return publicApiSuccess(requestId, {
          sessionId: await createDraftSession(viewer, input.classId),
        });
      case 'delete-draft':
        return publicApiSuccess(requestId, {
          classId: await deleteDraftSession(viewer, input.sessionId),
        });
      case 'delete-ended':
        return publicApiSuccess(
          requestId,
          await getClassOverview(viewer, await deleteEndedSession(viewer, input.sessionId)),
        );
      case 'import-sessions':
        await importSessionsAsDrafts(viewer, input.classId, input.sessionIds);
        return publicApiSuccess(requestId, await getClassOverview(viewer, input.classId));
      default: {
        const { sessionId, ...rest } = input;
        await applyClassSessionAction(viewer, sessionId, rest);
        return publicApiSuccess(requestId, await getClassSessionDashboard(viewer, sessionId));
      }
    }
  } catch (error) {
    return classroomError(requestId, error);
  }
}
