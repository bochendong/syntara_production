import type { LanguageModel } from 'ai';
import {
  formatCourseAnswerContractValidationFailures,
  inferCourseAnswerContractConversationTask,
  resolveCourseAnswerContractReviewText,
  validateCourseAnswerContract,
  type CourseAnswerContractTask,
} from '@/features/memory/domain/course-answer-contract';
import { createLogger } from '@/lib/logger';
import { statelessGenerate } from '@/lib/orchestration/stateless-generate';
import { buildCoursePackPromptContext } from '@/lib/server/course-pack-context';
import { requireUserId } from '@/lib/server/api-auth';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { prisma } from '@/lib/server/prisma';
import { hasCourseEnrollment } from '@/lib/server/repositories/course-enrollment-repository';
import { reconcileSpeedupCourseMembershipsIfAvailable } from '@/lib/server/speedup-course-provisioning';
import type { CourseChatContext, StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import type { ThinkingConfig } from '@/lib/types/provider';
import { COURSE_ORCHESTRATOR_ID, COURSE_ORCHESTRATOR_NAME } from '@/lib/constants/course-chat';
import {
  loadCourseRuleContext,
  validateCourseRulePacks,
} from '@/features/memory/server/course-rule-pack-store';

const log = createLogger('TrustedCourseTurn');
const MOCK_COURSE_CHAT_ID = 'syntara-mock-course-chat';
const COURSE_CONTRACT_REPAIR_ATTEMPTS = 1;

export type TrustedCourseTurnErrorCode =
  | 'missing_course_id'
  | 'unauthorized'
  | 'course_not_found'
  | 'course_context_mismatch'
  | 'course_answer_contract_rejected';

export class TrustedCourseTurnError extends Error {
  constructor(
    readonly code: TrustedCourseTurnErrorCode,
    readonly status: 400 | 401 | 403 | 404 | 422,
    message: string,
    readonly validationFailures: string[] = [],
  ) {
    super(message);
    this.name = 'TrustedCourseTurnError';
  }
}

export type ResolvedTrustedCourseTurn = {
  body: StatelessChatRequest;
  authenticatedUserId?: string;
  courseId?: string;
  courseAccess?: TrustedCourseAccess;
  contextSource: 'not_course_chat' | 'database' | 'server' | 'development_mock';
};

export type TrustedCourseTurnRunResult = {
  answerContractEnforced: boolean;
  answerContractTask: CourseAnswerContractTask;
  generationAttempts: number;
};

export type CollectedTrustedCourseTurn = TrustedCourseTurnRunResult & {
  events: StatelessEvent[];
  answer: string;
};

export type ResolvedTrustedCourse = {
  id: string;
  ownerId: string;
  name: string;
  description: string | null;
  language: string;
  purpose: 'research' | 'university' | 'daily';
  tags: string[];
  university: string | null;
  courseCode: string | null;
  notebookCount: number;
  problemCount: number;
};

export type TrustedCourseAccess = {
  userId: string;
  role: 'owner' | 'enrolled';
  course: ResolvedTrustedCourse;
};

function messageText(message: StatelessChatRequest['messages'][number]): string {
  return message.parts
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .join('\n')
    .trim();
}

export function latestTrustedCourseUserText(body: StatelessChatRequest): string {
  const latest = body.messages
    .slice()
    .reverse()
    .find((message) => message.role === 'user');
  return latest ? messageText(latest) : '';
}

/**
 * Keep validation attached to the code the learner is actively reviewing.
 * Follow-up turns such as "继续检查一下" carry no code themselves, so the
 * validator receives the most recent prior user-authored Python submission
 * together with the current instruction. Assistant text is never treated as
 * learner evidence.
 */
export function trustedCourseAnswerContractText(
  body: StatelessChatRequest,
  task: CourseAnswerContractTask,
): string {
  return resolveCourseAnswerContractReviewText(
    body.messages
      .filter((message) => message.role === 'user')
      .map(messageText)
      .filter(Boolean),
    task,
  );
}

function answerText(events: StatelessEvent[]): string {
  return events
    .filter(
      (event): event is Extract<StatelessEvent, { type: 'text_delta' }> =>
        event.type === 'text_delta',
    )
    .map((event) => event.data.content)
    .join('');
}

async function collectEvents(generator: AsyncIterable<StatelessEvent>): Promise<StatelessEvent[]> {
  const events: StatelessEvent[] = [];
  for await (const event of generator) events.push(event);
  return events;
}

function fixedCourseTarget(): CourseChatContext['target'] {
  return {
    kind: 'orchestrator',
    id: COURSE_ORCHESTRATOR_ID,
    name: COURSE_ORCHESTRATOR_NAME,
    role: 'teacher',
  };
}

function trustedCourseContext(args: {
  course: ResolvedTrustedCourse;
  serverCourseContext?: CourseChatContext;
}): CourseChatContext {
  const { course, serverCourseContext } = args;
  const coursePack = buildCoursePackPromptContext({
    course: {
      id: course.id,
      name: course.name,
      courseCode: course.courseCode || undefined,
      tags: course.tags,
    },
    notebook: {
      id: `course-wide:${course.id}`,
      name: `${course.name} course-wide context`,
    },
  });

  return {
    course: {
      id: course.id,
      name: course.name,
      description: course.description || undefined,
      language: course.language === 'en-US' ? 'en-US' : 'zh-CN',
      purpose: course.purpose,
      tags: course.tags,
      university: course.university || undefined,
      courseCode: course.courseCode || undefined,
    },
    // These fields may contain prompt material. They are accepted only from
    // a context object explicitly supplied by another server module.
    learner: serverCourseContext?.learner,
    target: serverCourseContext?.target ?? fixedCourseTarget(),
    notebooks: serverCourseContext?.notebooks ?? [],
    hardRules: serverCourseContext?.hardRules ?? [],
    resourceStates: serverCourseContext?.resourceStates,
    layeredMemory: serverCourseContext?.layeredMemory,
    answererHandoff: serverCourseContext?.answererHandoff,
    serverCoursePack: coursePack.metadata.matched
      ? { prompt: coursePack.prompt, metadata: coursePack.metadata }
      : undefined,
  };
}

export function attachTrustedServerCourseContext(args: {
  resolved: ResolvedTrustedCourseTurn;
  serverCourseContext: CourseChatContext;
}): StatelessChatRequest {
  const current = args.resolved.body.courseContext;
  if (
    !current ||
    !args.resolved.courseId ||
    current.course.id !== args.resolved.courseId ||
    args.serverCourseContext.course.id !== args.resolved.courseId
  ) {
    throw new TrustedCourseTurnError(
      'course_context_mismatch',
      400,
      'Server course context does not match the trusted course.',
    );
  }
  return {
    ...args.resolved.body,
    courseContext: {
      ...current,
      learner: args.serverCourseContext.learner,
      target: args.serverCourseContext.target,
      notebooks: args.serverCourseContext.notebooks,
      hardRules: args.serverCourseContext.hardRules,
      resourceStates: args.serverCourseContext.resourceStates,
      layeredMemory: args.serverCourseContext.layeredMemory,
      answererHandoff: args.serverCourseContext.answererHandoff,
    },
  };
}

function trustedDevelopmentMockContext(serverCourseContext?: CourseChatContext): CourseChatContext {
  return {
    course: {
      id: MOCK_COURSE_CHAT_ID,
      name: serverCourseContext?.course.name || 'Mock course chat',
      description: serverCourseContext?.course.description,
      language: serverCourseContext?.course.language ?? 'zh-CN',
      purpose: serverCourseContext?.course.purpose ?? 'university',
      tags: serverCourseContext?.course.tags ?? ['mock'],
      university: serverCourseContext?.course.university,
      courseCode: serverCourseContext?.course.courseCode,
    },
    learner: serverCourseContext?.learner,
    target: serverCourseContext?.target ?? fixedCourseTarget(),
    notebooks: serverCourseContext?.notebooks ?? [],
    hardRules: serverCourseContext?.hardRules ?? [],
    resourceStates: serverCourseContext?.resourceStates,
    layeredMemory: serverCourseContext?.layeredMemory,
    answererHandoff: serverCourseContext?.answererHandoff,
    // Even in development, an HTTP caller cannot supply a server course pack.
    serverCoursePack: undefined,
  };
}

async function authenticatedUserId(suppliedUserId?: string): Promise<string> {
  const trustedUserId = suppliedUserId?.trim();
  if (trustedUserId) return trustedUserId;

  const auth = await requireUserId({ ensureFallbackUser: false });
  if ('response' in auth) {
    throw new TrustedCourseTurnError('unauthorized', 401, 'Unauthorized');
  }
  return auth.userId;
}

export async function resolveTrustedCourseAccess(args: {
  userId: string;
  courseId: string;
  prisma?: PrismaClient;
}): Promise<TrustedCourseAccess | null> {
  const userId = args.userId.trim();
  const courseId = args.courseId.trim();
  if (!userId || !courseId) return null;

  const db = args.prisma ?? prisma;
  const course = await db.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      ownerId: true,
      name: true,
      description: true,
      language: true,
      purpose: true,
      tags: true,
      university: true,
      courseCode: true,
      notebookCount: true,
      problemCount: true,
    },
  });
  if (!course) return null;

  const role =
    course.ownerId === userId
      ? 'owner'
      : (await hasCourseEnrollment(db, userId, courseId))
        ? 'enrolled'
        : null;
  return role ? { userId, role, course } : null;
}

