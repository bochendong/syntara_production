import type { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/server/auth';
import { NativeAuthError } from '@/lib/server/native-device-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { nativeUserAccess, NATIVE_ACCESS_SELECT } from '@/lib/server/native-user-access';

export function nativeBrowserEnabled() {
  return (
    process.env.SYNTARA_APP_ENV === 'staging' &&
    process.env.SYNTARA_NATIVE_ACCESS_POLICY === 'google-test'
  );
}

export async function authenticateNativeBrowserRequest(request: NextRequest) {
  if (!nativeBrowserEnabled())
    throw new NativeAuthError(401, 'unauthorized', 'Browser access is unavailable.');
  // Cookie-authenticated mutations require the configured origin, including DELETE.
  const origin = process.env.NEXTAUTH_URL
    ? new URL(process.env.NEXTAUTH_URL).origin
    : request.nextUrl.origin;
  if (!['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== origin) {
    throw new NativeAuthError(403, 'unauthorized', 'Invalid request origin.');
  }
  const session = await getServerSession(authOptions);
  if (!session?.user?.id)
    throw new NativeAuthError(401, 'unauthorized', 'Please sign in with Google.');
  const prisma = getOptionalPrisma();
  if (!prisma)
    throw new NativeAuthError(503, 'auth_not_configured', 'Account storage is unavailable.');
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      ...NATIVE_ACCESS_SELECT,
      name: true,
      email: true,
      image: true,
    },
  });
  if (!user || (await nativeUserAccess(user)) !== 'allowed') {
    throw new NativeAuthError(403, 'google_required', 'An active Google test account is required.');
  }
  const expectedUser = request.headers.get('x-syntara-user');
  if (expectedUser && expectedUser !== user.id) {
    throw new NativeAuthError(401, 'unauthorized', 'The signed-in account changed. Please reload.');
  }
  return {
    userId: user.id,
    keyId: 'browser-session',
    user: { id: user.id, name: user.name, email: user.email, image: user.image, role: user.role },
  };
}
