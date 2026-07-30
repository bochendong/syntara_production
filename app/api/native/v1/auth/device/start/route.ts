import { NextRequest } from 'next/server';

import {
  nativeAuthRouteError,
  readNativeAuthJson,
  requiredNativeAuthString,
} from '@/lib/server/native-auth-route';
import { startNativeDeviceAuthorization } from '@/lib/server/native-device-auth';
import { publicApiRequestId, publicApiSuccess } from '@/lib/server/public-api';

export const runtime = 'nodejs';

function requestFingerprint(request: NextRequest): string {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return (
    forwardedFor ||
    request.headers.get('x-real-ip')?.trim() ||
    request.headers.get('cf-connecting-ip')?.trim() ||
    request.headers.get('user-agent')?.trim() ||
    'unknown-client'
  );
}

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  try {
    const body = await readNativeAuthJson(request);
    const authorization = await startNativeDeviceAuthorization({
      deviceId: requiredNativeAuthString(body, 'deviceId'),
      deviceName: requiredNativeAuthString(body, 'deviceName'),
      requestFingerprint: requestFingerprint(request),
    });
    const verificationUri = new URL('/native-login', request.url);
    verificationUri.searchParams.set('user_code', authorization.userCode);
    return publicApiSuccess(
      requestId,
      {
        ...authorization,
        verificationUri: verificationUri.toString(),
        verificationUriComplete: verificationUri.toString(),
      },
      { status: 201 },
    );
  } catch (error) {
    return nativeAuthRouteError(requestId, error);
  }
}
