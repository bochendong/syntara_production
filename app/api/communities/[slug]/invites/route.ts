import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { requireCommunityManager } from '@/lib/server/community-admin';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

const inviteSchema = z.object({
  userId: z.string().trim().min(1).max(160),
});

function orderedParticipants(userId: string, recipientId: string) {
  return [userId, recipientId].sort((a, b) => a.localeCompare(b));
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug } = await context.params;
    const access = await requireCommunityManager(slug, auth.userId);
    if (!access.ok) return access.response;

    const payload = inviteSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success)
      return NextResponse.json({ error: '邀请用户格式不正确' }, { status: 400 });

    const recipientId = payload.data.userId;
    if (recipientId === auth.userId) {
      return NextResponse.json({ error: '不能邀请自己' }, { status: 400 });
    }

    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true, name: true, email: true, isActive: true },
    });
    if (!recipient?.isActive) return NextResponse.json({ error: '用户不存在' }, { status: 404 });

    const existingMember = await prisma.communityMember.findUnique({
      where: { communityId_userId: { communityId: access.community.id, userId: recipientId } },
      select: { id: true },
    });
    if (existingMember)
      return NextResponse.json({ error: '该用户已经在 community 中' }, { status: 400 });

    const [userAId, userBId] = orderedParticipants(auth.userId, recipientId);
    const now = new Date();
    const body = `邀请你加入「${access.community.name}」：/communities/${access.community.slug}`;

    const thread = await prisma.$transaction(async (tx) => {
      const nextThread = await tx.directMessageThread.upsert({
        where: { userAId_userBId: { userAId, userBId } },
        create: { userAId, userBId, lastMessageAt: now },
        update: { lastMessageAt: now },
        select: { id: true },
      });
      await tx.directMessage.create({
        data: { threadId: nextThread.id, senderId: auth.userId, body },
      });
      return nextThread;
    });

    return NextResponse.json(
      { ok: true, threadId: thread.id },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
