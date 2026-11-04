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
  getStudentClassroomState,
  joinClassroomByCode,
  joinClassroomSession,
} from '@/lib/server/teacher-classroom';

export const runtime = 'nodejs';

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

/** 学生端（网页 / iPad / 本地版）：正在上的课、上过的课和里面的题。手机不调用。 */
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  if (!getOptionalPrisma()) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Classroom is unavailable.');
  }
  return publicApiSuccess(requestId, await getStudentClassroomState(principal.userId));
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('join-code'), code: z.string().trim().min(1).max(20) }),
  z.object({ action: z.literal('join-session'), sessionId: z.string().trim().min(1).max(200) }),
]);

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  if (!getOptionalPrisma()) {
    return publicApiError(requestId, 503, 'auth_not_configured', 'Classroom is unavailable.');
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return publicApiError(requestId, 400, 'invalid_request', '请求无效。');
  try {
    const joined =
      parsed.data.action === 'join-code'
        ? await joinClassroomByCode(principal.userId, parsed.data.code)
        : {
            kind: 'session' as const,
            ...(await joinClassroomSession(principal.userId, parsed.data.sessionId)),
          };
    return publicApiSuccess(requestId, {
      joined,
      ...(await getStudentClassroomState(principal.userId)),
    });
  } catch (error) {
    return classroomError(requestId, error);
  }
}
