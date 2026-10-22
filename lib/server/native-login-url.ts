/** Railway's request URL may contain the container hostname rather than its public domain. */
export function nativeBrowserVerificationUrl(
  requestUrl: string,
  userCode: string,
  env: Record<string, string | undefined>,
): string {
  const configured = env.NEXTAUTH_URL?.trim();
  if (env.NODE_ENV === 'production' && !configured) {
    throw new Error('NEXTAUTH_URL is required for browser device login.');
  }
  const base = new URL(configured || requestUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
  if (
    base.username ||
    base.password ||
    (base.protocol !== 'https:' &&
      !(env.NODE_ENV !== 'production' && base.protocol === 'http:' && loopback))
  ) {
    throw new Error('Browser device login requires a configured HTTPS origin.');
  }
  const url = new URL('/native-login', base.origin);
  url.searchParams.set('user_code', userCode);
  return url.toString();
}
