import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireServerSession } from '@/lib/server/auth';
import {
  getNativeActivationStatus,
  NativeActivationError,
  redeemNativeActivationCode,
} from '@/lib/server/native-activation';

export const runtime = 'nodejs';

function activationRouteError(error: unknown) {
  if (error instanceof NativeActivationError) {
    return apiError('INVALID_REQUEST', error.status, error.message, error.code);
  }
  console.error('[native-activation] request failed', error);
  return apiError('INTERNAL_ERROR', 500, '激活失败，请稍后重试。');
}

export async function GET() {
  const session = await requireServerSession();
  if (!session?.user?.id) return apiError('INVALID_REQUEST', 401, '请先登录。');
  try {
    return apiSuccess(await getNativeActivationStatus(session.user.id));
  } catch (error) {
    return activationRouteError(error);
  }
}

export async function POST(request: Request) {
  const session = await requireServerSession();
  if (!session?.user?.id) return apiError('INVALID_REQUEST', 401, '请先登录再输入激活码。');
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = typeof body?.code === 'string' ? body.code : '';
  if (!code.trim()) return apiError('MISSING_REQUIRED_FIELD', 400, '请输入激活码。');
  try {
    return apiSuccess(await redeemNativeActivationCode(session.user.id, code));
  } catch (error) {
    return activationRouteError(error);
  }
}
