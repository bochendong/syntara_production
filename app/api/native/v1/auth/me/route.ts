import { NextRequest } from 'next/server';

import { nativeAuthRouteError } from '@/lib/server/native-auth-route';
import { authenticateNativeDeviceRequest } from '@/lib/server/native-device-auth';
import { publicApiRequestId, publicApiSuccess } from '@/lib/server/public-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  try {
    const principal = await authenticateNativeDeviceRequest(request);
    return publicApiSuccess(requestId, {
      sessionId: principal.sessionId,
      user: principal.user,
    });
  } catch (error) {
    return nativeAuthRouteError(requestId, error);
  }
}
