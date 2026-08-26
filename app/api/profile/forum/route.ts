import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

const profileSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  image: z.string().trim().max(200_000).optional(),
});

const LOCAL_DEMO_STUDENT_EMAILS = ['student@example.com', 'student@test.local'];

export async function PATCH(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const payload = profileSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json({ error: 'Invalid profile payload' }, { status: 400 });
    }

    const currentUser = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, email: true },
    });
    if (!currentUser) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const data: { name?: string; image?: string } = {};
    if (payload.data.name) data.name = payload.data.name;
    if (payload.data.image) data.image = payload.data.image;
    if (!Object.keys(data).length) return NextResponse.json({ ok: true });

    const email = currentUser.email?.trim().toLowerCase() || '';
    await prisma.user.updateMany({
      where: LOCAL_DEMO_STUDENT_EMAILS.includes(email)
        ? { email: { in: LOCAL_DEMO_STUDENT_EMAILS } }
        : { id: auth.userId },
      data,
    });

    return NextResponse.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } });
  });
}
