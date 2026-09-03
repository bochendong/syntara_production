import { NextResponse } from 'next/server';
import { requireServerSession } from '@/lib/server/auth';
import { prisma } from '@/lib/server/prisma';
import { parsePhoneNumber } from '@/lib/profile/phone';

export async function GET() {
  const session = await requireServerSession();
  if (!session?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, phone: true, image: true },
  });
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });
  return NextResponse.json(user, { headers: { 'Cache-Control': 'private, no-store' } });
}

function cleanProfileValue(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

export async function PATCH(request: Request) {
  const session = await requireServerSession();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as {
    name?: unknown;
    image?: unknown;
    phone?: unknown;
  } | null;
  if (!payload) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

  const name = cleanProfileValue(payload.name, 60);
  const image = cleanProfileValue(payload.image, 2_000);
  const phoneProvided = Object.prototype.hasOwnProperty.call(payload, 'phone');
  const phone = phoneProvided ? parsePhoneNumber(payload.phone) : null;
  if (phone && !phone.ok) {
    return NextResponse.json({ error: phone.error }, { status: 400 });
  }
  if (!name && !image && !phoneProvided) {
    return NextResponse.json({ error: 'Name, image, or phone is required' }, { status: 400 });
  }
  if (image?.startsWith('data:')) {
    return NextResponse.json({ error: '头像文件过大，请选择预设头像' }, { status: 400 });
  }

  const user = await prisma.user.update({
    where: { id: session.user.id },
    data: {
      ...(name ? { name } : {}),
      ...(image ? { image } : {}),
      ...(phone?.ok ? { phone: phone.value } : {}),
    },
    select: { id: true, name: true, email: true, phone: true, image: true },
  });
  return NextResponse.json(user, { headers: { 'Cache-Control': 'private, no-store' } });
}
