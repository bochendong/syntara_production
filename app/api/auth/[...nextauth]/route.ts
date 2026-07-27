import NextAuth from 'next-auth';
import { type NextRequest, NextResponse } from 'next/server';
import { authOptions } from '@/lib/server/auth';

const handler = NextAuth(authOptions);

type NextAuthRouteContext = { params: Promise<{ nextauth: string[] }> };

/** DB 不可达时 NextAuth 可能返回 500 且空 body，SessionProvider 会 CLIENT_FETCH_ERROR；降级为未登录会话以便页面可用。 */
const NULL_SESSION = {
  user: null,
  expires: '1970-01-01T00:00:00.000Z',
} as const;

function isSessionPath(pathname: string) {
  return pathname === '/api/auth/session' || pathname.endsWith('/api/auth/session');
}

function isAuthLogPath(pathname: string) {
  return pathname.includes('/api/auth/_log');
}

async function safeAuthResponse(
  request: NextRequest,
  context: NextAuthRouteContext,
  invoke: (req: NextRequest, ctx: NextAuthRouteContext) => ReturnType<typeof handler>,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  try {
    const res = await invoke(request, context);
    if (res.status >= 500 && isSessionPath(pathname)) {
      const text = await res.clone().text();
      if (!text.trim()) {
        return NextResponse.json(NULL_SESSION);
      }
      try {
        JSON.parse(text);
      } catch {
        return NextResponse.json(NULL_SESSION);
      }
    }
    if (res.status >= 500 && isAuthLogPath(pathname)) {
      const text = await res.clone().text();
      if (!text.trim()) {
        return NextResponse.json({});
      }
    }
    return res;
  } catch (err) {
    console.error('[nextauth]', pathname, err);
    if (isSessionPath(pathname)) {
      return NextResponse.json(NULL_SESSION);
    }
    if (isAuthLogPath(pathname)) {
      return NextResponse.json({});
    }
    return NextResponse.json({ error: 'Authentication service error' }, { status: 503 });
  }
}

export async function GET(request: NextRequest, context: NextAuthRouteContext) {
  return safeAuthResponse(request, context, handler);
}

export async function POST(request: NextRequest, context: NextAuthRouteContext) {
  return safeAuthResponse(request, context, handler);
}
