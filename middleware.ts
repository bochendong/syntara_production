import { NextResponse, type NextRequest } from 'next/server';

const CLASSROOM_TASK_HISTORY_PATH = /^\/classroom\/([^/]+)\/tasks(?:\/.*)?$/;

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  // The public staging backend exposes the App gateway and its login flow only.
  if (process.env.SYNTARA_APP_ENV === 'staging') {
    if (pathname === '/test/app' || pathname === '/test/app/') {
      const url = request.nextUrl.clone();
      url.pathname = '/native-web/index.html';
      return NextResponse.rewrite(url);
    }
    if (pathname === '/') return NextResponse.redirect(new URL('/test', request.url));
    if (pathname === '/test' || pathname === '/test/') {
      const url = request.nextUrl.clone();
      url.pathname = '/native-test';
      return NextResponse.rewrite(url);
    }
    const authPath =
      /^\/api\/auth\/(?:csrf|session|providers|signin(?:\/google)?|signout|callback\/google|error)\/?$/;
    const allowed =
      pathname.startsWith('/api/native/') ||
      authPath.test(pathname) ||
      pathname.startsWith('/_next/') ||
      pathname === '/native-login' ||
      pathname === '/native-test' ||
      pathname === '/api/health' ||
      (!pathname.startsWith('/api/') && pathname.includes('.'));
    if (!allowed) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.next();
  }
  const match = request.nextUrl.pathname.match(CLASSROOM_TASK_HISTORY_PATH);
  if (match?.[1]) {
    const url = request.nextUrl.clone();
    url.pathname = `/classroom/${match[1]}`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  if (process.env.TEACHER_ONLY_LAUNCH !== 'true') return NextResponse.next();
  const isStaticAsset = pathname.includes('.');
  const isAllowedPath =
    pathname.startsWith('/api/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/sso/callback' ||
    pathname === '/speedup/signed-out' ||
    pathname === '/login' ||
    pathname === '/learn' ||
    pathname === '/test/frontend' ||
    pathname.startsWith('/student/') ||
    pathname === '/student' ||
    pathname === '/calendar' ||
    pathname.startsWith('/calendar/') ||
    pathname.startsWith('/classroom/') ||
    pathname.startsWith('/course/') ||
    pathname === '/teacher' ||
    pathname.startsWith('/teacher/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/');
  if (isStaticAsset || isAllowedPath) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = pathname === '/' ? '/login' : '/teacher';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
