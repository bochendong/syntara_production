import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { listMyCourseApplications } from '@/lib/server/course-admissions';

/** 自己还没进的课的加入申请（待批准、未通过），网页课程列表上显示，可以改了重发。 */
export async function GET() {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    return NextResponse.json(await listMyCourseApplications(prisma, auth.userId), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  });
}
