import { NextResponse } from 'next/server';
import { requireServerSession } from '@/lib/server/auth';
import { resolveAdminStudentPreviewId } from '@/lib/server/admin-student-preview';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

interface RequireUserIdOptions {
  ensureFallbackUser?: boolean;
}

export async function requireUserId(_options: RequireUserIdOptions = {}) {
  const previewStudentId = await resolveAdminStudentPreviewId();
  if (previewStudentId) {
    const admin = await requireAdmin();
    if (!('response' in admin)) {
      const prisma = getOptionalPrisma();
      const student = prisma
        ? await prisma.user.findFirst({
            where: { id: previewStudentId, role: 'STUDENT', isActive: true },
            select: { id: true, email: true },
          })
        : null;
      if (student) {
        return {
          userId: student.id,
          userEmail: student.email?.trim().toLowerCase() || null,
          previewedByAdmin: true,
        } as const;
      }
    }
  }
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
