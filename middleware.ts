import { NextResponse, type NextRequest } from 'next/server';

const CLASSROOM_TASK_HISTORY_PATH = /^\/classroom\/([^/]+)\/tasks(?:\/.*)?$/;

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
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
    pathname === '/login' ||
    pathname === '/learn' ||
    pathname.startsWith('/student/') ||
    pathname === '/student' ||
    pathname === '/calendar' ||
    pathname.startsWith('/calendar/') ||
    pathname.startsWith('/classroom/') ||
    pathname === '/teacher' ||
    pathname.startsWith('/teacher/') ||
    pathname === '/admin' ||
    pathname.startsWith('/admin/');
  if (isStaticAsset || isAllowedPath) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = pathname === '/' ? '/teacher/login' : '/teacher';
  url.search = '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)'],
};
