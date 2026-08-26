import { NextResponse } from 'next/server';
import { headers } from 'next/headers';
import { requireServerSession } from '@/lib/server/auth';
import { resolveAdminStudentPreviewId } from '@/lib/server/admin-student-preview';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

interface RequireUserIdOptions {
  ensureFallbackUser?: boolean;
}

type RequireUserIdSuccess = {
  response?: undefined;
  userId: string;
  userEmail: string | null;
  previewedByAdmin?: true;
  localHeaderFallback?: true;
};

type RequireUserIdFailure = {
  response: NextResponse;
  userId: undefined;
  userEmail: undefined;
  previewedByAdmin?: undefined;
  localHeaderFallback?: undefined;
};

type RequireUserIdResult = RequireUserIdSuccess | RequireUserIdFailure;

function localHeaderFallbackAllowed(host: string | null) {
  if (process.env.NODE_ENV === 'production') return false;
  return /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host || '');
}

function localDemoRoleFromSession(userId: string, role: unknown) {
  if (!userId.startsWith('local-demo-')) return null;
  if (role === 'TEACHER' || userId.startsWith('local-demo-teacher-')) return 'TEACHER';
  if (role === 'STUDENT' || role === 'USER' || userId.startsWith('local-demo-student-')) {
    return 'STUDENT';
  }
  return null;
}

function decodeHeaderValue(value: string | null) {
  if (!value) return '';
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}

function normalizedHeaderRole(value: string) {
  const role = value.trim().toUpperCase();
  if (role === 'ADMIN' || role === 'TEACHER' || role === 'STUDENT') return role;
  return 'STUDENT';
}

async function localHeaderFallbackUser(): Promise<RequireUserIdSuccess | null> {
  const requestHeaders = await headers();
  if (!localHeaderFallbackAllowed(requestHeaders.get('host'))) return null;
  const userId = requestHeaders.get('x-syntara-user-id')?.trim();
  if (!userId || userId.length > 200) return null;
  const prisma = getOptionalPrisma();
  if (!prisma) return null;
  const user = await prisma.user.findFirst({
    where: { id: userId, isActive: true },
    select: { id: true, email: true },
  });
  if (!user) {
    const email = decodeHeaderValue(requestHeaders.get('x-syntara-user-email')).toLowerCase();
    const name = decodeHeaderValue(requestHeaders.get('x-syntara-user-name'));
    const role = normalizedHeaderRole(decodeHeaderValue(requestHeaders.get('x-syntara-user-role')));
    if (!email && !userId.startsWith('local-demo-')) return null;
    let created: { id: string; email: string | null };
    try {
      created = await prisma.user.upsert({
        where: { id: userId },
        create: {
          id: userId,
          email: email || `${userId}@local.invalid`,
          name: name || email.split('@')[0] || '论坛成员',
          role,
          isActive: true,
        },
        update: {
          email: email || `${userId}@local.invalid`,
          name: name || email.split('@')[0] || '论坛成员',
          role,
          isActive: true,
        },
        select: { id: true, email: true },
      });
    } catch {
      if (!email) return null;
      created = await prisma.user.update({
        where: { email },
        data: {
          name: name || email.split('@')[0] || '论坛成员',
          role,
          isActive: true,
        },
        select: { id: true, email: true },
      });
    }
    return {
      userId: created.id,
      userEmail: created.email?.trim().toLowerCase() || null,
      localHeaderFallback: true,
    };
  }
  return {
    userId: user.id,
    userEmail: user.email?.trim().toLowerCase() || null,
    localHeaderFallback: true,
  };
}

export async function requireUserId(
  _options: RequireUserIdOptions = {},
): Promise<RequireUserIdResult> {
  const requestHeaders = await headers();
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
        };
      }
    }
  }

  const fallback = await localHeaderFallbackUser();
  if (fallback) return fallback;

  const session = await requireServerSession();
  const userId = session?.user?.id?.trim();
  if (userId) {
    const prisma = getOptionalPrisma();
    const existingUser = prisma
      ? await prisma.user.findFirst({
          where: { id: userId, isActive: true },
          select: { id: true, email: true },
        })
      : null;
    if (existingUser) {
      return {
        userId: existingUser.id,
        userEmail: existingUser.email?.trim().toLowerCase() || null,
      };
    }

    const demoRole = localHeaderFallbackAllowed(requestHeaders.get('host'))
      ? localDemoRoleFromSession(userId, session?.user?.role)
      : null;
    if (prisma && demoRole) {
      const email = session?.user?.email?.trim().toLowerCase() || `${userId}@local.invalid`;
      const name =
        session?.user?.name?.trim() ||
        email.split('@')[0]?.trim() ||
        (demoRole === 'TEACHER' ? '本地老师' : '本地学生');
      let user: { id: string; email: string | null };
      try {
        user = await prisma.user.upsert({
          where: { id: userId },
          create: {
            id: userId,
            email,
            name,
            image: session?.user?.image || null,
            role: demoRole,
            isActive: true,
          },
          update: {
            email,
            name,
            image: session?.user?.image || null,
            role: demoRole,
            isActive: true,
          },
          select: { id: true, email: true },
        });
      } catch {
        user = await prisma.user.update({
          where: { email },
          data: {
            name,
            image: session?.user?.image || null,
            role: demoRole,
            isActive: true,
          },
          select: { id: true, email: true },
        });
      }
      return {
        userId: user.id,
        userEmail: user.email?.trim().toLowerCase() || null,
      };
    }

    // Database-backed NextAuth sessions can only reference an existing user.
    // Re-running the compatibility upsert/credit initialization on every API
    // request adds several remote database round trips to read-only routes.
    return {
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
      userId: undefined,
      userEmail: undefined,
    };
  }

  return {
    response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    userId: undefined,
    userEmail: undefined,
  };
}
