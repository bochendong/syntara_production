import { NextResponse } from 'next/server';

export const COURSE_DATABASE_UNAVAILABLE_MESSAGE =
  '课程数据库暂时不可用，当前无法可靠读取已持久化的课程资料。请稍后重试';

export function isDatabaseUnavailableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /P1001|P1017|P2024|connection pool|Can't reach database|ECONNREFUSED|ENOTFOUND|Server has closed the connection/i.test(
    message,
  );
}

/** 将未捕获异常转为 JSON，避免 Next 开发模式返回 HTML 导致前端只能看到「请求失败」 */
export function jsonErrorFromUnknown(err: unknown, status = 500): NextResponse {
  console.error('[api]', err);
  let message = '服务器内部错误';
  let responseStatus = status;
  if (err instanceof Error) {
    message = err.message;
    if (isDatabaseUnavailableError(err)) {
      message = '数据库连接暂时繁忙，页面会自动重试；本地资料仍可继续查看。';
      responseStatus = 503;
    }
  }
  const response = NextResponse.json(
    { error: message, retryable: responseStatus === 503 },
    {
      status: responseStatus,
    },
  );
  if (responseStatus === 503) response.headers.set('retry-after', '5');
  return response;
}

export async function safeRoute(
  fn: () => Promise<Response | NextResponse | undefined>,
): Promise<Response> {
  try {
    const out = await fn();
    if (out == null) {
      return NextResponse.json({ error: '内部错误：路由未返回响应' }, { status: 500 });
    }
    return out;
  } catch (err) {
    return jsonErrorFromUnknown(err);
  }
}
