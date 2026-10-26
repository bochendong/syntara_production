import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';
import {
  applyCourseMultipartCheckup,
  dismissCourseMultipartCheckup,
  scanCourseMultipartCheckup,
} from '@/lib/server/notebook-problems/multipart-checkup';

/** 小问体检：GET 列出建议；POST apply 按老师勾选的建议修复，dismiss 忽略。 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const suggestions = await scanCourseMultipartCheckup({ userId: auth.userId, courseId: id });
    return NextResponse.json({ suggestions });
  });
}

const actionSchema = z.object({
  action: z.enum(['apply', 'dismiss']),
  suggestionIds: z.array(z.string().trim().min(1).max(4000)).min(1).max(50),
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
});

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const payload = actionSchema.safeParse(await req.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json({ error: '请求格式不对。' }, { status: 400 });
    }
    if (payload.data.action === 'dismiss') {
      return NextResponse.json(
        await dismissCourseMultipartCheckup({
          userId: auth.userId,
          courseId: id,
          suggestionIds: payload.data.suggestionIds,
        }),
      );
    }
    const needsModel = payload.data.suggestionIds.some((sid) => sid.startsWith('split:'));
    const result = await runWithRequestContext(
      req,
      '/api/courses/problems/multipart-checkup',
      async () =>
        applyCourseMultipartCheckup({
          userId: auth.userId,
          courseId: id,
          suggestionIds: payload.data.suggestionIds,
          model: needsModel
            ? (await resolveModelFromHeaders(req, { allowOpenAIModelOverride: true })).model
            : undefined,
          language: payload.data.language,
        }),
    );
    return NextResponse.json(result);
  });
}
