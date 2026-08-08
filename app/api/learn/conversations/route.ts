import { NextResponse } from 'next/server';
import { z } from 'zod';
import type { Prisma } from '@/lib/server/generated-prisma';
import {
  applyCourseConversationPatchInTransaction,
  courseConversationSessionFromRow,
  decodeCourseConversationPageCursor,
  decodeCourseMessagePageCursor,
  DEFAULT_COURSE_CONVERSATION_PAGE_LIMIT,
  DEFAULT_COURSE_MESSAGE_PAGE_LIMIT,
  deleteCourseConversationInTransaction,
  findCourseConversationAccessRole,
  listCourseConversationPage,
  loadCourseConversationSnapshot,
  MAX_COURSE_CONVERSATION_PAGE_LIMIT,
  MAX_COURSE_MESSAGE_PAGE_LIMIT,
  CourseConversationRepositoryError,
  type CourseConversationMessageRow,
  type CourseConversationMessageWrite,
} from '@/features/learn-conversations/server/course-conversation-repository';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

export const runtime = 'nodejs';

const MAX_SYNCED_MESSAGES = 120;
const MAX_SYNCED_LEARNING_ACTIONS = 40;
const CONVERSATION_TRANSACTION_MAX_WAIT_MS = 10_000;
const CONVERSATION_TRANSACTION_TIMEOUT_MS = 20_000;

type LearnMessageContent = {
  type?: unknown;
  text?: unknown;
  plan?: unknown;
  progressProposal?: unknown;
  pendingAction?: unknown;
  lecturePrompt?: unknown;
  lectureDeck?: unknown;
  learningActions?: unknown;
  artifacts?: unknown;
  publicTrace?: unknown;
  contextCompression?: unknown;
  attachments?: unknown;
};

const clientRevisionSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const baseRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const sessionPageLimitSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(MAX_COURSE_CONVERSATION_PAGE_LIMIT);
const messagePageLimitSchema = z.coerce.number().int().min(1).max(MAX_COURSE_MESSAGE_PAGE_LIMIT);

const learningActionKindSchema = z.enum([
  'calendar.propose_add',
  'calendar.propose_update',
  'calendar.propose_delete',
  'calendar.search',
  'calendar.start_recent',
  'memory.search',
  'web.search',
  'review_mode.request_choice',
  'learner_progress.request_confirmation',
  'practice.propose_generation',
  'classroom.propose_temporary_explanation',
  'image.propose_generation',
  'memory.propose_write',
]);
const learningActionStatusSchema = z.enum([
  'proposed',
  'confirmed',
  'cancelled',
  'completed',
  'failed',
]);
const learningActionEvidenceSchema = z.object({
  sourceType: z.enum([
    'notebook',
    'memory',
    'problem_bank',
    'calendar',
    'source',
    'web',
    'user',
    'system',
  ]),
  sourceId: z.string().max(240).optional(),
  title: z.string().max(1000).optional(),
  reason: z.string().max(4000).optional(),
});
const learningActionExecutionResultSchema = z.object({
  status: learningActionStatusSchema,
  executor: z.enum(['learn-client', 'server', 'simulator']),
  executedAt: z.number().finite(),
  summary: z.string().max(10000),
  input: z.record(z.string(), z.unknown()).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(10000).optional(),
  trace: z
    .object({
      actionId: z.string().min(1).max(240),
      actionKind: learningActionKindSchema,
      courseId: z.string().max(240).optional(),
      conversationId: z.string().max(240).optional(),
    })
    .optional(),
});
const learningActionSchema = z.object({
  id: z.string().trim().min(1).max(240),
  kind: learningActionKindSchema,
  label: z.string().trim().min(1).max(1000),
  summary: z.string().max(10000).optional(),
  status: learningActionStatusSchema.optional(),
  confirmation: z.enum(['none', 'optional', 'required']).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  result: learningActionExecutionResultSchema.optional(),
  evidence: z.array(learningActionEvidenceSchema).max(40).optional(),
});

