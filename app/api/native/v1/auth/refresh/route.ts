import { NextRequest } from 'next/server';

import {
  nativeAuthRouteError,
  readNativeAuthJson,
  requiredNativeAuthString,
} from '@/lib/server/native-auth-route';
import { refreshNativeDeviceSession } from '@/lib/server/native-device-auth';
import { publicApiRequestId, publicApiSuccess } from '@/lib/server/public-api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  try {
    const body = await readNativeAuthJson(request);
    const result = await refreshNativeDeviceSession(requiredNativeAuthString(body, 'refreshToken'));
    return publicApiSuccess(requestId, result);
  } catch (error) {
    return nativeAuthRouteError(requestId, error);
  }
}
