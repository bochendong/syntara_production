import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  forumAuthor,
  parseCourseForumImages,
} from '@/features/course-forum/server/course-forum-access';

export const dynamic = 'force-dynamic';

const sendDirectMessageSchema = z.object({
  body: z.string().trim().max(4000),
});

const attachmentSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  byteSize: true,
} as const;

function directMessageAttachment(
  threadId: string,
  attachment: {
    id: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
  },
) {
  const base = `/api/forum/direct-messages/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attachment.id)}`;
  return {
    ...attachment,
    url: base,
    downloadUrl: `${base}?download=1`,
  };
}

async function loadThreadForViewer(threadId: string, viewerId: string) {
  return prisma.directMessageThread.findFirst({
    where: {
      id: threadId,
      OR: [{ userAId: viewerId }, { userBId: viewerId }],
    },
    select: {
      id: true,
      courseId: true,
      userAId: true,
      userBId: true,
      createdAt: true,
      updatedAt: true,
      lastMessageAt: true,
      userA: { select: { id: true, name: true, email: true, image: true, role: true } },
      userB: { select: { id: true, name: true, email: true, image: true, role: true } },
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 200,
        select: {
          id: true,
          senderId: true,
          body: true,
          createdAt: true,
          sender: { select: { id: true, name: true, email: true, image: true, role: true } },
          attachments: { orderBy: { createdAt: 'asc' }, select: attachmentSelect },
        },
      },
    },
  });
}

export async function GET(_request: Request, context: { params: Promise<{ threadId: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { threadId } = await context.params;
    const thread = await loadThreadForViewer(threadId, auth.userId);
    if (!thread) return NextResponse.json({ error: '私信会话不存在' }, { status: 404 });

    const otherUser = thread.userAId === auth.userId ? thread.userB : thread.userA;
    const viewer = thread.userAId === auth.userId ? thread.userA : thread.userB;
    return NextResponse.json(
      {
        thread: {
          id: thread.id,
          courseId: thread.courseId,
          createdAt: thread.createdAt.toISOString(),
          updatedAt: thread.updatedAt.toISOString(),
          lastMessageAt: thread.lastMessageAt?.toISOString() || null,
          viewer: forumAuthor(viewer, ''),
          recipient: forumAuthor(otherUser, ''),
        },
        messages: thread.messages.map((message) => ({
          id: message.id,
          senderId: message.senderId,
          sender: forumAuthor(message.sender, ''),
          body: message.body,
          attachments: message.attachments.map((attachment) =>
            directMessageAttachment(threadId, attachment),
          ),
          createdAt: message.createdAt.toISOString(),
          mine: message.senderId === auth.userId,
        })),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { threadId } = await context.params;
    const thread = await prisma.directMessageThread.findFirst({
      where: {
        id: threadId,
        OR: [{ userAId: auth.userId }, { userBId: auth.userId }],
      },
      select: { id: true },
    });
    if (!thread) return NextResponse.json({ error: '私信会话不存在' }, { status: 404 });

    const formData = await request.formData();
    const payload = sendDirectMessageSchema.safeParse({
      body: String(formData.get('body') || ''),
    });
    if (!payload.success) {
      return NextResponse.json({ error: '消息内容不能超过 4000 个字符' }, { status: 400 });
    }
    const images = await parseCourseForumImages(formData);
    if (!payload.data.body && !images.length) {
      return NextResponse.json({ error: '消息内容不能为空' }, { status: 400 });
    }

    const now = new Date();
    const message = await prisma.$transaction(async (tx) => {
      const nextMessage = await tx.directMessage.create({
        data: {
          threadId,
          senderId: auth.userId,
          body: payload.data.body,
          attachments: images.length
            ? { create: images.map((image) => ({ ...image, uploaderId: auth.userId })) }
            : undefined,
        },
        select: {
          id: true,
          senderId: true,
          body: true,
          createdAt: true,
          sender: { select: { id: true, name: true, email: true, image: true, role: true } },
          attachments: { orderBy: { createdAt: 'asc' }, select: attachmentSelect },
        },
      });
      await tx.directMessageThread.update({
        where: { id: threadId },
        data: { lastMessageAt: now },
      });
      return nextMessage;
    });

    return NextResponse.json(
      {
        message: {
          id: message.id,
          senderId: message.senderId,
          sender: forumAuthor(message.sender, ''),
          body: message.body,
          attachments: message.attachments.map((attachment) =>
            directMessageAttachment(threadId, attachment),
          ),
          createdAt: message.createdAt.toISOString(),
          mine: true,
        },
      },
      { status: 201, headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
