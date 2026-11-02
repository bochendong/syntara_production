import { NextResponse } from 'next/server';
import { z } from 'zod';

import {
  applyClassSessionAction,
  getClassSessionDashboard,
  listSessionProblemChoices,
} from '@/lib/server/teacher-classroom';
import { classroomRoute } from '@/lib/server/teacher-classroom-route';

export const runtime = 'nodejs';

type Context = { params: Promise<{ sessionId: string }> };

/** 上课大屏：在场的人、发过的题、每个人的提交。?choices=1 返回可以发的题。 */
export async function GET(request: Request, context: Context) {
  return classroomRoute(async (viewer) => {
    const { sessionId } = await context.params;
    if (new URL(request.url).searchParams.get('choices') === '1') {
      return NextResponse.json({ problems: await listSessionProblemChoices(viewer, sessionId) });
    }
    return NextResponse.json(await getClassSessionDashboard(viewer, sessionId));
  });
}

const itemAction = (action: 'close' | 'reopen' | 'reveal' | 'remove') =>
  z.object({ action: z.literal(action), itemId: z.string().trim().min(1).max(200) });

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('push'),
    problemIds: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  }),
  itemAction('close'),
  itemAction('reopen'),
  itemAction('reveal'),
  itemAction('remove'),
  z.object({ action: z.literal('lock'), locked: z.boolean() }),
  z.object({ action: z.literal('end') }),
]);

export async function POST(request: Request, context: Context) {
  return classroomRoute(async (viewer) => {
    const { sessionId } = await context.params;
    const parsed = actionSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '请求无效。' }, { status: 400 });
    await applyClassSessionAction(viewer, sessionId, parsed.data);
    return NextResponse.json(await getClassSessionDashboard(viewer, sessionId));
  });
}
