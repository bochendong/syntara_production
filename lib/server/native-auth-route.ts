import { NativeAuthError } from '@/lib/server/native-device-auth';
import { publicApiError, type PublicApiErrorCode } from '@/lib/server/public-api';

export function nativeAuthRouteError(requestId: string, error: unknown) {
  if (error instanceof NativeAuthError) {
    return publicApiError(requestId, error.status, error.code as PublicApiErrorCode, error.message);
  }
  console.error('[native-auth] request failed', error);
  return publicApiError(requestId, 500, 'internal_error', 'Native login request failed.');
}

export async function readNativeAuthJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > 16 * 1_024) {
    throw new NativeAuthError(413, 'invalid_request', 'Native login request is too large.');
  }
  const value = (await request.json().catch(() => null)) as unknown;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new NativeAuthError(400, 'invalid_request', 'Invalid Native login request.');
  }
  return value as Record<string, unknown>;
}

export function requiredNativeAuthString(body: Record<string, unknown>, key: string): string {
  const value = typeof body[key] === 'string' ? body[key].trim() : '';
  if (!value) {
    throw new NativeAuthError(400, 'invalid_request', `Missing ${key}.`);
  }
  return value;
}
