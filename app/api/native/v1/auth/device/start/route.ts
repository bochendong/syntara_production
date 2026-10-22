import { NextRequest } from 'next/server';

import {
  nativeAuthRouteError,
  readNativeAuthJson,
  requiredNativeAuthString,
} from '@/lib/server/native-auth-route';
import { startNativeDeviceAuthorization } from '@/lib/server/native-device-auth';
import { nativeBrowserVerificationUrl } from '@/lib/server/native-login-url';
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
    const verificationUri = nativeBrowserVerificationUrl(
      request.url,
      authorization.userCode,
      process.env,
    );
    return publicApiSuccess(
      requestId,
      {
        ...authorization,
        verificationUri,
        verificationUriComplete: verificationUri,
      },
      { status: 201 },
    );
  } catch (error) {
    return nativeAuthRouteError(requestId, error);
  }
}