/**
 * Rebuild the prompt-bearing course context from authenticated server data.
 *
 * `body.courseContext` contributes only the requested course id. Notebook
 * excerpts, layered memory, answerer handoffs, resource states, learner data,
 * course identity, and the course pack are never accepted from an HTTP body.
 * A server route that has built those fields itself can pass them separately
 * through `serverCourseContext`.
 */
export async function resolveTrustedCourseTurn(args: {
  body: StatelessChatRequest;
  authenticatedUserId?: string;
  serverCourseContext?: CourseChatContext;
  trustedAccess?: TrustedCourseAccess;
}): Promise<ResolvedTrustedCourseTurn> {
  const isCourseChat =
    args.body.config.surface === 'course-chat' ||
    args.body.config.surface === 'teacher-course-chat' ||
    args.body.config.surface === 'student-course-chat';
  if (!isCourseChat) {
    return {
      body: args.body,
      contextSource: 'not_course_chat',
    };
  }

  const courseId = args.body.courseContext?.course.id?.trim();
  if (!courseId) {
    throw new TrustedCourseTurnError(
      'missing_course_id',
      400,
      'Course chat requires courseContext.course.id.',
    );
  }
  if (args.serverCourseContext && args.serverCourseContext.course.id.trim() !== courseId) {
    throw new TrustedCourseTurnError(
      'course_context_mismatch',
      400,
      'Server course context does not match the requested course.',
    );
  }

  if (courseId === MOCK_COURSE_CHAT_ID && process.env.NODE_ENV !== 'production') {
    if (args.body.config.surface === 'teacher-course-chat') {
      throw new TrustedCourseTurnError(
        'unauthorized',
        403,
        'Teacher course chat requires verified course owner access.',
      );
    }
    return {
      body: {
        ...args.body,
        courseContext: trustedDevelopmentMockContext(args.serverCourseContext),
      },
      authenticatedUserId: args.authenticatedUserId?.trim() || undefined,
      courseId,
      contextSource: args.serverCourseContext ? 'server' : 'development_mock',
    };
  }

  const userId = await authenticatedUserId(args.authenticatedUserId);
  await reconcileSpeedupCourseMembershipsIfAvailable(userId, { maxAgeMs: 15_000 });
  const trustedAccess =
    args.trustedAccess &&
    args.trustedAccess.userId === userId &&
    args.trustedAccess.course.id === courseId
      ? args.trustedAccess
      : args.trustedAccess
        ? null
        : await resolveTrustedCourseAccess({ userId, courseId });
  if (!trustedAccess) {
    throw new TrustedCourseTurnError('course_not_found', 404, 'Course not found.');
  }
  if (args.body.config.surface === 'teacher-course-chat' && trustedAccess.role !== 'owner') {
    throw new TrustedCourseTurnError(
      'unauthorized',
      403,
      'Teacher course chat requires verified course owner access.',
    );
  }
  if (args.body.config.surface === 'student-course-chat' && trustedAccess.role !== 'enrolled') {
    throw new TrustedCourseTurnError(
      'unauthorized',
      403,
      'Student course chat requires verified enrollment access.',
    );
  }

  return {
    body: {
      ...args.body,
      courseContext: trustedCourseContext({
        course: trustedAccess.course,
        serverCourseContext: args.serverCourseContext,
      }),
    },
    authenticatedUserId: userId,
    courseId,
    courseAccess: trustedAccess,
    contextSource: args.serverCourseContext ? 'server' : 'database',
  };
}

