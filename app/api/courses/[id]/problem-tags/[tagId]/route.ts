import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import {
  requireProblemTagCourseAccess,
  updateProblemTagNode,
} from '@/features/problem-tags/server/problem-tag-service';

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  parentId: z.string().trim().min(1).optional(),
  aliases: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  confirmAssignments: z.boolean().optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; tagId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId, tagId } = await context.params;
    if (!(await requireProblemTagCourseAccess(prisma, auth.userId, courseId, true))) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return NextResponse.json({ error: 'Invalid tag update' }, { status: 400 });
    }
    const tag = await updateProblemTagNode({ prisma, courseId, tagId, ...parsed.data });
    return NextResponse.json({ tag });
  });
}
