import { NextResponse } from 'next/server';
import { requireServerSession } from '@/lib/server/auth';

interface RequireUserIdOptions {
  ensureFallbackUser?: boolean;
}

export async function requireUserId(_options: RequireUserIdOptions = {}) {
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

  return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
}