export async function runTrustedCourseTurn(args: {
  body: StatelessChatRequest;
  signal: AbortSignal;
  languageModel: LanguageModel;
  onEvent: (event: StatelessEvent) => void | Promise<void>;
}): Promise<TrustedCourseTurnRunResult> {
  const safeBody: StatelessChatRequest = {
    ...args.body,
    apiKey: '',
    baseUrl: undefined,
    providerType: undefined,
    requiresApiKey: false,
  };
  const databaseRuleContext = safeBody.courseContext?.course.id
    ? await loadCourseRuleContext({
        prisma,
        courseId: safeBody.courseContext.course.id,
        body: safeBody,
      })
    : null;
  const task =
    databaseRuleContext?.task ??
    inferCourseAnswerContractConversationTask(
      safeBody.messages
        .filter((message) => message.role === 'user')
        .map(messageText)
        .filter(Boolean),
    );
  const courseContractMessage =
    databaseRuleContext?.reviewText ?? trustedCourseAnswerContractText(safeBody, task);
  const rulePrompt = databaseRuleContext?.prompt.trim();
  const primaryDatabaseRulePack = databaseRuleContext?.packs[0];
  const databaseRuleCheckIds =
    databaseRuleContext?.packs.flatMap((pack) => pack.contract.checks.map((check) => check.id)) ||
    [];
  const baseCoursePack = safeBody.courseContext?.serverCoursePack;
  const ruleAwareBody: StatelessChatRequest = rulePrompt
    ? {
        ...safeBody,
        courseContext: safeBody.courseContext
          ? {
              ...safeBody.courseContext,
              serverCoursePack: {
                prompt: [baseCoursePack?.prompt, rulePrompt].filter(Boolean).join('\n\n'),
                metadata: {
                  ...(baseCoursePack?.metadata || { matched: true }),
                  matched: true,
                  answerContractId: primaryDatabaseRulePack?.contract.id,
                  answerContractVersion: primaryDatabaseRulePack?.contract.version,
                  answerContractCheckIds: databaseRuleCheckIds,
                },
              },
            }
          : undefined,
      }
    : safeBody;
  const enforceCourseContract =
    task !== 'not_applicable' &&
    Boolean(ruleAwareBody.courseContext?.serverCoursePack?.metadata.answerContractId);

  if (!enforceCourseContract) {
    const generator = statelessGenerate(ruleAwareBody, args.signal, args.languageModel, {
      enabled: false,
    } satisfies ThinkingConfig);
    for await (const event of generator) {
      if (args.signal.aborted) break;
      await args.onEvent(event);
    }
    return {
      answerContractEnforced: false,
      answerContractTask: task,
      generationAttempts: 1,
    };
  }

  let candidateBody = ruleAwareBody;
  let failures: string[] = [];
  let attempts = 0;
  for (let attempt = 0; attempt <= COURSE_CONTRACT_REPAIR_ATTEMPTS; attempt += 1) {
    attempts += 1;
    const events = await collectEvents(
      statelessGenerate(candidateBody, args.signal, args.languageModel, {
        enabled: false,
      } satisfies ThinkingConfig),
    );
    if (args.signal.aborted) break;

    const streamError = events.find(
      (event): event is Extract<StatelessEvent, { type: 'error' }> => event.type === 'error',
    );
    if (streamError) {
      await args.onEvent(streamError);
      return {
        answerContractEnforced: true,
        answerContractTask: task,
        generationAttempts: attempts,
      };
    }

    if (databaseRuleContext?.packs.length) {
      failures = validateCourseRulePacks({
        packs: databaseRuleContext.packs,
        task,
        reviewText: courseContractMessage,
        answerText: answerText(events),
      }).flatMap(formatCourseAnswerContractValidationFailures);
    } else {
      const result = validateCourseAnswerContract({
        courseCode: safeBody.courseContext?.course.courseCode,
        courseName: safeBody.courseContext?.course.name,
        courseId: safeBody.courseContext?.course.id,
        message: courseContractMessage,
        answerText: answerText(events),
        taskHint: task,
      });
      failures = formatCourseAnswerContractValidationFailures(result);
    }
    if (failures.length === 0) {
      for (const event of events) {
        if (args.signal.aborted) break;
        await args.onEvent(event);
      }
      return {
        answerContractEnforced: true,
        answerContractTask: task,
        generationAttempts: attempts,
      };
    }

    log.warn(
      `Course answer contract rejected draft [course=${safeBody.courseContext?.course.courseCode || safeBody.courseContext?.course.id}, attempt=${attempt}, failures=${failures.length}]`,
    );
    if (
      attempt < COURSE_CONTRACT_REPAIR_ATTEMPTS &&
      ruleAwareBody.courseContext?.serverCoursePack
    ) {
      candidateBody = {
        ...ruleAwareBody,
        courseContext: {
          ...ruleAwareBody.courseContext,
          serverCoursePack: {
            ...ruleAwareBody.courseContext.serverCoursePack,
            repair: { attempt: attempt + 1, validationFailures: failures },
          },
        },
      };
    }
  }

  if (args.signal.aborted) {
    return {
      answerContractEnforced: true,
      answerContractTask: task,
      generationAttempts: attempts,
    };
  }

  throw new TrustedCourseTurnError(
    'course_answer_contract_rejected',
    422,
    `课程回答未通过 ${safeBody.courseContext?.course.courseCode || '当前课程'} 规范校验；系统已自动修复重试，但仍有 ${failures.length} 项不合格。为避免展示错误答案，本次回答已拦截，请重试或补充题目要求。`,
    failures,
  );
}

export async function collectTrustedCourseTurn(
  args: Omit<Parameters<typeof runTrustedCourseTurn>[0], 'onEvent'>,
): Promise<CollectedTrustedCourseTurn> {
  const events: StatelessEvent[] = [];
  const result = await runTrustedCourseTurn({
    ...args,
    onEvent: (event) => {
      events.push(event);
    },
  });
  return {
    ...result,
    events,
    answer: answerText(events),
  };
}
