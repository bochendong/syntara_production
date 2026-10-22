import type { NextRequest } from 'next/server';
import { authenticateNativeBrowserRequest } from '@/lib/server/native-browser-auth';
import { nativeAuthRouteError } from '@/lib/server/native-auth-route';
import { publicApiRequestId, publicApiSuccess } from '@/lib/server/public-api';
export const runtime = 'nodejs';
export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  try {
    const { user } = await authenticateNativeBrowserRequest(request);
    return publicApiSuccess(requestId, { user });
  } catch (error) {
    return nativeAuthRouteError(requestId, error);
  }
}
