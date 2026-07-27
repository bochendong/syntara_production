import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { findOwnedCourse } from '@/lib/server/repositories/course-repository';
import { syncUnlinkedCourseKnowledgeProjection } from '@/lib/server/unlinked-course-knowledge-projection';

export const maxDuration = 300;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const course = await findOwnedCourse(prisma, auth.userId, id);
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    const result = await syncUnlinkedCourseKnowledgeProjection({
      prisma,
      courseId: id,
      ownerId: auth.userId,
    });
    const knowledgeSyncCompleted = result.available && result.synced;
    return NextResponse.json(
      {
        ok: knowledgeSyncCompleted,
        courseId: id,
        knowledgeSyncCompleted,
        result,
      },
      {
        status: knowledgeSyncCompleted ? 200 : 503,
        ...(knowledgeSyncCompleted ? {} : { headers: { 'Retry-After': '5' } }),
      },
    );
  });
}
