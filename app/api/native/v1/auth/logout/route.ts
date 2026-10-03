import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import { NextRequest } from 'next/server';

import { nativeAuthRouteError } from '@/lib/server/native-auth-route';
import { revokeNativeDeviceSession } from '@/lib/server/native-device-auth';
import { publicApiRequestId, publicApiSuccess } from '@/lib/server/public-api';

export const runtime = 'nodejs';

async function auditedPOST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  try {
    const result = await revokeNativeDeviceSession(request);
    return publicApiSuccess(requestId, result);
  } catch (error) {
    return nativeAuthRouteError(requestId, error);
  }
}

export const POST = withAiFailureAudit(auditedPOST);
