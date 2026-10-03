import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import { NextRequest } from 'next/server';

import {
  nativeAuthRouteError,
  readNativeAuthJson,
  requiredNativeAuthString,
} from '@/lib/server/native-auth-route';
import { pollNativeDeviceAuthorization } from '@/lib/server/native-device-auth';
import { publicApiRequestId, publicApiSuccess } from '@/lib/server/public-api';

export const runtime = 'nodejs';

async function auditedPOST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  try {
    const body = await readNativeAuthJson(request);
    const result = await pollNativeDeviceAuthorization(
      requiredNativeAuthString(body, 'deviceCode'),
    );
    return publicApiSuccess(requestId, result, {
      status: result.status === 'pending' ? 202 : 200,
    });
  } catch (error) {
    return nativeAuthRouteError(requestId, error);
  }
}

export const POST = withAiFailureAudit(auditedPOST);
