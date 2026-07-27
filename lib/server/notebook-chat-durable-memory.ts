import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@/lib/server/generated-prisma';
import type { QuestionMemoryDiagnosis } from '@/features/memory/domain/learner-memory-update';
import type {
  NotebookDurableMemoryReconciliation,
  NotebookDurableMemoryWriteback,
  SendNotebookMessageRequest,
} from '@/lib/types/notebook-message';
import { createLogger } from '@/lib/logger';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  ensureStudyMemoryTable,
  resolveReadableStudyMemoryTarget,
} from '@/lib/server/study-memory-store';
import { indexStudyMemoryRecord } from '@/lib/server/study-memory-vector-store';

const log = createLogger('NotebookChatDurableMemory');

type LearnerState = {
  knowledgePoint: string;
  masteredSignal?: string;
  stuckPoint?: string;
  cause?: string;
  nextTeachingMove: string;
};

type LearnerMemorySourceReference = {
  schema: 'notebook_chat_learner_memory_v1';
  learnerMemoryKey: string;
  knowledgePointKey: string;
  messageId: string;
  role: 'user';
  excerpt: string;
  order: number;
  title: string;
  why: string;
};

function compact(value: unknown, maxChars: number): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function normalizedText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

export function normalizeNotebookChatKnowledgePointKey(value: string): string {
  return compact(value, 300)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '')
    .slice(0, 160);
}

function stableMemoryId(userId: string, notebookId: string, knowledgePointKey: string): string {
  const digest = createHash('sha256')
    .update(`${userId}\0${notebookId}\0${knowledgePointKey}`)
    .digest('hex')
    .slice(0, 40);
  return `memory_notebook_chat_${digest}`;
}

function safeStateField(
  value: string | null | undefined,
  studentMessage: string,
): string | undefined {
  const text = compact(value, 500);
  if (!text || normalizedText(text) === normalizedText(studentMessage)) return undefined;
  return text;
}

function parseLearnerState(text: string, knowledgePoint: string): LearnerState | null {
  const values: Partial<LearnerState> = { knowledgePoint };
  for (const line of text.split('\n')) {
    if (line.startsWith('掌握：')) values.masteredSignal = compact(line.slice(3), 500);
    if (line.startsWith('薄弱：')) values.stuckPoint = compact(line.slice(3), 500);
    if (line.startsWith('原因：')) values.cause = compact(line.slice(3), 500);
    if (line.startsWith('下一步：')) values.nextTeachingMove = compact(line.slice(4), 500);
  }
  if (!values.nextTeachingMove) return null;
  return values as LearnerState;
}

