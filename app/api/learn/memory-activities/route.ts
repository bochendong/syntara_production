import { NextRequest } from 'next/server';
import { readMemoryJobActivities } from '@/features/background-jobs/server/memory-activity';
import { requireUserId } from '@/lib/server/api-auth';
import { prisma } from '@/lib/server/prisma';

export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };

export async function GET(request: NextRequest): Promise<Response> {
  try {
    const auth = await requireUserId();
    if (auth.response) return auth.response;
    const courseId = request.nextUrl.searchParams.get('courseId')?.trim();
    if (!courseId || courseId.length > 200)
      return Response.json({ error: '缺少课程编号。' }, { status: 400, headers });
    const activities = await readMemoryJobActivities(prisma, auth.userId, courseId);
    return Response.json({ ownerId: auth.userId, activities }, { headers });
  } catch {
    // This polling endpoint must not expose database or provider diagnostics.
    return Response.json({ error: '记忆动态暂时无法同步。' }, { status: 503, headers });
  }
}
