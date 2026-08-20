import { NextResponse } from 'next/server';
import { requireServerSession } from '@/lib/server/auth';
import { reconcileSpeedupCourseMembershipsIfVerificationStale } from '@/lib/server/speedup-course-provisioning';

const SPEEDUP_TEACHER_ACCESS_MAX_AGE_MS = 20_000;

export async function requireTeacher() {
  const session = await requireServerSession();
  const user = session?.user;
  if (!user?.id) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) } as const;
  }
  if (user.isActive === false || (user.role !== 'TEACHER' && user.role !== 'ADMIN')) {
    return {
      response: NextResponse.json({ error: 'Teacher access required' }, { status: 403 }),
    } as const;
  }
  if (user.role === 'TEACHER' && user.id.startsWith('speedup:')) {
    await reconcileSpeedupCourseMembershipsIfVerificationStale(
      user.id,
      'TEACHER',
      SPEEDUP_TEACHER_ACCESS_MAX_AGE_MS,
    );
  }
  return {
    userId: user.id,
    email: user.email?.trim().toLowerCase() || null,
    role: user.role,
  } as const;
}