const contextCompressionSchema = z.object({
  version: z.literal(1),
  mode: z.enum(['student', 'teacher']),
  trigger: z.enum(['token_budget', 'message_count']),
  summary: z.string().trim().min(1).max(12000),
  compressedMessageCount: z.number().int().nonnegative().max(1_000_000),
  retainedMessageCount: z.number().int().nonnegative().max(MAX_SYNCED_MESSAGES),
  estimatedTokensBefore: z.number().int().nonnegative().max(10_000_000),
  estimatedTokensAfter: z.number().int().nonnegative().max(10_000_000),
  throughMessageId: z.string().trim().min(1).max(160),
  createdAt: z.number().finite(),
});

const learnMessageSchema = z.object({
  id: z.string().trim().min(1).max(160),
  role: z.enum(['user', 'assistant']),
  text: z.string().max(40000).default(''),
  createdAt: z.number().finite().optional(),
  plan: z.unknown().optional(),
  progressProposal: z.unknown().optional(),
  pendingAction: z.unknown().optional(),
  lecturePrompt: z.unknown().optional(),
  lectureDeck: z.unknown().optional(),
  learningActions: z.array(learningActionSchema).max(MAX_SYNCED_LEARNING_ACTIONS).optional(),
  artifacts: z.unknown().optional(),
  publicTrace: z.unknown().optional(),
  contextCompression: contextCompressionSchema.optional(),
  attachments: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().optional(),
        mimeType: z.string().optional(),
        size: z.number().finite().optional(),
        width: z.number().finite().optional(),
        height: z.number().finite().optional(),
      }),
    )
    .optional(),
});

const syncLearnConversationSchema = z.object({
  courseId: z.string().trim().min(1),
  sessionId: z.string().trim().min(1).max(160),
  title: z.string().trim().max(200).optional(),
  syncMode: z.literal('patch').default('patch'),
  messages: z.array(learnMessageSchema).max(MAX_SYNCED_MESSAGES).default([]),
  deletedMessageIds: z
    .array(z.string().trim().min(1).max(160))
    .max(MAX_SYNCED_MESSAGES)
    .default([]),
  baseRevision: baseRevisionSchema.optional(),
  clientRevision: clientRevisionSchema.optional(),
});

function contentRecord(value: unknown): LearnMessageContent {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as LearnMessageContent)
    : {};
}

function plainTextFromMessage(message: z.infer<typeof learnMessageSchema>): string {
  const suffix = message.attachments?.length ? `\n[附件 ${message.attachments.length} 个]` : '';
  return `${message.text || ''}${suffix}`.trim();
}

function contentFromMessage(message: z.infer<typeof learnMessageSchema>): LearnMessageContent {
  return {
    type: 'learn_message',
    text: message.text,
    plan: message.plan ?? null,
    progressProposal: message.progressProposal ?? null,
    pendingAction: message.pendingAction ?? null,
    lecturePrompt: message.lecturePrompt ?? null,
    lectureDeck: message.lectureDeck ?? null,
    learningActions: message.learningActions ?? null,
    artifacts: message.artifacts ?? null,
    publicTrace: message.publicTrace ?? null,
    contextCompression: message.contextCompression ?? null,
    attachments: message.attachments ?? [],
  };
}

function messageWriteFromPayload(
  message: z.infer<typeof learnMessageSchema>,
): CourseConversationMessageWrite {
  return {
    id: message.id,
    role: message.role,
    content: contentFromMessage(message),
    plainText: plainTextFromMessage(message),
    createdAt: message.createdAt,
  };
}

