import type { NextRequest } from 'next/server';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { resolveModel } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';
import { buildTrustedCourseQuestionContext } from '@/lib/chat/server-course-question-context';
import {
  attachTrustedServerCourseContext,
  latestTrustedCourseUserText,
  resolveTrustedCourseTurn,
  runTrustedCourseTurn,
  TrustedCourseTurnError,
} from '@/features/chat/server/trusted-course-turn';
import { shouldUseDirectCourseAnswerFastPath } from '@/features/learn-core/server/decision-chain';
import { verifyTrustedLearnAnswererHandoff } from '@/features/learn-core/server/trusted-answerer-handoff';
import { inferMemorySearchIntent } from '@/lib/server/memory-search-intent';
import {
  runStudentCourseTurn,
  runTeacherCourseTurn,
} from '@/features/chat/server/teacher-course-agent';
import {
  COURSE_DATABASE_UNAVAILABLE_MESSAGE,
  isDatabaseUnavailableError,
} from '@/lib/server/json-error-response';

const log = createLogger('Chat API');
const HEARTBEAT_INTERVAL_MS = 15_000;

export const CHAT_STREAM_MAX_DURATION_SECONDS = 60;

function validateStatelessChatRequest(body: StatelessChatRequest) {
  if (!body.messages || !Array.isArray(body.messages)) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: messages');
  }

  if (!body.storeState) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: storeState');
  }

  if (!body.config || !body.config.agentIds || body.config.agentIds.length === 0) {
    return apiError('MISSING_REQUIRED_FIELD', 400, 'Missing required field: config.agentIds');
  }

  return null;
}

function stripTrustedLearnHandoffToken(body: StatelessChatRequest): StatelessChatRequest {
  const sanitized = { ...body };
  delete sanitized.trustedLearnAnswererHandoffToken;
  return sanitized;
}

function requestHasOpenAIFileInput(body: StatelessChatRequest): boolean {
  return body.messages.some((message) =>
    message.parts?.some((part) => {
      const value = part as { type?: unknown; url?: unknown };
      return (
        value.type === 'file' && typeof value.url === 'string' && value.url.startsWith('file-')
      );
    }),
  );
}

function usesNativeCourseAgent(body: StatelessChatRequest): boolean {
  return (
    body.config.surface === 'teacher-course-chat' || body.config.surface === 'student-course-chat'
  );
}

