import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { CourseAdmissionError } from '@/lib/server/course-admissions';
import { joinNativeStoreCourse } from '@/lib/server/native-store';

const bodySchema = z.object({
  answers: z
    .record(z.string().max(60), z.string().max(500))
    .refine((value) => Object.keys(value).length <= 8)
    .default({}),
});

/**
 * 网页商城「获取」需要老师同意的课：提交（或改了重发）加入申请。和 App 走同一个 requestCourseEntry，
 * 同一个人一门课只有一条申请；直接加入的课也会在这里直接加入。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const body = bodySchema.safeParse(await request.json().catch(() => ({})));
    if (!body.success) return NextResponse.json({ error: '填写内容无效。' }, { status: 400 });
    try {
      const result = await joinNativeStoreCourse(prisma, auth.userId, id, body.data.answers);
      return NextResponse.json({ status: result.status });
    } catch (error) {
      if (error instanceof CourseAdmissionError)
        return NextResponse.json({ error: error.message }, { status: error.status });
      throw error;
    }
  });
}
