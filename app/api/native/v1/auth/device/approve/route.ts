import { NextRequest } from 'next/server';

import {
  nativeAuthRouteError,
  readNativeAuthJson,
  requiredNativeAuthString,
} from '@/lib/server/native-auth-route';
import { approveNativeDeviceAuthorization, NativeAuthError } from '@/lib/server/native-device-auth';
import { requireServerSession } from '@/lib/server/auth';
import { publicApiRequestId, publicApiSuccess } from '@/lib/server/public-api';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  try {
    const session = await requireServerSession();
    if (!session?.user?.id) {
      throw new NativeAuthError(401, 'unauthorized', 'Sign in before authorizing this device.');
    }
    const body = await readNativeAuthJson(request);
    const result = await approveNativeDeviceAuthorization(
      requiredNativeAuthString(body, 'userCode'),
      session.user.id,
    );
    return publicApiSuccess(requestId, result);
  } catch (error) {
    return nativeAuthRouteError(requestId, error);
  }
}
