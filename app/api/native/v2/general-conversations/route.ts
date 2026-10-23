import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { publicApiRequestId, requireNativePlatformApi } from '@/lib/server/public-api';

export const runtime = 'nodejs';
const scope = (ownerId: string) => ({
  ownerId,
  courseId: null,
  notebookId: null,
  kind: 'system' as const,
  targetId: 'general-chat',
});
const writeSchema = z
  .object({
    conversationId: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().min(1).max(200).optional(),
    message: z
      .object({
        id: z.string().uuid(),
        role: z.enum(['user', 'assistant']),
        text: z.string().min(1).max(40000),
      })
      .optional(),
  })
  .strict();
const summary = (row: { id: string; title: string | null; createdAt: Date; updatedAt: Date }) => ({
  id: row.id,
  title: row.title || '新聊天',
  createdAt: row.createdAt.getTime(),
  updatedAt: row.updatedAt.getTime(),
});

export async function GET(request: NextRequest) {
  return safeRoute(async () => {
    const principal = await requireNativePlatformApi(request, publicApiRequestId(request));
    if (principal instanceof NextResponse) return principal;
    const id = request.nextUrl.searchParams.get('id');
    if (!id) {
      const cursor = request.nextUrl.searchParams.get('cursor');
      if (
        cursor &&
        !(await prisma.conversation.findFirst({
          where: { id: cursor, ...scope(principal.userId) },
        }))
      )
        return NextResponse.json({ error: 'Invalid chat cursor' }, { status: 400 });
      const rows = await prisma.conversation.findMany({
        where: scope(principal.userId),
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 101,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const page = rows.slice(0, 100);
      return NextResponse.json({
        conversations: page.map(summary),
        nextCursor: rows.length > 100 ? page.at(-1)!.id : null,
      });
    }
    const conversation = await prisma.conversation.findFirst({
      where: { id, ...scope(principal.userId) },
    });
    if (!conversation) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    const rows = await prisma.message.findMany({
      where: { conversationId: id, ownerId: principal.userId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return NextResponse.json({
      conversation: summary(conversation),
      messages: rows.reverse().map((row) => ({
        id: row.id,
        role: row.role,
        text: row.plainText || '',
        createdAt: row.createdAt.getTime(),
      })),
    });
  });
}

export async function POST(request: NextRequest) {
  return safeRoute(async () => {
    const principal = await requireNativePlatformApi(request, publicApiRequestId(request));
    if (principal instanceof NextResponse) return principal;
    const parsed = writeSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success)
      return NextResponse.json({ error: 'Invalid chat request' }, { status: 400 });
    const { conversationId, title, message } = parsed.data;
    if (!conversationId) {
      if (message) return NextResponse.json({ error: 'Missing conversationId' }, { status: 400 });
      const conversation = await prisma.conversation.create({
        data: { ...scope(principal.userId), title: title || '新聊天' },
      });
      return NextResponse.json({ conversation: summary(conversation) }, { status: 201 });
    }
    if (!message) return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, ...scope(principal.userId) },
    });
    if (!conversation) return NextResponse.json({ error: 'Chat not found' }, { status: 404 });
    const updated = await prisma.$transaction(async (tx) => {
      // Re-sending a saved message is idempotent; an id from another chat cannot be overwritten.
      await tx.message.upsert({
        where: { id: message.id, ownerId: principal.userId, conversationId },
        create: {
          id: message.id,
          conversationId,
          ownerId: principal.userId,
          role: message.role,
          plainText: message.text,
          content: { text: message.text },
        },
        update: { plainText: message.text, content: { text: message.text } },
      });
      return tx.conversation.update({
        where: { id: conversationId, ...scope(principal.userId) },
        data: { updatedAt: new Date() },
      });
    });
    return NextResponse.json({ conversation: summary(updated) });
  });
}

export async function DELETE(request: NextRequest) {
  return safeRoute(async () => {
    const principal = await requireNativePlatformApi(request, publicApiRequestId(request));
    if (principal instanceof NextResponse) return principal;
    const id = request.nextUrl.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    await prisma.conversation.deleteMany({ where: { id, ...scope(principal.userId) } });
    return NextResponse.json({ success: true });
  });
}