function learnerStateText(state: LearnerState): string {
  return [
    state.masteredSignal ? `掌握：${state.masteredSignal}` : '',
    state.stuckPoint ? `薄弱：${state.stuckPoint}` : '',
    state.cause ? `原因：${state.cause}` : '',
    `下一步：${state.nextTeachingMove}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function groundedEvidence(diagnosis: QuestionMemoryDiagnosis, studentMessage: string): string[] {
  const normalizedMessage = normalizedText(studentMessage);
  const excerpts: string[] = [];
  for (const rawExcerpt of diagnosis.evidenceFromMessage) {
    const excerpt =
      typeof rawExcerpt === 'string' ? rawExcerpt.replace(/\r\n?/g, '\n').trim().slice(0, 320) : '';
    const normalizedExcerpt = normalizedText(excerpt);
    if (
      !excerpt ||
      !normalizedExcerpt ||
      normalizedExcerpt === normalizedMessage ||
      !normalizedMessage.includes(normalizedExcerpt)
    ) {
      continue;
    }
    if (!excerpts.includes(excerpt)) excerpts.push(excerpt);
    if (excerpts.length >= 6) break;
  }
  return excerpts;
}

function sourceReferenceFromUnknown(value: unknown): LearnerMemorySourceReference | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<LearnerMemorySourceReference>;
  const learnerMemoryKey = compact(record.learnerMemoryKey, 400);
  const knowledgePointKey = compact(record.knowledgePointKey, 160);
  const messageId = compact(record.messageId, 160);
  const excerpt = compact(record.excerpt, 320);
  if (
    record.schema !== 'notebook_chat_learner_memory_v1' ||
    record.role !== 'user' ||
    !learnerMemoryKey ||
    !knowledgePointKey ||
    !messageId ||
    !excerpt
  ) {
    return null;
  }
  return {
    schema: record.schema,
    learnerMemoryKey,
    knowledgePointKey,
    messageId,
    role: 'user',
    excerpt,
    order: Number(record.order) || 1,
    title: compact(record.title, 160) || '学生消息',
    why: compact(record.why, 360) || `学生证据：${excerpt}`,
  };
}

function existingSourceReferences(value: unknown): LearnerMemorySourceReference[] {
  if (Array.isArray(value)) {
    return value
      .map((reference) => sourceReferenceFromUnknown(reference))
      .filter((reference): reference is LearnerMemorySourceReference => Boolean(reference))
      .slice(0, 12);
  }

  // Compatibility with the object-shaped format used during the initial rollout.
  if (!value || typeof value !== 'object') return [];
  const record = value as {
    schema?: unknown;
    learnerMemoryKey?: unknown;
    knowledgePointKey?: unknown;
    evidence?: unknown;
  };
  if (record.schema !== 'notebook_chat_learner_memory_v1' || !Array.isArray(record.evidence)) {
    return [];
  }
  return record.evidence
    .map((raw, index) => {
      if (!raw || typeof raw !== 'object') return null;
      const evidence = raw as { messageId?: unknown; role?: unknown; excerpt?: unknown };
      const excerpt = compact(evidence.excerpt, 320);
      return sourceReferenceFromUnknown({
        schema: record.schema,
        learnerMemoryKey: record.learnerMemoryKey,
        knowledgePointKey: record.knowledgePointKey,
        messageId: evidence.messageId,
        role: evidence.role,
        excerpt,
        order: index + 1,
        title: '学生消息',
        why: `学生证据：${excerpt}`,
      });
    })
    .filter((reference): reference is LearnerMemorySourceReference => Boolean(reference))
    .slice(0, 12);
}

function mergeSourceReferences(args: {
  existing: unknown;
  learnerMemoryKey: string;
  knowledgePointKey: string;
  clientMessageId: string;
  evidence: string[];
}): LearnerMemorySourceReference[] {
  const previous = existingSourceReferences(args.existing);
  return [
    ...args.evidence.map((excerpt) => ({
      schema: 'notebook_chat_learner_memory_v1' as const,
      learnerMemoryKey: args.learnerMemoryKey,
      knowledgePointKey: args.knowledgePointKey,
      messageId: args.clientMessageId,
      role: 'user' as const,
      excerpt,
      order: 1,
      title: '学生消息',
      why: `学生证据：${excerpt}`,
    })),
    ...previous,
  ]
    .filter(
      (item, index, all) =>
        all.findIndex(
          (candidate) =>
            candidate.messageId === item.messageId && candidate.excerpt === item.excerpt,
        ) === index,
    )
    .slice(0, 12)
    .map((item, index) => ({ ...item, order: index + 1 }));
}

function latinNumberTokens(value: string): Set<string> {
  return new Set(
    value
      .normalize('NFKC')
      .toLowerCase()
      .match(/[a-z0-9]+/g)
      ?.filter((token) => token.length >= 2) || [],
  );
}

function isConservativeKnowledgePointAlias(left: string, right: string): boolean {
  const leftTokens = latinNumberTokens(left);
  const rightTokens = latinNumberTokens(right);
  if (leftTokens.size < 2 || rightTokens.size < 2) return false;
  const shared = [...leftTokens].filter((token) => rightTokens.has(token));
  return shared.length >= 2 && shared.length === Math.min(leftTokens.size, rightTokens.size);
}

function storedKnowledgePointKey(sourceReferences: unknown): string {
  return existingSourceReferences(sourceReferences)[0]?.knowledgePointKey || '';
}

function knowledgePointFromTitle(title: string, fallback: string): string {
  return compact(title.replace(/^学习状态[:：]\s*/u, ''), 180) || fallback;
}

export async function upsertNotebookChatDurableMemory(args: {
  prisma: PrismaClient;
  userId: string;
  notebookId: string;
  clientMessageId: string;
  studentMessage: string;
  diagnosis: QuestionMemoryDiagnosis;
  clientHasMatchingDurableMemory?: boolean;
}): Promise<NotebookDurableMemoryWriteback> {
  const action = args.diagnosis.durableMemoryAction;
  if (action === 'skip') {
    return { status: 'skipped', storage: 'database', reason: 'diagnosis_action_skip' };
  }

  const clientMessageId = compact(args.clientMessageId, 160);
  const knowledgePoint = compact(args.diagnosis.knowledgePoint, 180);
  const knowledgePointKey = normalizeNotebookChatKnowledgePointKey(knowledgePoint);
  const evidence = groundedEvidence(args.diagnosis, args.studentMessage);
  if (!clientMessageId || !knowledgePointKey) {
    return { status: 'skipped', storage: 'database', reason: 'missing_stable_reference' };
  }
  if (evidence.length === 0) {
    return { status: 'skipped', storage: 'database', reason: 'missing_literal_student_evidence' };
  }

  await ensureStudyMemoryTable(args.prisma);
  const readableTarget = await resolveReadableStudyMemoryTarget(
    args.prisma,
    args.userId,
    'notebook',
    args.notebookId,
  );
  if (!readableTarget?.notebookId) {
    return { status: 'failed', storage: 'database', reason: 'notebook_not_accessible' };
  }

  const exactMemoryId = stableMemoryId(args.userId, readableTarget.notebookId, knowledgePointKey);
  const lockKey = `${args.userId}:${readableTarget.notebookId}:notebook-chat-learner-memory`;
  const transactionResult = await args.prisma.$transaction(async (transaction) => {
    await transaction.$queryRawUnsafe<unknown[]>(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      lockKey,
    );
    const candidates = await transaction.studyMemory.findMany({
      where: {
        ownerId: args.userId,
        notebookId: readableTarget.notebookId,
        targetType: 'notebook',
        scope: 'private',
        status: 'active',
        source: 'notebook_chat_memory_diagnosis',
      },
      orderBy: { updatedAt: 'desc' },
      take: 80,
    });
    const exactCandidate = candidates.find(
      (candidate) =>
        candidate.id === exactMemoryId ||
        storedKnowledgePointKey(candidate.sourceReferences) === knowledgePointKey,
    );
    const aliasCandidate =
      exactCandidate ||
      candidates.find((candidate) =>
        isConservativeKnowledgePointAlias(
          knowledgePoint,
          knowledgePointFromTitle(candidate.title, ''),
        ),
      );
    const canonicalKnowledgePoint = aliasCandidate
      ? knowledgePointFromTitle(aliasCandidate.title, knowledgePoint)
      : knowledgePoint;
    const canonicalKnowledgePointKey =
      storedKnowledgePointKey(aliasCandidate?.sourceReferences) || knowledgePointKey;
    const memoryId = aliasCandidate?.id || exactMemoryId;
    const existing =
      aliasCandidate || (await transaction.studyMemory.findUnique({ where: { id: memoryId } }));
    const activeExisting = existing?.status === 'active' ? existing : null;
    const backfillingLocalProjection =
      action === 'revise' && !activeExisting && Boolean(args.clientHasMatchingDurableMemory);
    if (action === 'revise' && !activeExisting && !backfillingLocalProjection) {
      return {
        kind: 'skipped' as const,
        writeback: {
          status: 'skipped',
          storage: 'database',
          reason: 'missing_existing_for_revise',
          knowledgePointKey: canonicalKnowledgePointKey,
        } satisfies NotebookDurableMemoryWriteback,
      };
    }

    const existingState = activeExisting
      ? parseLearnerState(activeExisting.text, canonicalKnowledgePoint)
      : null;
    const replaceState = action === 'revise';
    const masteredSignal = safeStateField(args.diagnosis.masteredSignal, args.studentMessage);
    const stuckPoint = safeStateField(args.diagnosis.stuckPoint, args.studentMessage);
    const cause = safeStateField(args.diagnosis.cause, args.studentMessage);
    const nextTeachingMove =
      safeStateField(args.diagnosis.nextTeachingMove, args.studentMessage) ||
      existingState?.nextTeachingMove ||
      '下一轮先用一个最小检查问题复核当前学习状态。';
    const state: LearnerState = {
      knowledgePoint: canonicalKnowledgePoint,
      masteredSignal: replaceState
        ? masteredSignal
        : masteredSignal || existingState?.masteredSignal,
      stuckPoint: replaceState ? stuckPoint : stuckPoint || existingState?.stuckPoint,
      cause: replaceState ? cause : cause || existingState?.cause,
      nextTeachingMove,
    };
    if (!state.masteredSignal && !state.stuckPoint && !state.cause) {
      return {
        kind: 'skipped' as const,
        writeback: {
          status: 'skipped',
          storage: 'database',
          reason: 'missing_durable_state',
          knowledgePointKey: canonicalKnowledgePointKey,
        } satisfies NotebookDurableMemoryWriteback,
      };
    }

    const sourceReferences = mergeSourceReferences({
      existing: activeExisting?.sourceReferences,
      learnerMemoryKey: `notebook:${readableTarget.notebookId}:${canonicalKnowledgePointKey}`,
      knowledgePointKey: canonicalKnowledgePointKey,
      clientMessageId,
      evidence,
    }) satisfies Prisma.InputJsonArray;
    const reason =
      safeStateField(args.diagnosis.durableMemoryReason, args.studentMessage) ||
      '学生本轮直接证据达到长期学习状态写入门槛。';
    const kind = state.stuckPoint || state.cause ? 'knowledge_gap' : 'reflection';
    const memory = await transaction.studyMemory.upsert({
      where: { id: memoryId },
      create: {
        id: memoryId,
        ownerId: args.userId,
        courseId: readableTarget.courseId,
        notebookId: readableTarget.notebookId,
        targetType: 'notebook',
        scope: 'private',
        kind,
        status: 'active',
        source: 'notebook_chat_memory_diagnosis',
        title: `学习状态：${canonicalKnowledgePoint}`,
        text: learnerStateText(state),
        reason,
        question: null,
        sourceReferences,
        confidence: args.diagnosis.confidence === 'high' ? 0.9 : 0.7,
      },
      update: {
        kind,
        status: 'active',
        source: 'notebook_chat_memory_diagnosis',
        title: `学习状态：${canonicalKnowledgePoint}`,
        text: learnerStateText(state),
        reason,
        question: null,
        sourceReferences,
        confidence: args.diagnosis.confidence === 'high' ? 0.9 : 0.7,
      },
    });
    return {
      kind: 'written' as const,
      memory,
      existed: Boolean(existing),
      backfillingLocalProjection,
      memoryId,
      canonicalKnowledgePointKey,
    };
  });
  if (transactionResult.kind === 'skipped') return transactionResult.writeback;
  const { memory, existed, backfillingLocalProjection, memoryId, canonicalKnowledgePointKey } =
    transactionResult;

  try {
    await indexStudyMemoryRecord(args.prisma, memory);
  } catch (error) {
    log.warn('Failed to reindex notebook chat durable memory:', {
      memoryId,
      error,
    });
  }

  return {
    status: existed ? 'updated' : 'created',
    storage: 'database',
    memoryId,
    knowledgePointKey: canonicalKnowledgePointKey,
    reason: backfillingLocalProjection ? 'backfilled_from_local_projection' : undefined,
  };
}

export async function writeNotebookChatDurableMemory(args: {
  userId?: string;
  notebookId: string;
  clientMessageId?: string;
  studentMessage: string;
  diagnosis?: QuestionMemoryDiagnosis;
  clientHasMatchingDurableMemory?: boolean;
}): Promise<NotebookDurableMemoryWriteback> {
  if (!args.diagnosis || args.diagnosis.durableMemoryAction === 'skip') {
    return { status: 'skipped', storage: 'database', reason: 'diagnosis_action_skip' };
  }
  if (!args.userId) {
    return { status: 'unavailable', storage: 'database', reason: 'unauthenticated' };
  }
  if (!args.clientMessageId) {
    return { status: 'failed', storage: 'database', reason: 'missing_stable_reference' };
  }

  try {
    const prisma = getOptionalPrisma();
    if (!prisma) {
      return { status: 'unavailable', storage: 'database', reason: 'database_unavailable' };
    }
    return await upsertNotebookChatDurableMemory({
      prisma,
      userId: args.userId,
      notebookId: args.notebookId,
      clientMessageId: args.clientMessageId,
      studentMessage: args.studentMessage,
      diagnosis: args.diagnosis,
      clientHasMatchingDurableMemory: args.clientHasMatchingDurableMemory,
    });
  } catch (error) {
    log.warn('Notebook chat durable memory writeback failed:', error);
    return { status: 'failed', storage: 'database', reason: 'database_write_failed' };
  }
}

export async function reconcilePendingNotebookChatDurableMemories(args: {
  userId?: string;
  notebookId: string;
  learnerDurableMemory?: SendNotebookMessageRequest['learnerDurableMemory'];
}): Promise<NotebookDurableMemoryReconciliation> {
  const pending = (args.learnerDurableMemory || [])
    .filter((memory) => Boolean(memory.pendingServerSync))
    .slice(0, 6);
  const results: NotebookDurableMemoryReconciliation['results'] = [];

  for (const memory of pending) {
    const outbox = memory.pendingServerSync!;
    const evidenceFromMessage = outbox.evidenceFromMessage.filter(Boolean).slice(0, 6);
    const evidenceCorpus = `${evidenceFromMessage.join('\n---\n')}\n[pending-local-memory-sync]`;
    const diagnosis: QuestionMemoryDiagnosis = {
      category: 'clarification',
      courseRelevant: true,
      knowledgePoint: memory.knowledgePoint,
      masteredSignal: memory.masteredSignal || null,
      stuckPoint: memory.stuckPoint || null,
      cause: memory.cause || null,
      nextTeachingMove: memory.nextTeachingMove,
      confidence: outbox.confidence,
      evidenceFromMessage,
      workingMemoryAction: 'skip',
      durableMemoryAction: outbox.action,
      durableMemoryReason: outbox.durableMemoryReason,
      layerRouting: {
        sourceOfTruth: 'conversation_message',
        controlFacts: 'read_only',
        shortTerm: 'skip',
        longTerm: outbox.action,
        knowledgeBase: 'read_only',
        knowledgeCache: 'read_only',
      },
    };
    const writeback = await writeNotebookChatDurableMemory({
      userId: args.userId,
      notebookId: args.notebookId,
      clientMessageId: outbox.clientMessageId,
      studentMessage: evidenceCorpus,
      diagnosis,
      clientHasMatchingDurableMemory: true,
    });
    results.push({ localMemoryId: memory.id, ...writeback });
  }

  return {
    attempted: pending.length,
    syncedLocalMemoryIds: results
      .filter((result) => result.status === 'created' || result.status === 'updated')
      .map((result) => result.localMemoryId),
    results,
  };
}
