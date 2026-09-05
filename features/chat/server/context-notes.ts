import type { PrismaClient } from '@/lib/server/generated-prisma';
import { prisma } from '@/lib/server/prisma';
import { findCourseConversationAccessRole } from '@/features/learn-conversations/server/course-conversation-repository';
import { resolveCourseNotebookAccess } from '@/lib/server/repositories/course-enrollment-repository';

/** Small readable notes. Live scores, calendars and submissions stay in their own stores. */
export async function readCourseNotes(db: PrismaClient, userId: string, courseId: string) {
  return db.studyMemory
    .findMany({
      where: {
        ownerId: userId,
        OR: [{ courseId }, { targetType: 'platform', courseId: null }],
        scope: 'private',
        status: 'active',
      },
      select: { id: true, title: true, text: true, sourceReferences: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 5,
    })
    .then((notes) => notes.map((n) => ({ ...n, text: n.text.slice(0, 1000) })));
}

export async function readNotebookReplyContext(args: {
  userId?: string;
  notebookId: string;
  question: string;
}) {
  if (!args.userId || !process.env.DATABASE_URL)
    return { available: false, notes: [], sections: [] };
  const notebook = await prisma.notebook.findFirst({
    where: { id: args.notebookId, removedAt: null },
    select: { id: true, courseId: true },
  });
  if (!notebook?.courseId) return { available: false, notes: [], sections: [] };
  const role = await findCourseConversationAccessRole(prisma, args.userId, notebook.courseId);
  if (!role) return { available: false, notes: [], sections: [] };
  if (role === 'enrolled') {
    const access = await resolveCourseNotebookAccess(prisma, args.userId, notebook.courseId);
    if (!access?.allowedNotebookIds.includes(notebook.id))
      return { available: false, notes: [], sections: [] };
  }
  const terms = [
    ...new Set(args.question.match(/[A-Za-z_][A-Za-z_0-9]{2,}|[\u4e00-\u9fa5]{2,8}/g) || []),
  ].slice(0, 6);
  const [notes, sections, shared] = await Promise.all([
    readCourseNotes(prisma, args.userId, notebook.courseId),
    prisma.markdownNotebookSection.findMany({
      where: {
        notebookId: notebook.id,
        ...(terms.length
          ? {
              OR: terms.flatMap((term) => [
                { title: { contains: term, mode: 'insensitive' as const } },
                { markdown: { contains: term, mode: 'insensitive' as const } },
              ]),
            }
          : {}),
      },
      select: { id: true, title: true, markdown: true, order: true },
      orderBy: { order: 'asc' },
      take: 4,
    }),
    prisma.studyMemory.findMany({
      where: {
        courseId: notebook.courseId,
        scope: 'public',
        status: 'active',
        OR: [{ notebookId: notebook.id }, { notebookId: null }],
      },
      select: { id: true, title: true, text: true },
      orderBy: { updatedAt: 'desc' },
      take: 4,
    }),
  ]);
  return {
    available: true,
    courseId: notebook.courseId,
    notes,
    shared: shared.map((n) => ({ ...n, text: n.text.slice(0, 1500) })),
    sections: sections.map((s) => ({
      ...s,
      markdown: s.markdown.slice(0, 4000),
      excerpt: s.markdown.length > 4000,
    })),
    gaps: !sections.length ? ['未检索到明确的讲义原文；不要声称核对过该来源。'] : [],
  };
}

export async function readConversationRecall(
  db: PrismaClient,
  args: {
    ownerId: string;
    courseId: string;
    conversationId?: string;
    query?: string;
    beforeSequence?: string;
  },
) {
  if (args.conversationId) {
    const conversation = await db.courseConversation.findFirst({
      where: {
        id: args.conversationId,
        ownerId: args.ownerId,
        courseId: args.courseId,
        deletedAt: null,
      },
      select: { id: true, title: true, summaryText: true },
    });
    if (!conversation) return { found: false };
    const messages = await db.courseConversationMessage.findMany({
      where: {
        conversationId: conversation.id,
        deletedAt: null,
        ...(args.beforeSequence ? { sequence: { lt: BigInt(args.beforeSequence) } } : {}),
      },
      orderBy: { sequence: 'desc' },
      take: 9,
      select: { id: true, plainText: true, role: true, createdAt: true, sequence: true },
    });
    return {
      found: true,
      conversation,
      messages: messages
        .slice(0, 8)
        .reverse()
        .map((m) => ({
          ...m,
          sequence: m.sequence.toString(),
          plainText: m.plainText?.slice(0, 3000),
        })),
      nextCursor: messages.length > 8 ? messages[7].sequence.toString() : null,
      excerpt: true,
    };
  }
  return db.courseConversation
    .findMany({
      where: {
        ownerId: args.ownerId,
        courseId: args.courseId,
        deletedAt: null,
        ...(args.query
          ? {
              OR: [
                { title: { contains: args.query, mode: 'insensitive' } },
                { summaryText: { contains: args.query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: 8,
      select: { id: true, title: true, summaryText: true, summaryUpdatedAt: true },
    })
    .then((rows) => rows.map((r) => ({ ...r, summaryText: r.summaryText?.slice(0, 1200) })));
}
