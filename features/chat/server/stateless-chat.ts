import type { NextRequest } from 'next/server';
import type { StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import { apiError } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { resolveModel } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';
import { buildTrustedCourseQuestionContext } from '@/lib/chat/server-course-question-context';
import {
  latestTrustedCourseUserText,
  resolveTrustedCourseTurn,
  runTrustedCourseTurn,
  TrustedCourseTurnError,
} from '@/features/chat/server/trusted-course-turn';

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

export async function handleStatelessChatRequest(req: NextRequest) {
  const encoder = new TextEncoder();

  try {
    const requestedBody: StatelessChatRequest = await req.json();
    const validationError = validateStatelessChatRequest(requestedBody);
    if (validationError) return validationError;

    const { model: languageModel, modelString } = await resolveModel(
      {
        modelString: requestedBody.model,
        apiKey: requestedBody.apiKey,
        baseUrl: requestedBody.baseUrl,
        providerType: requestedBody.providerType,
        requiresApiKey: requestedBody.requiresApiKey,
      },
      { allowOpenAIModelOverride: true },
    );
    const trusted = await resolveTrustedCourseTurn({ body: requestedBody });
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
              const serverContext = await buildTrustedCourseQuestionContext({
                userId: trusted.authenticatedUserId,
                courseId: trusted.courseId,
                question: latestTrustedCourseUserText(body),
                model: languageModel,
              });
              trustedBody = (
                await resolveTrustedCourseTurn({
                  body,
                  authenticatedUserId: trusted.authenticatedUserId,
                  serverCourseContext: serverContext.courseContext,
                })
              ).body;
            }

            await runTrustedCourseTurn({
              body: trustedBody,
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
          const errorEvent: StatelessEvent = {
            type: 'error',
            data: {
              message: error instanceof Error ? error.message : String(error),
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
