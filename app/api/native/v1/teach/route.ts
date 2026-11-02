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
  ensureCurrentTermClass,
  getClassOverview,
  getClassSessionDashboard,
  listSessionProblemChoices,
  listTeachableCourses,
  removeClassMember,
  resetClassJoinCode,
  startClassSession,
  type ClassroomViewer,
} from '@/lib/server/teacher-classroom';

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
    select: { role: true },
  });
  return { userId: principal.userId, role: user?.role ?? null } satisfies ClassroomViewer;
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

/** ?classId= 班级；?sessionId= 上课大屏；?choices=<sessionId> 可以发的题；都没有 = 课程列表。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const viewer = await viewerFor(request, requestId);
  if (viewer instanceof NextResponse) return viewer;
  const query = request.nextUrl.searchParams;
  try {
    const classId = query.get('classId');
    const sessionId = query.get('sessionId');
    const choices = query.get('choices');
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
const itemAction = (action: 'close' | 'reopen' | 'reveal' | 'remove') =>
  z.object({ action: z.literal(action), sessionId: id, itemId: id });

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('open-class'), courseId: id }),
  z.object({ action: z.literal('add-member'), classId: id, email: z.string().trim().email() }),
  z.object({ action: z.literal('remove-member'), classId: id, userId: id }),
  z.object({ action: z.literal('reset-code'), classId: id }),
  z.object({ action: z.literal('start-session'), classId: id }),
  z.object({
    action: z.literal('push'),
    sessionId: id,
    problemIds: z.array(id).min(1).max(30),
  }),
  itemAction('close'),
  itemAction('reopen'),
  itemAction('reveal'),
  itemAction('remove'),
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
          sessionId: await startClassSession(viewer, input.classId),
        });
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
