import { NextResponse } from 'next/server';
import {
  createSpeedupUserSession,
  SpeedupSsoError,
  verifySpeedupCallback,
} from '@/lib/server/speedup-sso';
import { enrollSpeedupStudentCourse } from '@/lib/server/speedup-course-provisioning';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CALLBACK_SECURITY_HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
} as const;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function errorPage(status: number, message: string): NextResponse {
  const safeMessage = escapeHtml(message);
  const html = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>无法进入 AI 课程</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #f6f7fb; color: #151821; }
      main { width: min(100%, 520px); border: 1px solid #e3e6ee; border-radius: 20px; padding: 32px; background: #fff; box-shadow: 0 18px 48px rgb(30 38 60 / 10%); }
      .mark { display: grid; width: 44px; height: 44px; place-items: center; border-radius: 14px; background: #fff0f0; color: #c33131; font-size: 24px; font-weight: 700; }
      h1 { margin: 20px 0 10px; font-size: 24px; letter-spacing: -.02em; }
      p { margin: 0; color: #606778; line-height: 1.7; }
      a { display: inline-flex; margin-top: 24px; border-radius: 12px; padding: 10px 16px; background: #171a22; color: #fff; font-weight: 600; text-decoration: none; }
    </style>
  </head>
  <body>
    <main>
      <div class="mark" aria-hidden="true">!</div>
      <h1>无法进入 AI 课程</h1>
      <p>${safeMessage}</p>
      <a href="/">返回 Syntara</a>
    </main>
  </body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: {
      ...CALLBACK_SECURITY_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
    },
  });
}

function validCourseId(value: string): boolean {
  return /^\d{1,20}$/.test(value);
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get('code')?.trim() || '';
  const courseId = requestUrl.searchParams.get('courseId')?.trim() || '';

  if (!code || code.length > 512 || !validCourseId(courseId)) {
    return errorPage(400, '回调参数不完整，请返回 Speedup 后重新点击“进入 AI 课程”。');
  }

  try {
    const identity = await verifySpeedupCallback(code, courseId);
    const session = await createSpeedupUserSession(identity);
    let destination: URL;
    if (identity.role === 'TEACHER') {
      destination = new URL('/teacher/speedup-courses', requestUrl.origin);
      destination.searchParams.set('requestedCourseId', identity.course.id);
    } else {
      const localCourseId = await enrollSpeedupStudentCourse(session.userId, identity.course.id);
      destination = new URL('/learn', requestUrl.origin);
      destination.searchParams.set('courseId', localCourseId);
    }

    const response = NextResponse.redirect(destination, 303);
    for (const [header, value] of Object.entries(CALLBACK_SECURITY_HEADERS)) {
      response.headers.set(header, value);
    }
    response.cookies.set({
      name: '__Secure-next-auth.session-token',
      value: session.sessionToken,
      httpOnly: true,
      maxAge: session.maxAge,
      path: '/',
      sameSite: 'lax',
      secure: true,
    });
    return response;
  } catch (error) {
    if (error instanceof SpeedupSsoError) {
      return errorPage(error.status, error.publicMessage);
    }
    console.error('[speedup-sso] callback failed', error instanceof Error ? error.message : error);
    return errorPage(500, '登录过程中发生了意外错误，请返回 Speedup 后重试。');
  }
}
