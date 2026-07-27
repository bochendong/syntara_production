import crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@/lib/server/generated-prisma';
import { toPrismaJson, toPrismaNullableJson } from '@/lib/server/prisma-json';

const LEARN_CONVERSATION_TARGET_PREFIX = 'learn:';

export type LearnConversationStoreClient = PrismaClient | Prisma.TransactionClient;

export type PersistedCourseQuestionTurn = {
  session: {
    id: string;
    conversationId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    currentRevision: number;
  };
  userMessageId: string;
  assistantMessageId: string;
  question: string;
  answer: string;
  replayed: boolean;
};

export type CourseQuestionConversationHistory = {
  session: PersistedCourseQuestionTurn['session'] | null;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    text: string;
    createdAt: number;
  }>;
};

export type LearnConversationStoreErrorCode =
  | 'conversation_deleted'
  | 'idempotency_conflict'
  | 'message_conflict';

export class LearnConversationStoreError extends Error {
  constructor(
    readonly code: LearnConversationStoreErrorCode,
    readonly status: 409,
    message: string,
  ) {
    super(message);
    this.name = 'LearnConversationStoreError';
  }
}

function learnTargetId(sessionId: string): string {
  return `${LEARN_CONVERSATION_TARGET_PREFIX}${sessionId}`;
}

