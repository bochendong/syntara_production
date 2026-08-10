import type { NextRequest } from 'next/server';

export const INTERNAL_REQUEST_SECRET_HEADER = 'x-syntara-internal-secret';

export function getInternalRequestSecret(): string {
  return (
    process.env.SYNTARA_INTERNAL_REQUEST_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || ''
  );
}

export function markInternalRequestHeaders(headers: Headers): Headers {
  const secret = getInternalRequestSecret();
  if (secret) {
    headers.set(INTERNAL_REQUEST_SECRET_HEADER, secret);
  }
  return headers;
}

export function isTrustedInternalHeaders(headers: Headers | ReadonlyHeaders): boolean {
  const secret = getInternalRequestSecret();
  if (!secret) return false;
  return headers.get(INTERNAL_REQUEST_SECRET_HEADER)?.trim() === secret;
}

export function isTrustedInternalRequest(request: NextRequest): boolean {
  return isTrustedInternalHeaders(request.headers);
}

type ReadonlyHeaders = Pick<Headers, 'get'>;
