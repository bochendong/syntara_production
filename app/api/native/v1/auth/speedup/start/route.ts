import { NextRequest, NextResponse } from 'next/server';
import { resolveNativeAccessPolicy } from '@/lib/server/native-access-policy';
import { normalizeNativeUserCode } from '@/lib/server/native-device-auth';
import {
  createNativeSpeedupState,
  NATIVE_SPEEDUP_COOKIE,
  NATIVE_SPEEDUP_STATE_SECONDS,
} from '@/lib/server/native-speedup-login';

export const runtime = 'nodejs';

export function GET(request: NextRequest) {
  if (resolveNativeAccessPolicy(process.env) !== 'speedup') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  const code = normalizeNativeUserCode(request.nextUrl.searchParams.get('user_code') || '');
  if (!code) return NextResponse.json({ error: 'Invalid device code' }, { status: 400 });
  try {
    const destination = new URL(process.env.SPEEDUP_NATIVE_LOGIN_URL || '');
    if (destination.protocol !== 'https:' || destination.username || destination.password)
      throw new Error('Invalid login URL');
    const response = NextResponse.redirect(destination, 303);
    response.headers.set('cache-control', 'no-store');
    response.cookies.set(NATIVE_SPEEDUP_COOKIE, createNativeSpeedupState(code), {
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: NATIVE_SPEEDUP_STATE_SECONDS,
    });
    return response;
  } catch {
    return NextResponse.json({ error: 'Speedup 登录尚未配置，请联系管理员。' }, { status: 503 });
  }
}
