import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireCourseForumAccess } from '@/features/course-forum/server/course-forum-access';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const { courseId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;
    const unresolvedCount = await prisma.courseForumPost.count({
      where: { courseId, resolvedAt: null },
    });
    return NextResponse.json(
      { unresolvedCount },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
