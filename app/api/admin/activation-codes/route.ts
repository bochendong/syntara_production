import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import {
  createNativeActivationCodes,
  listNativeActivationCodes,
  NativeActivationError,
} from '@/lib/server/native-activation';

export const runtime = 'nodejs';

function routeError(error: unknown) {
  if (error instanceof NativeActivationError) {
    return apiError('INVALID_REQUEST', error.status, error.message);
  }
  return apiError('INTERNAL_ERROR', 500, error instanceof Error ? error.message : String(error));
}

export async function GET(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  const raw = new URL(request.url).searchParams.get('filter');
  const filter = raw === 'unused' || raw === 'used' ? raw : 'all';
  try {
    return apiSuccess(await listNativeActivationCodes(filter));
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  const body = (await request.json().catch(() => null)) as {
    count?: unknown;
    note?: unknown;
  } | null;
  try {
    const codes = await createNativeActivationCodes({
      count: typeof body?.count === 'number' ? body.count : Number(body?.count),
      note: typeof body?.note === 'string' ? body.note : null,
      createdBy: admin.identity.email || admin.identity.userId,
    });
    return apiSuccess({ codes });
  } catch (error) {
    return routeError(error);
  }
}
