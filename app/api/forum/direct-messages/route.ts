import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  forumAuthor,
  isSameForumIdentity,
} from '@/features/course-forum/server/course-forum-access';

export const dynamic = 'force-dynamic';

const startDirectMessageSchema = z.object({
  recipientId: z.string().trim().min(1).max(160),
  message: z.string().trim().max(4000).optional(),
});

function orderedParticipants(userId: string, recipientId: string) {
  return [userId, recipientId].sort((a, b) => a.localeCompare(b));
}

function dateOrNull(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

export async function GET() {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const [viewer, users, threads] = await Promise.all([
      prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, name: true, email: true, image: true, role: true },
      }),
      prisma.user.findMany({
        where: { isActive: true },
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        take: 120,
        select: { id: true, name: true, email: true, image: true, role: true },
      }),
      prisma.directMessageThread.findMany({
        where: { OR: [{ userAId: auth.userId }, { userBId: auth.userId }] },
        orderBy: [{ lastMessageAt: 'desc' }, { updatedAt: 'desc' }],
        select: {
          id: true,
          userAId: true,
          userBId: true,
          lastMessageAt: true,
          updatedAt: true,
          userA: { select: { id: true, name: true, email: true, image: true, role: true } },
          userB: { select: { id: true, name: true, email: true, image: true, role: true } },
          messages: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { body: true, createdAt: true, senderId: true },
          },
        },
      }),
    ]);

    if (!viewer) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const contacts = new Map<
      string,
      {
        user: {
          id: string;
          name: string | null;
          email: string | null;
          image: string | null;
          role?: string | null;
        };
        threadId: string | null;
        lastMessageAt: Date | null;
        lastMessageBody: string | null;
        lastMessageMine: boolean;
        isCourseMember: boolean;
      }
    >();

    for (const user of users) {
      if (isSameForumIdentity(viewer, user)) continue;
      contacts.set(user.id, {
        user,
        threadId: null,
        lastMessageAt: null,
        lastMessageBody: null,
        lastMessageMine: false,
        isCourseMember: false,
      });
    }

    for (const thread of threads) {
      const otherUser = thread.userAId === auth.userId ? thread.userB : thread.userA;
      if (isSameForumIdentity(viewer, otherUser)) continue;
      const latestMessage = thread.messages[0] ?? null;
      contacts.set(otherUser.id, {
        user: otherUser,
        threadId: thread.id,
        lastMessageAt: latestMessage?.createdAt ?? thread.lastMessageAt ?? thread.updatedAt,
        lastMessageBody: latestMessage?.body ?? null,
        lastMessageMine: latestMessage ? latestMessage.senderId === auth.userId : false,
        isCourseMember: false,
      });
    }

    const sortedContacts = Array.from(contacts.values()).sort((a, b) => {
      const aTime = a.lastMessageAt?.getTime() ?? 0;
      const bTime = b.lastMessageAt?.getTime() ?? 0;
      if (aTime !== bTime) return bTime - aTime;
      return forumAuthor(a.user, '').name.localeCompare(forumAuthor(b.user, '').name, 'zh-CN');
    });

    return NextResponse.json(
      {
        contacts: sortedContacts.map((contact) => ({
          user: forumAuthor(contact.user, ''),
          threadId: contact.threadId,
          lastMessageAt: dateOrNull(contact.lastMessageAt),
          lastMessageBody: contact.lastMessageBody,
          lastMessageMine: contact.lastMessageMine,
          isCourseMember: contact.isCourseMember,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

export async function POST(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const payload = startDirectMessageSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 });

    const [viewer, recipient] = await Promise.all([
      prisma.user.findUnique({
        where: { id: auth.userId },
        select: { id: true, name: true, email: true, image: true, role: true },
      }),
      prisma.user.findUnique({
        where: { id: payload.data.recipientId },
        select: { id: true, name: true, email: true, image: true, role: true },
      }),
    ]);
    if (!viewer || !recipient) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    if (isSameForumIdentity(viewer, recipient)) {
      return NextResponse.json({ error: '不能给自己发送私信' }, { status: 400 });
    }

    const [userAId, userBId] = orderedParticipants(viewer.id, recipient.id);
    const messageBody = payload.data.message?.trim() || '';
    const now = new Date();
    const thread = await prisma.$transaction(async (tx) => {
      const nextThread = await tx.directMessageThread.upsert({
        where: { userAId_userBId: { userAId, userBId } },
        create: {
          userAId,
          userBId,
          lastMessageAt: messageBody ? now : null,
        },
        update: {},
        select: {
          id: true,
          userA: { select: { id: true, name: true, email: true, image: true, role: true } },
          userB: { select: { id: true, name: true, email: true, image: true, role: true } },
        },
      });
      if (messageBody) {
        await tx.directMessage.create({
          data: { threadId: nextThread.id, senderId: viewer.id, body: messageBody },
        });
        await tx.directMessageThread.update({
          where: { id: nextThread.id },
          data: { lastMessageAt: now },
        });
      }
      return nextThread;
    });

    const otherUser = thread.userA.id === viewer.id ? thread.userB : thread.userA;
    return NextResponse.json(
      {
        threadId: thread.id,
        recipient: forumAuthor(otherUser, ''),
      },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
