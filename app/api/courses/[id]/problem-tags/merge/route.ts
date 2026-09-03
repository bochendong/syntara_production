import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import {
  mergeProblemTagNodes,
  requireProblemTagCourseAccess,
} from '@/features/problem-tags/server/problem-tag-service';

const mergeSchema = z.object({
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId } = await context.params;
    if (!(await requireProblemTagCourseAccess(prisma, auth.userId, courseId, true))) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const parsed = mergeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid merge request' }, { status: 400 });
    await mergeProblemTagNodes({ prisma, courseId, ...parsed.data });
    return NextResponse.json({ ok: true });
  });
}