export async function handleStatelessChatRequest(req: NextRequest) {
  const encoder = new TextEncoder();
  try {
    const parsedBody = (await req.json()) as StatelessChatRequest | null;
    if (!parsedBody || typeof parsedBody !== 'object') {
      return apiError('INVALID_REQUEST', 400, 'Request body must be a JSON object');
    }
    const validationError = validateStatelessChatRequest(parsedBody);
    if (validationError) return validationError;

    const {
      model: languageModel,
      modelString,
      providerId,
    } = await resolveModel(
      {
        modelString: parsedBody.model,
        responseStrength: parsedBody.config.responseStrength,
        apiKey: parsedBody.apiKey,
        baseUrl: parsedBody.baseUrl,
        providerType: parsedBody.providerType,
        requiresApiKey: parsedBody.requiresApiKey,
      },
      {
        allowOpenAIModelOverride: true,
        useOpenAIResponses:
          requestHasOpenAIFileInput(parsedBody) || usesNativeCourseAgent(parsedBody),
      },
    );
    const trusted = await resolveTrustedCourseTurn({ body: parsedBody });
    const body = trusted.body;

    log.info(`Processing request [model=${modelString}]`);
    log.info(
      `Agents: ${body.config.agentIds.join(', ')}, Messages: ${body.messages.length}, Turn: ${body.directorState?.turnCount ?? 0}`,
    );

    const signal = req.signal;
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    void (async () => {
      let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
      const startHeartbeat = () => {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          try {
            writer.write(encoder.encode(`:heartbeat\n\n`)).catch(() => stopHeartbeat());
          } catch {
            stopHeartbeat();
          }
        }, HEARTBEAT_INTERVAL_MS);
      };
      const stopHeartbeat = () => {
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
      };

      try {
        startHeartbeat();

        await runWithRequestContext(
          req,
          '/api/chat',
          async () => {
            if (body.config.surface === 'teacher-course-chat') {
              if (!trusted.courseAccess || trusted.courseAccess.role !== 'owner') {
                throw new TrustedCourseTurnError(
                  'unauthorized',
                  403,
                  'Teacher course chat requires verified course owner access.',
                );
              }
              await runTeacherCourseTurn({
                body: stripTrustedLearnHandoffToken(body),
                signal,
                languageModel,
                modelString,
                providerId,
                access: trusted.courseAccess,
                onEvent: async (event) => {
                  if (signal.aborted) return;
                  await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                },
              });
              return;
            }
            if (body.config.surface === 'student-course-chat') {
              if (!trusted.courseAccess || trusted.courseAccess.role !== 'enrolled') {
                throw new TrustedCourseTurnError(
                  'unauthorized',
                  403,
                  'Student course chat requires verified enrollment access.',
                );
              }
              await runStudentCourseTurn({
                body: stripTrustedLearnHandoffToken(body),
                signal,
                languageModel,
                modelString,
                providerId,
                access: trusted.courseAccess,
                onEvent: async (event) => {
                  if (signal.aborted) return;
                  await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
                },
              });
              return;
            }

            let trustedBody = body;
            if (
              body.config.surface === 'course-chat' &&
              trusted.contextSource !== 'development_mock'
            ) {
              if (!trusted.authenticatedUserId || !trusted.courseId) {
                throw new TrustedCourseTurnError(
                  'unauthorized',
                  401,
                  'Authenticated course context is required.',
                );
              }
              const latestQuestion = latestTrustedCourseUserText(body);
              const directAnswerFastPath = shouldUseDirectCourseAnswerFastPath({
                question: latestQuestion,
                courseId: trusted.courseId,
              });
              const trustedPlannerHandoff = verifyTrustedLearnAnswererHandoff({
                token: body.trustedLearnAnswererHandoffToken,
                userId: trusted.authenticatedUserId,
                courseId: trusted.courseId,
                question: latestQuestion,
              });
              const serverContext = await buildTrustedCourseQuestionContext({
                userId: trusted.authenticatedUserId,
                courseId: trusted.courseId,
                question: latestQuestion,
                searchIntent: directAnswerFastPath
                  ? inferMemorySearchIntent(latestQuestion, 'course')
                  : undefined,
                trustedAccess: trusted.courseAccess,
                trustedPlannerHandoff,
                model: languageModel,
              });
              await writer.write(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'course_evidence',
                    data: {
                      courseId: trusted.courseId,
                      items: serverContext.evidence,
                    },
                  } satisfies StatelessEvent)}\n\n`,
                ),
              );
              trustedBody = attachTrustedServerCourseContext({
                resolved: trusted,
                serverCourseContext: serverContext.courseContext,
              });
            }

            await runTrustedCourseTurn({
              body: stripTrustedLearnHandoffToken(trustedBody),
              signal,
              languageModel,
              onEvent: async (event) => {
                if (signal.aborted) return;
                await writer.write(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
              },
            });
          },
          {
            courseId: body.courseContext?.course.id,
            courseName: body.courseContext?.course.name,
          },
        );
        if (signal.aborted) {
          log.info('Request was aborted');
        }

        stopHeartbeat();
        await writer.close();
      } catch (error) {
        stopHeartbeat();

        if (signal.aborted) {
          log.info('Request aborted during streaming');
          try {
            await writer.close();
          } catch {
            /* already closed */
          }
          return;
        }

        log.error('Stream error:', error);

        try {
          const publicMessage = isDatabaseUnavailableError(error)
            ? COURSE_DATABASE_UNAVAILABLE_MESSAGE
            : error instanceof Error
              ? error.message
              : String(error);
          const errorEvent: StatelessEvent = {
            type: 'error',
            data: {
              message: publicMessage,
            },
          };
          await writer.write(encoder.encode(`data: ${JSON.stringify(errorEvent)}\n\n`));
          await writer.close();
        } catch {
          /* Writer may already be closed. */
        }
      }
    })();

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });
  } catch (error) {
    log.error('Error:', error);
    if (isDatabaseUnavailableError(error)) {
      return apiError('INTERNAL_ERROR', 503, COURSE_DATABASE_UNAVAILABLE_MESSAGE);
    }
    if (error instanceof TrustedCourseTurnError) {
      return apiError(
        error.code === 'missing_course_id' ? 'MISSING_REQUIRED_FIELD' : 'INVALID_REQUEST',
        error.status,
        error.message,
      );
    }
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to process request',
    );
  }
}
