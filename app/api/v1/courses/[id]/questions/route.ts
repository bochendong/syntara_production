import type { UIMessage } from 'ai';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  collectTrustedCourseTurn,
  resolveTrustedCourseTurn,
  trustedCourseAnswerContractText,
  TrustedCourseTurnError,
} from '@/features/chat/server/trusted-course-turn';
import {
  buildCourseAnswerContractMemorySignal,
  validateCourseAnswerContract,
  type CourseAnswerContractMemorySignal,
} from '@/features/memory/domain/course-answer-contract';
import {
  buildTrustedCourseQuestionContext,
  TrustedCourseQuestionContextError,
} from '@/lib/chat/server-course-question-context';
import { COURSE_ORCHESTRATOR_ID, COURSE_ORCHESTRATOR_NAME } from '@/lib/constants/course-chat';
import {
  claimCourseQuestionRun,
  completeCourseQuestionRun,
  CourseQuestionRunStoreError,
  failCourseQuestionRun,
  hashCourseQuestionPayload,
  stableCourseQuestionSessionId,
} from '@/lib/server/course-question-run-store';
import {
  LearnConversationStoreError,
  loadCourseQuestionConversationHistory,
} from '@/lib/server/learn-conversation-store';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requirePublicApi,
} from '@/lib/server/public-api';
import { prisma } from '@/lib/server/prisma';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { withRequestContext } from '@/lib/server/request-context';
import type {
  ChatMessageMetadata,
  LearningAction,
  LearningActionKind,
  StatelessChatRequest,
  StatelessEvent,
} from '@/lib/types/chat';

export const runtime = 'nodejs';
export const maxDuration = 180;

const requestSchema = z.object({
  question: z.string().trim().min(1).max(12_000),
  session_id: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/)
    .optional(),
  options: z
    .object({
      include_evidence: z.boolean().default(true),
      include_memory_write_proposals: z.boolean().default(true),
    })
    .default({
      include_evidence: true,
      include_memory_write_proposals: true,
    }),
});

const IDEMPOTENCY_KEY_PATTERN = /^[^\u0000-\u001f\u007f]{1,200}$/;
const MAX_HISTORY_MESSAGES = 20;
const MAX_HISTORY_CHARS = 32_000;
const MAX_HISTORY_MESSAGE_CHARS = 8_000;

