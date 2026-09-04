import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { listCourseProblemAttempts } from '@/features/problems/server/service';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; problemId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id, problemId } = await context.params;
    const attempts = await listCourseProblemAttempts({
      userId: auth.userId,
      courseId: id,
      problemId,
    });
    return NextResponse.json({ attempts });
  });
}
