import { NextRequest, NextResponse } from 'next/server';

import { runNativeChat } from '@/features/native-ai/server/run-chat';
import { nativeChatRequestSchema } from '@/features/native-ai/server/schema';
import {
  publicApiError,
  publicApiRequestId,
  requireNativePlatformApi,
} from '@/lib/server/public-api';
import { withRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';
export const maxDuration = 180;
// 最多四张压缩后的照片、三个文件（各约 10 MB），加上按问题挑出的课程资料。
const MAX_NATIVE_CHAT_BODY_BYTES = 48 * 1024 * 1024;

/** 手机 / iPad / 桌面端的助教聊天（和网页端 /api/learn/turn 是两套独立的 AI）。 */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_NATIVE_CHAT_BODY_BYTES) {
    return publicApiError(requestId, 413, 'invalid_request', 'Native chat request exceeds 48 MB.');
  }

  const parsed = nativeChatRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Invalid native chat request.',
      parsed.error.flatten(),
    );
  }

  try {
    const stream = await withRequestContext(
      {
        userId: principal.userId,
        route: '/api/native/v2/chat',
        operationCode: 'native_chat',
        chargeReason: '原生端助教聊天',
        courseId: parsed.data.scope === 'general' ? undefined : parsed.data.course.id,
        courseName: parsed.data.scope === 'general' ? undefined : parsed.data.course.name,
      },
      () => runNativeChat(request, parsed.data),
    );
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        'X-Request-Id': requestId,
      },
    });
  } catch (error) {
    return publicApiError(
      requestId,
      500,
      'generation_failed',
      error instanceof Error ? error.message : 'Native chat failed.',
    );
  }
}