function conversationMeta(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function conversationRevision(value: unknown): number {
  const revision = conversationMeta(value).clientRevision;
  return typeof revision === 'number' && Number.isSafeInteger(revision) && revision > 0
    ? revision
    : 0;
}

function stableMessageId(
  prefix: string,
  args: {
    userId: string;
    courseId: string;
    sessionId: string;
    idempotencyKey: string;
    role: 'user' | 'assistant';
  },
): string {
  const digest = crypto
    .createHash('sha256')
    .update([args.userId, args.courseId, args.sessionId, args.idempotencyKey, args.role].join('\0'))
    .digest('hex')
    .slice(0, 32);
  return `${prefix}_${digest}`;
}

type ConversationRow = {
  id: string;
  title: string | null;
  targetId: string | null;
  meta: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

async function lockLearnConversation(
  prisma: LearnConversationStoreClient,
  args: { userId: string; courseId: string; sessionId: string },
): Promise<void> {
  const lockKey = [
    LEARN_CONVERSATION_TARGET_PREFIX,
    args.userId,
    args.courseId,
    args.sessionId,
  ].join(':');
  await prisma.$queryRawUnsafe(
    'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))::text AS "locked"',
    lockKey,
  );
}

async function findLearnConversation(
  prisma: LearnConversationStoreClient,
  args: { userId: string; courseId: string; sessionId: string },
): Promise<ConversationRow | null> {
  const rows = await prisma.$queryRawUnsafe<ConversationRow[]>(
    `
      SELECT "id", "title", "targetId", "meta", "createdAt", "updatedAt"
      FROM "Conversation"
      WHERE "ownerId" = $1
        AND "courseId" = $2
        AND "targetId" = $3
        AND "kind"::text = 'course'
      ORDER BY "updatedAt" DESC
      LIMIT 1
    `,
    args.userId,
    args.courseId,
    learnTargetId(args.sessionId),
  );
  return rows[0] ?? null;
}

export async function loadCourseQuestionConversationHistory(
  prisma: PrismaClient,
  args: {
    userId: string;
    courseId: string;
    sessionId: string;
    maxMessages?: number;
  },
): Promise<CourseQuestionConversationHistory> {
  const conversation = await findLearnConversation(prisma, args);
  if (!conversation) return { session: null, messages: [] };
  const meta = conversationMeta(conversation.meta);
  if (meta.deleted === true) {
    throw new LearnConversationStoreError(
      'conversation_deleted',
      409,
      'The requested course conversation was deleted.',
    );
  }
  const maxMessages = Math.max(1, Math.min(args.maxMessages ?? 20, 40));
  const rows = await prisma.message.findMany({
    where: {
      conversationId: conversation.id,
      ownerId: args.userId,
      role: { in: ['user', 'assistant'] },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: maxMessages,
    select: {
      id: true,
      role: true,
      plainText: true,
      createdAt: true,
    },
  });
  return {
    session: {
      id: args.sessionId,
      conversationId: conversation.id,
      title: conversation.title?.trim() || '新对话',
      createdAt: new Date(conversation.createdAt).getTime(),
      updatedAt: new Date(conversation.updatedAt).getTime(),
      currentRevision: conversationRevision(meta),
    },
    messages: rows
      .reverse()
      .filter(
        (row): row is typeof row & { role: 'user' | 'assistant' } =>
          row.role === 'user' || row.role === 'assistant',
      )
      .map((row) => ({
        id: row.id,
        role: row.role,
        text: row.plainText?.trim() || '',
        createdAt: row.createdAt.getTime(),
      }))
      .filter((row) => row.text.length > 0),
  };
}

function messageContent(args: {
  text: string;
  learningActions?: unknown[];
  artifacts?: unknown[];
  publicTrace?: unknown;
}) {
  return {
    type: 'learn_message',
    text: args.text,
    plan: null,
    progressProposal: null,
    pendingAction: null,
    lecturePrompt: null,
    lectureDeck: null,
    learningActions: args.learningActions ?? null,
    artifacts: args.artifacts ?? null,
    publicTrace: args.publicTrace ?? null,
    attachments: [],
  };
}

/**
 * Append one public-API question/answer pair to the exact same durable course
 * conversation used by `/learn`. Deterministic message IDs make a completed
 * request replay-safe, while the advisory lock keeps revision and title updates
 * aligned with the browser sync route.
 */
export async function appendCourseQuestionTurnInTransaction(
  tx: Prisma.TransactionClient,
  args: {
    userId: string;
    courseId: string;
    sessionId: string;
    idempotencyKey: string;
    requestId: string;
    requestPayloadHash: string;
    title: string;
    question: string;
    answer: string;
    learningActions?: unknown[];
    artifacts?: unknown[];
    publicTrace?: unknown;
  },
): Promise<PersistedCourseQuestionTurn> {
  await lockLearnConversation(tx, args);
  const existing = await findLearnConversation(tx, args);
  const existingMeta = conversationMeta(existing?.meta);
  if (existingMeta.deleted === true) {
    throw new LearnConversationStoreError(
      'conversation_deleted',
      409,
      'The requested course conversation was deleted.',
    );
  }

  const userMessageId = stableMessageId('learn_api_user', {
    ...args,
    role: 'user',
  });
  const assistantMessageId = stableMessageId('learn_api_assistant', {
    ...args,
    role: 'assistant',
  });
  const existingMessages = await tx.message.findMany({
    where: {
      id: { in: [userMessageId, assistantMessageId] },
    },
    select: {
      id: true,
      ownerId: true,
      conversationId: true,
      plainText: true,
      meta: true,
    },
  });
  const conflictingMessage = existingMessages.find((message) => {
    const meta = conversationMeta(message.meta);
    return (
      !existing ||
      message.ownerId !== args.userId ||
      message.conversationId !== existing.id ||
      meta.courseId !== args.courseId ||
      meta.sessionId !== args.sessionId ||
      meta.idempotencyKey !== args.idempotencyKey
    );
  });
  if (conflictingMessage) {
    throw new LearnConversationStoreError(
      'message_conflict',
      409,
      `Course question message ID conflict: ${conflictingMessage.id}`,
    );
  }
  const mismatchedPayload = existingMessages.find(
    (message) => conversationMeta(message.meta).requestPayloadHash !== args.requestPayloadHash,
  );
  if (mismatchedPayload) {
    throw new LearnConversationStoreError(
      'idempotency_conflict',
      409,
      'The Idempotency-Key was already used with a different course question payload.',
    );
  }

  const currentRevision = conversationRevision(existingMeta);
  const hasUserMessage = existingMessages.some((message) => message.id === userMessageId);
  const hasAssistantMessage = existingMessages.some((message) => message.id === assistantMessageId);
  if (hasUserMessage !== hasAssistantMessage) {
    throw new LearnConversationStoreError(
      'message_conflict',
      409,
      'The persisted course question turn is incomplete and cannot be replayed safely.',
    );
  }
  const replayed = hasUserMessage && hasAssistantMessage;
  const nextRevision = replayed ? currentRevision : Math.max(1, currentRevision + 1);
  const effectiveTitle =
    existing?.title?.trim() && existing.title.trim() !== '新对话'
      ? existing.title.trim()
      : args.title.trim().slice(0, 200) || '新对话';
  const nextMeta = {
    ...existingMeta,
    source: 'learn',
    lastWriteSource: 'course_question_api',
    sessionId: args.sessionId,
    clientRevision: nextRevision,
    deleted: false,
  };

  if (replayed && existing) {
    const persistedQuestion =
      existingMessages.find((message) => message.id === userMessageId)?.plainText ?? args.question;
    const persistedAnswer =
      existingMessages.find((message) => message.id === assistantMessageId)?.plainText ??
      args.answer;
    return {
      session: {
        id: args.sessionId,
        conversationId: existing.id,
        title: existing.title?.trim() || effectiveTitle,
        createdAt: new Date(existing.createdAt).getTime(),
        updatedAt: new Date(existing.updatedAt).getTime(),
        currentRevision,
      },
      userMessageId,
      assistantMessageId,
      question: persistedQuestion,
      answer: persistedAnswer,
      replayed: true,
    };
  }

  let conversation: ConversationRow;
  if (existing) {
    const rows = await tx.$queryRawUnsafe<ConversationRow[]>(
      `
        UPDATE "Conversation"
        SET "title" = $1,
            "meta" = CAST($2 AS JSONB),
            "updatedAt" = NOW()
        WHERE "id" = $3 AND "ownerId" = $4
        RETURNING "id", "title", "targetId", "meta", "createdAt", "updatedAt"
      `,
      effectiveTitle,
      JSON.stringify(nextMeta),
      existing.id,
      args.userId,
    );
    conversation = rows[0];
  } else {
    const conversationId = `learn_conversation_${crypto.randomUUID().replace(/-/g, '')}`;
    const rows = await tx.$queryRawUnsafe<ConversationRow[]>(
      `
        INSERT INTO "Conversation" (
          "id", "ownerId", "courseId", "kind", "targetId", "title", "meta", "createdAt", "updatedAt"
        )
        VALUES ($1, $2, $3, 'course', $4, $5, CAST($6 AS JSONB), NOW(), NOW())
        RETURNING "id", "title", "targetId", "meta", "createdAt", "updatedAt"
      `,
      conversationId,
      args.userId,
      args.courseId,
      learnTargetId(args.sessionId),
      effectiveTitle,
      JSON.stringify(nextMeta),
    );
    conversation = rows[0];
  }

  const userCreatedAt = new Date();
  const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
  const messageRows = [
    {
      id: userMessageId,
      role: 'user',
      text: args.question,
      content: messageContent({ text: args.question }),
      createdAt: userCreatedAt,
    },
    {
      id: assistantMessageId,
      role: 'assistant',
      text: args.answer,
      content: messageContent({
        text: args.answer,
        learningActions: args.learningActions,
        artifacts: args.artifacts,
        publicTrace: args.publicTrace,
      }),
      createdAt: assistantCreatedAt,
    },
  ];
  for (const message of messageRows) {
    await tx.message.upsert({
      where: { id: message.id },
      create: {
        id: message.id,
        conversationId: conversation.id,
        ownerId: args.userId,
        role: message.role,
        content: toPrismaJson(message.content),
        plainText: message.text,
        createdAt: message.createdAt,
        meta: toPrismaNullableJson({
          source: 'learn',
          writeSource: 'course_question_api',
          courseId: args.courseId,
          sessionId: args.sessionId,
          idempotencyKey: args.idempotencyKey,
          requestId: args.requestId,
          requestPayloadHash: args.requestPayloadHash,
        }),
      },
      update: {},
    });
  }

  return {
    session: {
      id: args.sessionId,
      conversationId: conversation.id,
      title: conversation.title?.trim() || effectiveTitle,
      createdAt: new Date(conversation.createdAt).getTime(),
      updatedAt: new Date(conversation.updatedAt).getTime(),
      currentRevision: nextRevision,
    },
    userMessageId,
    assistantMessageId,
    question: args.question,
    answer: args.answer,
    replayed: false,
  };
}

export async function persistCourseQuestionTurn(
  prisma: PrismaClient,
  args: Parameters<typeof appendCourseQuestionTurnInTransaction>[1],
): Promise<PersistedCourseQuestionTurn> {
  return prisma.$transaction((tx) => appendCourseQuestionTurnInTransaction(tx, args));
}
