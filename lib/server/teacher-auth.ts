import { NextResponse } from 'next/server';
import { requireServerSession } from '@/lib/server/auth';

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
  return {
    userId: user.id,
    email: user.email?.trim().toLowerCase() || null,
    role: user.role,
  } as const;
}
