import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { cloneStoreCourseForUser } from '@/lib/server/services/store-purchase-service';
import { recordTutorialStep } from '@/lib/server/onboarding';
import { CourseAdmissionError } from '@/lib/server/course-admissions';

const bodySchema = z.object({
  sourceCourseId: z.string().trim().min(1),
});

export async function POST(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { userId } = auth;

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await cloneStoreCourseForUser(prisma, userId, parsed.data.sourceCourseId).catch(
      (error) => {
        if (error instanceof CourseAdmissionError) return { status: 'approval_required' as const };
        throw error;
      },
    );
    if (result.status === 'approval_required')
      return NextResponse.json({ error: '请在商城填写加入申请，等待老师审核。' }, { status: 403 });
    if (result.status === 'not_found') {
      return NextResponse.json({ error: '课程不存在或未在商城公开' }, { status: 404 });
    }
    await recordTutorialStep(prisma, userId, parsed.data.sourceCourseId, 'store');

    return NextResponse.json(
      { course: result.item },
      { status: result.status === 'created' ? 201 : 200 },
    );
  });
}