function messageFromRow(row: CourseConversationMessageRow) {
  const content = contentRecord(row.content);
  return {
    id: row.id,
    role: row.role === 'user' ? 'user' : 'assistant',
    text:
      typeof content.text === 'string'
        ? content.text
        : typeof row.plainText === 'string'
          ? row.plainText
          : '',
    createdAt: new Date(row.createdAt).getTime(),
    plan: content.plan ?? undefined,
    progressProposal: content.progressProposal ?? undefined,
    pendingAction: content.pendingAction ?? undefined,
    lecturePrompt: content.lecturePrompt ?? undefined,
    lectureDeck: content.lectureDeck ?? undefined,
    learningActions: Array.isArray(content.learningActions) ? content.learningActions : undefined,
    artifacts: content.artifacts ?? undefined,
    publicTrace: content.publicTrace ?? undefined,
    contextCompression: content.contextCompression ?? undefined,
    attachments: Array.isArray(content.attachments) ? content.attachments : undefined,
  };
}

function unavailableListResponse() {
  return NextResponse.json({
    storage: 'unavailable',
    sessions: [],
    hasMore: false,
    nextCursor: null,
    totalCount: 0,
  });
}

function unavailableMutationResponse() {
  return NextResponse.json({
    storage: 'unavailable',
    ok: false,
    accepted: false,
    currentRevision: 0,
  });
}

export async function GET(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const prisma = getOptionalPrisma();
    if (!prisma) return unavailableListResponse();

    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('courseId')?.trim();
    const sessionId = searchParams.get('sessionId')?.trim();
    if (!courseId) return NextResponse.json({ error: 'Missing courseId' }, { status: 400 });

    if (sessionId) {
      const rawLimit = searchParams.get('messageLimit');
      const parsedLimit =
        rawLimit === null
          ? { success: true as const, data: DEFAULT_COURSE_MESSAGE_PAGE_LIMIT }
          : messagePageLimitSchema.safeParse(rawLimit);
      if (!parsedLimit.success) {
        return NextResponse.json(
          {
            error: `Invalid messageLimit; expected an integer between 1 and ${MAX_COURSE_MESSAGE_PAGE_LIMIT}`,
          },
          { status: 400 },
        );
      }
      const rawBefore = searchParams.get('before');
      const before = rawBefore ? decodeCourseMessagePageCursor(rawBefore) : null;
      if (rawBefore && !before) {
        return NextResponse.json({ error: 'Invalid message cursor' }, { status: 400 });
      }
      const snapshot = await loadCourseConversationSnapshot(prisma, {
        userId: auth.userId,
        courseId,
        sessionId,
        limit: parsedLimit.data,
        beforeSequence: before?.sequence ?? null,
      });
      if (!snapshot.accessRole) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }
      return NextResponse.json({
        storage: 'database',
        session: snapshot.session,
        messages: snapshot.messages.map(messageFromRow),
        deletedMessageIds: snapshot.deletedMessageIds,
        messagePage: snapshot.messagePage,
        messageWindow: snapshot.messageWindow,
        summary: snapshot.summary,
        currentRevision: snapshot.currentRevision,
      });
    }

    const rawLimit = searchParams.get('limit');
    const parsedLimit =
      rawLimit === null
        ? { success: true as const, data: DEFAULT_COURSE_CONVERSATION_PAGE_LIMIT }
        : sessionPageLimitSchema.safeParse(rawLimit);
    if (!parsedLimit.success) {
      return NextResponse.json(
        {
          error: `Invalid limit; expected an integer between 1 and ${MAX_COURSE_CONVERSATION_PAGE_LIMIT}`,
        },
        { status: 400 },
      );
    }
    const rawCursor = searchParams.get('cursor');
    const cursor = rawCursor ? decodeCourseConversationPageCursor(rawCursor) : null;
    if (rawCursor && !cursor) {
      return NextResponse.json({ error: 'Invalid cursor' }, { status: 400 });
    }
    const page = await listCourseConversationPage(prisma, {
      userId: auth.userId,
      courseId,
      limit: parsedLimit.data,
      cursor,
    });
    if (!page.accessRole) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    return NextResponse.json({
      storage: 'database',
      sessions: page.sessions,
      hasMore: page.hasMore,
      nextCursor: page.nextCursor,
      totalCount: page.totalCount,
    });
  });
}

