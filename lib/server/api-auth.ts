import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireServerSession } from '@/lib/server/auth';
import { ensureUserForApi } from '@/lib/server/ensure-user';

interface RequireUserIdOptions {
  ensureFallbackUser?: boolean;
}

export async function requireUserId(options: RequireUserIdOptions = {}) {
  const session = await requireServerSession();
  const userId = session?.user?.id?.trim();
  if (userId) {
    // Database-backed NextAuth sessions can only reference an existing user.
    // Re-running the compatibility upsert/credit initialization on every API
    // request adds several remote database round trips to read-only routes.
    return {
      userId,
      userEmail: session?.user?.email?.trim().toLowerCase() || null,
    } as const;
  }

  // Temporary compatibility path: allow existing client-side auth store userId.
  const h = await headers();
  const fallbackUserId = h.get('x-user-id')?.trim();
  if (fallbackUserId) {
    const fallbackEmail = h.get('x-user-email')?.trim().toLowerCase() || null;
    if (options.ensureFallbackUser === false) {
      return { userId: fallbackUserId, userEmail: fallbackEmail } as const;
    }
    const resolvedUserId =
      (await ensureUserForApi({
        userId: fallbackUserId,
        email: fallbackEmail,
        name: h.get('x-user-name'),
      })) || fallbackUserId;
    return { userId: resolvedUserId, userEmail: fallbackEmail } as const;
  }

  return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
}
