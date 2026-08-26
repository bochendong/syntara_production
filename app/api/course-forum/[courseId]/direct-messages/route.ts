import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  forumAuthor,
  isSameForumIdentity,
} from '@/features/course-forum/server/course-forum-access';
import {
  canMessageCommunityMember,
  requireDirectMessageAccess,
} from '@/features/course-forum/server/direct-message-access';

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

async function canMessageCourseMember(courseId: string, ownerId: string, userId: string) {
  if (userId === ownerId) return true;
  const enrollment = await prisma.courseEnrollment.findUnique({
    where: { userId_courseId: { userId, courseId } },
    select: { id: true },
  });
  return Boolean(enrollment);
}

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const { courseId } = await context.params;
    const access = await requireDirectMessageAccess(courseId);
    if (!access.ok) return access.response;

    const [courseMembers, threads] = await Promise.all([
      prisma.course.findUnique({
        where: { id: courseId },
        select: {
          owner: { select: { id: true, name: true, email: true, image: true, role: true } },
          enrollments: {
            orderBy: { joinedAt: 'desc' },
            select: {
              user: { select: { id: true, name: true, email: true, image: true, role: true } },
            },
          },
        },
      }),
      prisma.directMessageThread.findMany({
        where: {
          courseId,
          OR: [{ userAId: access.userId }, { userBId: access.userId }],
        },
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

    if (!courseMembers) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const contacts = new Map<
      string,
      {
        user: { id: string; name: string | null; email: string | null; image: string | null };
        threadId: string | null;
        lastMessageAt: Date | null;
        lastMessageBody: string | null;
        lastMessageMine: boolean;
        isCourseMember: boolean;
      }
    >();

    const addCourseMember = (user: {
      id: string;
      name: string | null;
      email: string | null;
      image: string | null;
    }) => {
      if (isSameForumIdentity(access.user, user)) return;
      const existing = contacts.get(user.id);
      contacts.set(user.id, {
        user,
        threadId: existing?.threadId ?? null,
        lastMessageAt: existing?.lastMessageAt ?? null,
        lastMessageBody: existing?.lastMessageBody ?? null,
        lastMessageMine: existing?.lastMessageMine ?? false,
        isCourseMember: true,
      });
    };

    addCourseMember(courseMembers.owner);
    for (const enrollment of courseMembers.enrollments) addCourseMember(enrollment.user);

    for (const thread of threads) {
      const otherUser = thread.userAId === access.userId ? thread.userB : thread.userA;
      if (isSameForumIdentity(access.user, otherUser)) continue;
      const latestMessage = thread.messages[0] ?? null;
      const existing = contacts.get(otherUser.id);
      contacts.set(otherUser.id, {
        user: otherUser,
        threadId: thread.id,
        lastMessageAt: latestMessage?.createdAt ?? thread.lastMessageAt ?? thread.updatedAt,
        lastMessageBody: latestMessage?.body ?? null,
        lastMessageMine: latestMessage ? latestMessage.senderId === access.userId : false,
        isCourseMember: existing?.isCourseMember ?? false,
      });
    }

    const sortedContacts = Array.from(contacts.values()).sort((a, b) => {
      const aTime = a.lastMessageAt?.getTime() ?? 0;
      const bTime = b.lastMessageAt?.getTime() ?? 0;
      if (aTime !== bTime) return bTime - aTime;
      return forumAuthor(a.user, access.course.ownerId).name.localeCompare(
        forumAuthor(b.user, access.course.ownerId).name,
        'zh-CN',
      );
    });

    return NextResponse.json(
      {
        contacts: sortedContacts.map((contact) => ({
          user: forumAuthor(contact.user, access.course.ownerId),
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

export async function POST(request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const { courseId } = await context.params;
    const access = await requireDirectMessageAccess(courseId);
    if (!access.ok) return access.response;

    const payload = startDirectMessageSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }

    const recipientId = payload.data.recipientId;
    if (recipientId === access.userId) {
      return NextResponse.json({ error: '不能给自己发送私信' }, { status: 400 });
    }

    const recipient = await prisma.user.findUnique({
      where: { id: recipientId },
      select: { id: true, name: true, email: true, image: true, role: true },
    });
    if (!recipient) return NextResponse.json({ error: '用户不存在' }, { status: 404 });
    if (isSameForumIdentity(access.user, recipient)) {
      return NextResponse.json({ error: '不能给自己发送私信' }, { status: 400 });
    }

    const [recipientInCourse, recipientInCommunity] = await Promise.all([
      canMessageCourseMember(courseId, access.course.ownerId, recipientId),
      canMessageCommunityMember(courseId, access.userId, recipientId),
    ]);
    if (!recipientInCourse && !recipientInCommunity) {
      return NextResponse.json(
        { error: '只能给本课程或同 community 成员发送私信' },
        { status: 403 },
      );
    }

    const [userAId, userBId] = orderedParticipants(access.userId, recipientId);
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
          courseId: true,
          userA: { select: { id: true, name: true, email: true, image: true, role: true } },
          userB: { select: { id: true, name: true, email: true, image: true, role: true } },
        },
      });
      if (messageBody) {
        await tx.directMessage.create({
          data: { threadId: nextThread.id, senderId: access.userId, body: messageBody },
        });
        await tx.directMessageThread.update({
          where: { id: nextThread.id },
          data: { lastMessageAt: now },
        });
      }
      return nextThread;
    });

    const otherUser = thread.userA.id === access.userId ? thread.userB : thread.userA;
    return NextResponse.json(
      {
        threadId: thread.id,
        courseId: thread.courseId,
        recipient: forumAuthor(otherUser, access.course.ownerId),
      },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
