import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import {
  listCourseProblemTagTree,
  requireProblemTagCourseAccess,
} from '@/features/problem-tags/server/problem-tag-service';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId } = await context.params;
    const role = await requireProblemTagCourseAccess(prisma, auth.userId, courseId);
    if (!role) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    const tree = await listCourseProblemTagTree(prisma, courseId);
    return NextResponse.json({ tree, canManage: role === 'owner' });
  });
}
