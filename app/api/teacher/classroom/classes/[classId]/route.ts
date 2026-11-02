import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  addClassMemberByEmail,
  getClassOverview,
  removeClassMember,
  resetClassJoinCode,
  startClassSession,
} from '@/lib/server/teacher-classroom';
import { classroomRoute } from '@/lib/server/teacher-classroom-route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ classId: string }> };

/** 班级名单、上过的课、名单 × 题目的答题情况。 */
export async function GET(_request: Request, context: Context) {
  return classroomRoute(async (viewer) => {
    const { classId } = await context.params;
    return NextResponse.json(await getClassOverview(viewer, classId));
  });
}

const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add-member'), email: z.string().trim().email().max(320) }),
  z.object({ action: z.literal('remove-member'), userId: z.string().trim().min(1).max(200) }),
  z.object({ action: z.literal('reset-code') }),
  z.object({ action: z.literal('start-session') }),
]);

export async function POST(request: Request, context: Context) {
  return classroomRoute(async (viewer) => {
    const { classId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '请求无效。' }, { status: 400 });
    const input = parsed.data;
    switch (input.action) {
      case 'add-member':
        await addClassMemberByEmail(viewer, classId, input.email);
        return NextResponse.json({ ok: true });
      case 'remove-member':
        await removeClassMember(viewer, classId, input.userId);
        return NextResponse.json({ ok: true });
      case 'reset-code':
        return NextResponse.json(await resetClassJoinCode(viewer, classId));
      case 'start-session':
        return NextResponse.json({ sessionId: await startClassSession(viewer, classId) });
    }
  });
}