export async function POST(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const prisma = getOptionalPrisma();
    if (!prisma) return unavailableMutationResponse();

    const payload = syncLearnConversationSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }
    const { courseId, sessionId, messages, deletedMessageIds, baseRevision, clientRevision } =
      payload.data;
    const accessRole = await findCourseConversationAccessRole(prisma, auth.userId, courseId);
    if (!accessRole) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    try {
      const result = await prisma.$transaction(
        (tx: Prisma.TransactionClient) =>
          applyCourseConversationPatchInTransaction(tx, {
            userId: auth.userId,
            courseId,
            sessionId,
            title: payload.data.title?.trim() || '新对话',
            baseRevision,
            clientRevision,
            messages: messages.map(messageWriteFromPayload),
            deletedMessageIds,
          }),
        {
          maxWait: CONVERSATION_TRANSACTION_MAX_WAIT_MS,
          timeout: CONVERSATION_TRANSACTION_TIMEOUT_MS,
        },
      );
      return NextResponse.json({
        storage: 'database',
        ok: true,
        accepted: result.accepted,
        currentRevision: result.currentRevision,
        deleted: result.deleted,
        appliedMessageIds: result.appliedMessageIds,
        appliedDeletedMessageIds: result.appliedDeletedMessageIds,
        serverDeletedMessageIds: result.serverDeletedMessageIds,
        session:
          result.conversation && !result.deleted
            ? courseConversationSessionFromRow(result.conversation)
            : null,
      });
    } catch (error) {
      if (error instanceof CourseConversationRepositoryError) {
        return NextResponse.json(
          {
            storage: 'database',
            ok: false,
            accepted: false,
            error: error.code,
          },
          { status: 409 },
        );
      }
      throw error;
    }
  });
}

export async function DELETE(request: Request) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const prisma = getOptionalPrisma();
    if (!prisma) return unavailableMutationResponse();

    const { searchParams } = new URL(request.url);
    const courseId = searchParams.get('courseId')?.trim();
    const sessionId = searchParams.get('sessionId')?.trim();
    if (!courseId) return NextResponse.json({ error: 'Missing courseId' }, { status: 400 });
    if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

    const rawClientRevision = searchParams.get('clientRevision');
    const rawBaseRevision = searchParams.get('baseRevision');
    const parsedClientRevision =
      rawClientRevision === null
        ? { success: true as const, data: undefined }
        : clientRevisionSchema.safeParse(Number(rawClientRevision));
    if (!parsedClientRevision.success) {
      return NextResponse.json({ error: 'Invalid clientRevision' }, { status: 400 });
    }
    const parsedBaseRevision =
      rawBaseRevision === null
        ? { success: true as const, data: undefined }
        : baseRevisionSchema.safeParse(Number(rawBaseRevision));
    if (!parsedBaseRevision.success) {
      return NextResponse.json({ error: 'Invalid baseRevision' }, { status: 400 });
    }
    const accessRole = await findCourseConversationAccessRole(prisma, auth.userId, courseId);
    if (!accessRole) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const result = await prisma.$transaction(
      (tx: Prisma.TransactionClient) =>
        deleteCourseConversationInTransaction(tx, {
          userId: auth.userId,
          courseId,
          sessionId,
          baseRevision: parsedBaseRevision.data,
          clientRevision: parsedClientRevision.data,
        }),
      {
        maxWait: CONVERSATION_TRANSACTION_MAX_WAIT_MS,
        timeout: CONVERSATION_TRANSACTION_TIMEOUT_MS,
      },
    );
    return NextResponse.json({
      storage: 'database',
      ok: true,
      accepted: result.accepted,
      currentRevision: result.currentRevision,
      deleted: result.deleted,
    });
  });
}