const LEARNING_ACTION_KINDS = new Set<LearningActionKind>([
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

type PublicCourseQuestionResponse = {
  id: string;
  object: 'course_question_response';
  created_at: string;
  course_id: string;
  session_id: string;
  conversation_id: string;
  conversation_url: string;
  answer: string;
  evidence: unknown[];
  proposals: unknown[];
  model: string;
  answer_contract: {
    enforced: boolean;
    task: string;
    generation_attempts: number;
  };
  current_revision: number;
  idempotent_replay: boolean;
};

function responseRecord(value: unknown): PublicCourseQuestionResponse | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<PublicCourseQuestionResponse>;
  if (
    record.object !== 'course_question_response' ||
    typeof record.answer !== 'string' ||
    typeof record.session_id !== 'string' ||
    typeof record.conversation_id !== 'string'
  ) {
    return null;
  }
  return record as PublicCourseQuestionResponse;
}

function courseQuestionTitle(question: string): string {
  return question.replace(/\s+/g, ' ').trim().slice(0, 32) || '新对话';
}

function compactHistory(
  history: Awaited<ReturnType<typeof loadCourseQuestionConversationHistory>>['messages'],
): UIMessage<ChatMessageMetadata>[] {
  const selected: typeof history = [];
  let remainingChars = MAX_HISTORY_CHARS;
  for (const message of history.slice(-MAX_HISTORY_MESSAGES).reverse()) {
    if (remainingChars <= 0) break;
    const text = message.text.slice(0, Math.min(MAX_HISTORY_MESSAGE_CHARS, remainingChars)).trim();
    if (!text) continue;
    selected.push({ ...message, text });
    remainingChars -= text.length;
  }
  return selected.reverse().map((message) => ({
    id: message.id,
    role: message.role,
    parts: [{ type: 'text', text: message.text }],
    metadata: {
      originalRole: message.role === 'user' ? 'user' : 'agent',
      createdAt: message.createdAt,
    },
  }));
}

function isContextDependentCourseQuestion(question: string): boolean {
  const normalized = question.replace(/\s+/g, ' ').trim();
  if (!normalized || normalized.length > 80) return false;
  return (
    /(?:这|那|它|上述|刚才|前面|上一步|这里|那里|this|that|it|above|previous)/i.test(normalized) ||
    /^(?:为什么|怎么了|继续|继续讲|然后呢|再解释一下|再说具体一点|详细一点|why|continue|go on|explain more)[?？!！。.]*$/i.test(
      normalized,
    )
  );
}

function courseQuestionRetrievalQuery(
  question: string,
  history: Awaited<ReturnType<typeof loadCourseQuestionConversationHistory>>['messages'],
): string {
  const normalizedQuestion = question.trim();
  if (!isContextDependentCourseQuestion(normalizedQuestion)) return normalizedQuestion;
  const previousUserMessage = history
    .slice()
    .reverse()
    .find((message) => message.role === 'user' && message.text.trim());
  if (!previousUserMessage) return normalizedQuestion;
  return [
    normalizedQuestion,
    `Previous user topic:\n${previousUserMessage.text.trim().slice(-1_200)}`,
  ].join('\n\n');
}

function userMessage(question: string, requestId: string): UIMessage<ChatMessageMetadata> {
  return {
    id: `course_question_${requestId}`,
    role: 'user',
    parts: [{ type: 'text', text: question }],
    metadata: {
      senderName: '你',
      originalRole: 'user',
      createdAt: Date.now(),
    },
  };
}

function orchestratorAgentConfig(): NonNullable<
  StatelessChatRequest['config']['agentConfigs']
>[number] {
  return {
    id: COURSE_ORCHESTRATOR_ID,
    name: COURSE_ORCHESTRATOR_NAME,
    avatar: '',
    role: 'teacher',
    persona:
      '你是课程总控老师。依据服务端提供的课程资料、题库证据和学习记忆作答；清楚说明依据、步骤、例子和易错点。若需要修正长期学习记忆，只提出需要用户确认的建议，不得自动写入。',
    color: '#7c3aed',
    allowedActions: [],
    priority: 100,
    isGenerated: false,
  };
}

function learningActionFromEvent(
  event: Extract<StatelessEvent, { type: 'action' }>,
): LearningAction | null {
  const kind = LEARNING_ACTION_KINDS.has(event.data.actionName as LearningActionKind)
    ? (event.data.actionName as LearningActionKind)
    : null;
  if (!kind) return null;
  const params = event.data.params || {};
  const rawLabel = params.label || params.title || params.topic || event.data.actionName;
  const rawSummary = params.summary || params.reason;
  const requiresConfirmation =
    kind === 'memory.propose_write' ||
    params.requiresConfirmation === true ||
    (kind !== 'calendar.search' && params.requiresConfirmation !== false);
  return {
    id: event.data.actionId,
    kind,
    label: typeof rawLabel === 'string' ? rawLabel : event.data.actionName,
    summary: typeof rawSummary === 'string' ? rawSummary : undefined,
    status: 'proposed',
    confirmation: requiresConfirmation ? 'required' : 'none',
    payload: params,
  };
}

function publicMemoryProposal(action: LearningAction) {
  return {
    id: action.id,
    kind: action.kind,
    status: 'pending_confirmation',
    label: action.label,
    summary: action.summary,
    payload: action.payload,
    evidence: action.evidence || [],
  };
}

function courseContractMemoryAction(args: {
  runId: string;
  courseId: string;
  signal: CourseAnswerContractMemorySignal;
}): LearningAction {
  const summary = [
    `薄弱点：${args.signal.stuckPoint}`,
    `原因：${args.signal.cause}`,
    `下一步：${args.signal.nextTeachingMove}`,
  ].join('\n');
  const evidence = args.signal.evidenceFromMessage.slice(0, 6);
  const actionEvidence = evidence.map((excerpt, index) => ({
    sourceType: 'user' as const,
    sourceId: `${args.runId}:contract-evidence:${index + 1}`,
    title: '学生代码证据',
    reason: excerpt,
  }));
  return {
    id: `course_contract_memory_${args.runId}`,
    kind: 'memory.propose_write',
    label: `确认记录：${args.signal.knowledgePoint}`,
    summary,
    status: 'proposed',
    confirmation: 'required',
    payload: {
      label: `确认记录：${args.signal.knowledgePoint}`,
      summary,
      memoryType: 'weakness',
      courseId: args.courseId,
      concept: args.signal.knowledgePoint,
      knowledgePoint: args.signal.knowledgePoint,
      masteredSignal: args.signal.masteredSignal,
      stuckPoint: args.signal.stuckPoint,
      cause: args.signal.cause,
      nextTeachingMove: args.signal.nextTeachingMove,
      confidence: args.signal.confidence,
      evidence,
      contractId: args.signal.contractId,
      contractCheckIds: args.signal.contractCheckIds,
      requiresConfirmation: true,
    },
    evidence: actionEvidence,
  };
}

function buildChatRequest(args: {
  question: string;
  requestId: string;
  modelString: string;
  history: UIMessage<ChatMessageMetadata>[];
  courseContext: Awaited<ReturnType<typeof buildTrustedCourseQuestionContext>>['courseContext'];
}): StatelessChatRequest {
  return {
    messages: [...args.history, userMessage(args.question, args.requestId)],
    storeState: {
      stage: null,
      scenes: [],
      currentSceneId: null,
      mode: 'playback',
      whiteboardOpen: false,
    },
    config: {
      agentIds: [COURSE_ORCHESTRATOR_ID],
      sessionType: 'qa',
      surface: 'course-chat',
      agentConfigs: [orchestratorAgentConfig()],
    },
    courseContext: args.courseContext,
    apiKey: '',
    model: args.modelString,
    requiresApiKey: false,
  };
}

function errorResponse(requestId: string, error: unknown): NextResponse {
  if (error instanceof CourseQuestionRunStoreError) {
    return publicApiError(
      requestId,
      error.status,
      error.code === 'request_in_progress' ? 'request_in_progress' : 'idempotency_conflict',
      error.message,
    );
  }
  if (error instanceof LearnConversationStoreError) {
    return publicApiError(requestId, error.status, 'idempotency_conflict', error.message);
  }
  if (error instanceof TrustedCourseQuestionContextError) {
    return publicApiError(
      requestId,
      error.code === 'COURSE_NOT_FOUND' ? 404 : 400,
      error.code === 'COURSE_NOT_FOUND' ? 'not_found' : 'invalid_request',
      error.message,
    );
  }
  if (error instanceof TrustedCourseTurnError) {
    return publicApiError(
      requestId,
      error.status,
      error.code === 'course_answer_contract_rejected'
        ? 'generation_failed'
        : error.status === 404
          ? 'not_found'
          : 'invalid_request',
      error.message,
      error.validationFailures.length
        ? { validation_failures: error.validationFailures }
        : undefined,
    );
  }
  console.error('[public-course-question] unexpected failure', {
    requestId,
    error,
  });
  return publicApiError(requestId, 500, 'internal_error', 'Course question generation failed.');
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const requestId = publicApiRequestId(request);
  const principal = requirePublicApi(request, requestId);
  if (principal instanceof NextResponse) return principal;

  const idempotencyKey = request.headers.get('idempotency-key')?.trim() || '';
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Provide an Idempotency-Key header containing 1 to 200 visible characters.',
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Invalid course-question request.',
      parsed.error.flatten(),
    );
  }

  const courseId = (await context.params).id.trim();
  if (!courseId) {
    return publicApiError(requestId, 404, 'not_found', 'Course not found.');
  }

  const accessRole = await findCourseAccessRole(prisma, principal.userId, courseId);
  if (!accessRole) {
    return publicApiError(requestId, 404, 'not_found', 'Course not found.');
  }

  const input = parsed.data;
  const sessionId =
    input.session_id ||
    stableCourseQuestionSessionId({
      userId: principal.userId,
      courseId,
      idempotencyKey,
    });
  const requestHash = hashCourseQuestionPayload({
    version: 1,
    courseId,
    sessionId,
    question: input.question,
    options: input.options,
  });

  let claimed:
    | {
        runId: string;
        leaseToken: string;
      }
    | undefined;

  try {
    const claim = await claimCourseQuestionRun({
      prisma,
      userId: principal.userId,
      courseId,
      idempotencyKey,
      requestHash,
      requestId,
      sessionId,
      question: input.question,
    });
    if (claim.kind === 'completed') {
      const cached = responseRecord(claim.response);
      if (!cached) {
        throw new Error('The completed course question response is unavailable.');
      }
      return publicApiSuccess(requestId, {
        ...cached,
        idempotent_replay: true,
      });
    }
    claimed = { runId: claim.run.id, leaseToken: claim.leaseToken };

    const history = await loadCourseQuestionConversationHistory(prisma, {
      userId: principal.userId,
      courseId,
      sessionId,
      maxMessages: MAX_HISTORY_MESSAGES,
    });
    const resolvedModel = await resolveModelFromHeaders(request);
    const generated = await withRequestContext(
      {
        userId: principal.userId,
        route: '/api/v1/courses/[id]/questions',
        courseId,
        operationCode: 'public_course_question',
        chargeReason: '课程问答',
      },
      async () => {
        const trustedContext = await buildTrustedCourseQuestionContext({
          userId: principal.userId,
          courseId,
          question: courseQuestionRetrievalQuery(input.question, history.messages),
          conversationId: history.session?.conversationId,
          model: resolvedModel.model,
          prisma,
        });
        const requestedBody = buildChatRequest({
          question: input.question,
          requestId,
          modelString: resolvedModel.modelString,
          history: compactHistory(history.messages),
          courseContext: trustedContext.courseContext,
        });
        const trustedTurn = await resolveTrustedCourseTurn({
          body: requestedBody,
          authenticatedUserId: principal.userId,
          serverCourseContext: trustedContext.courseContext,
        });
        const collected = await collectTrustedCourseTurn({
          body: trustedTurn.body,
          signal: request.signal,
          languageModel: resolvedModel.model,
        });
        const contractMessage = trustedCourseAnswerContractText(
          trustedTurn.body,
          collected.answerContractTask,
        );
        const contractMemorySignal =
          collected.answerContractTask === 'code_review'
            ? buildCourseAnswerContractMemorySignal(
                validateCourseAnswerContract({
                  courseCode: trustedTurn.body.courseContext?.course.courseCode,
                  courseName: trustedTurn.body.courseContext?.course.name,
                  courseId: trustedTurn.body.courseContext?.course.id,
                  message: contractMessage,
                  answerText: contractMessage,
                  taskHint: 'grading',
                }),
              )
            : null;
        return { trustedContext, collected, contractMemorySignal };
      },
    );

    const streamError = generated.collected.events.find(
      (event): event is Extract<StatelessEvent, { type: 'error' }> => event.type === 'error',
    );
    if (streamError) throw new Error(streamError.data.message);
    const answer = generated.collected.answer.trim();
    if (!answer) throw new Error('The course agent returned an empty answer.');

    const generatedLearningActions = generated.collected.events
      .filter(
        (event): event is Extract<StatelessEvent, { type: 'action' }> => event.type === 'action',
      )
      .map(learningActionFromEvent)
      .filter((action): action is LearningAction => Boolean(action))
      .filter(
        (action) =>
          input.options.include_memory_write_proposals || action.kind !== 'memory.propose_write',
      );
    const deterministicMemoryAction =
      input.options.include_memory_write_proposals && generated.contractMemorySignal
        ? courseContractMemoryAction({
            runId: claimed.runId,
            courseId,
            signal: generated.contractMemorySignal,
          })
        : null;
    const learningActions = deterministicMemoryAction
      ? [
          deterministicMemoryAction,
          ...generatedLearningActions.filter((action) => action.kind !== 'memory.propose_write'),
        ]
      : generatedLearningActions;
    const memoryProposals = learningActions
      .filter((action) => action.kind === 'memory.propose_write')
      .map(publicMemoryProposal);
    const evidence = input.options.include_evidence ? generated.trustedContext.evidence : [];

    const completed = await completeCourseQuestionRun({
      prisma,
      runId: claimed.runId,
      leaseToken: claimed.leaseToken,
      requestHash,
      userId: principal.userId,
      courseId,
      sessionId,
      idempotencyKey,
      requestId,
      title: courseQuestionTitle(input.question),
      question: input.question,
      answer,
      model: resolvedModel.modelString,
      learningActions,
      publicTrace: {
        source: 'course_question_api',
        requestId,
        model: resolvedModel.modelString,
        evidenceIds: evidence.map((item) => item.id),
        answerContract: {
          enforced: generated.collected.answerContractEnforced,
          task: generated.collected.answerContractTask,
          generationAttempts: generated.collected.generationAttempts,
        },
        memoryProposalSource: deterministicMemoryAction
          ? 'deterministic_course_contract'
          : 'model_or_none',
      },
      buildResponse: (turn): PublicCourseQuestionResponse => ({
        id: claimed!.runId,
        object: 'course_question_response',
        created_at: new Date().toISOString(),
        course_id: courseId,
        session_id: sessionId,
        conversation_id: turn.session.conversationId,
        conversation_url: `/learn?courseId=${encodeURIComponent(courseId)}&session=${encodeURIComponent(sessionId)}`,
        answer: turn.answer,
        evidence,
        proposals: memoryProposals,
        model: resolvedModel.modelString,
        answer_contract: {
          enforced: generated.collected.answerContractEnforced,
          task: generated.collected.answerContractTask,
          generation_attempts: generated.collected.generationAttempts,
        },
        current_revision: turn.session.currentRevision,
        idempotent_replay: turn.replayed,
      }),
    });

    return publicApiSuccess(requestId, completed.response, { status: 201 });
  } catch (error) {
    if (claimed) {
      await failCourseQuestionRun({
        prisma,
        runId: claimed.runId,
        leaseToken: claimed.leaseToken,
        errorReason: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    }
    return errorResponse(requestId, error);
  }
}
