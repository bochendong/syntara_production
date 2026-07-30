import crypto from 'node:crypto';
import type { Prisma, PrismaClient } from '@/lib/server/generated-prisma';
import {
  appendCourseConversationTurnInTransaction,
  courseConversationSessionFromRow,
  CourseConversationRepositoryError,
  loadCourseQuestionHistory,
  type CourseConversationMessageWrite,
} from '@/features/learn-conversations/server/course-conversation-repository';

export type PersistedCourseQuestionTurn = {
  session: {
    id: string;
    conversationId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    currentRevision: number;
    messageCount: number;
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
  summary?: {
    text: string;
    throughSequence: string;
    version: number;
    updatedAt: number | null;
  } | null;
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

function mapRepositoryError(error: unknown): never {
  if (error instanceof CourseConversationRepositoryError) {
    throw new LearnConversationStoreError(error.code, 409, error.message);
  }
  throw error;
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
  const maxMessages = Math.max(1, Math.min(args.maxMessages ?? 20, 40));
  const history = await loadCourseQuestionHistory(prisma, {
    ...args,
    maxMessages,
  });
  if (!history.conversation) {
    return { session: null, messages: [], summary: null };
  }
  if (history.conversation.deletedAt) {
    throw new LearnConversationStoreError(
      'conversation_deleted',
      409,
      'The requested course conversation was deleted.',
    );
  }
  return {
    session: courseConversationSessionFromRow(history.conversation),
    messages: history.messages.flatMap((message) =>
      message.role && message.plainText?.trim()
        ? [
            {
              id: message.id,
              role: message.role,
              text: message.plainText.trim(),
              createdAt: new Date(message.createdAt).getTime(),
            },
          ]
        : [],
    ),
    summary: history.summary,
  };
}

/**
 * Append one public-API question/answer pair to the same dedicated course
 * conversation used by `/learn`. Deterministic IDs make completed requests
 * replay-safe; the shared repository owns locking, revision and sequence rules.
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
  const userMessageId = stableMessageId('learn_api_user', {
    ...args,
    role: 'user',
  });
  const assistantMessageId = stableMessageId('learn_api_assistant', {
    ...args,
    role: 'assistant',
  });
  const userCreatedAt = new Date();
  const assistantCreatedAt = new Date(userCreatedAt.getTime() + 1);
  const commonMetadata = {
    idempotencyKey: args.idempotencyKey,
    requestId: args.requestId,
    requestPayloadHash: args.requestPayloadHash,
  };
  const userMessage: CourseConversationMessageWrite = {
    id: userMessageId,
    role: 'user',
    content: messageContent({ text: args.question }),
    plainText: args.question,
    createdAt: userCreatedAt,
    ...commonMetadata,
  };
  const assistantMessage: CourseConversationMessageWrite = {
    id: assistantMessageId,
    role: 'assistant',
    content: messageContent({
      text: args.answer,
      learningActions: args.learningActions,
      artifacts: args.artifacts,
      publicTrace: args.publicTrace,
    }),
    plainText: args.answer,
    createdAt: assistantCreatedAt,
    ...commonMetadata,
  };

  try {
    const persisted = await appendCourseConversationTurnInTransaction(tx, {
      userId: args.userId,
      courseId: args.courseId,
      sessionId: args.sessionId,
      title: args.title,
      userMessage,
      assistantMessage,
      idempotencyKey: args.idempotencyKey,
      requestPayloadHash: args.requestPayloadHash,
    });
    const persistedUser = persisted.messages.find((message) => message.id === userMessageId);
    const persistedAssistant = persisted.messages.find(
      (message) => message.id === assistantMessageId,
    );
    if (!persistedUser || !persistedAssistant) {
      throw new LearnConversationStoreError(
        'message_conflict',
        409,
        'The persisted course question turn is incomplete.',
      );
    }
    return {
      session: courseConversationSessionFromRow(persisted.conversation),
      userMessageId,
      assistantMessageId,
      question: persistedUser.plainText ?? args.question,
      answer: persistedAssistant.plainText ?? args.answer,
      replayed: persisted.replayed,
    };
  } catch (error) {
    mapRepositoryError(error);
  }
}

export async function persistCourseQuestionTurn(
  prisma: PrismaClient,
  args: Parameters<typeof appendCourseQuestionTurnInTransaction>[1],
): Promise<PersistedCourseQuestionTurn> {
  return prisma.$transaction((tx) => appendCourseQuestionTurnInTransaction(tx, args));
}
