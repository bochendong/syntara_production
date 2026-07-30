import { NextRequest } from 'next/server';
import {
  nativeMiniLectureRequestSchema,
  type NativeMiniLectureErrorBody,
  type NativeMiniLectureSuccessBody,
} from '@/features/native-api/domain/mini-lecture';
import {
  generateNativeMiniLecture,
  NativeMiniLectureServiceError,
} from '@/features/native-api/server/mini-lecture-service';
import { requireUserId } from '@/lib/server/api-auth';
import { withRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';
export const maxDuration = 300;

function errorResponse(error: NativeMiniLectureErrorBody['error'], status: number): Response {
  return Response.json({ ok: false, error } satisfies NativeMiniLectureErrorBody, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await requireUserId();
  if ('response' in auth) {
    return auth.response ?? Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errorResponse(
      {
        code: 'INVALID_REQUEST',
        stage: 'validation',
        message: 'Request body must be valid JSON.',
        retryable: false,
      },
      400,
    );
  }

  const parsed = nativeMiniLectureRequestSchema.safeParse(rawBody);
  const idempotencyKey = parsed.success ? parsed.data.idempotencyKey : undefined;
  if (!parsed.success || !idempotencyKey) {
    return errorResponse(
      {
        code: 'INVALID_REQUEST',
        stage: 'validation',
        message: parsed.success
          ? 'idempotencyKey is required.'
          : 'Mini-lecture request validation failed.',
        retryable: false,
        details: parsed.success
          ? undefined
          : {
              issues: parsed.error.issues.map((issue) => ({
                path: issue.path.join('.'),
                code: issue.code,
                message: issue.message,
              })),
            },
      },
      400,
    );
  }

  try {
    const serviceHeaders = new Headers(request.headers);
    serviceHeaders.set('x-user-id', auth.userId);
    const result = await withRequestContext(
      {
        userId: auth.userId,
        route: '/api/learn/mini-lectures',
        operationCode: 'learn_mini_lecture_generation',
        chargeReason: '生成课程图片课堂讲解',
      },
      () =>
        generateNativeMiniLecture({
          context: {
            requestUrl: request.url,
            headers: serviceHeaders,
          },
          input: {
            ...parsed.data,
            idempotencyKey,
          },
        }),
    );
    const body: NativeMiniLectureSuccessBody = {
      ok: true,
      data: result.manifest,
      meta: {
        idempotency: {
          key: idempotencyKey,
          replayed: result.replayed,
          scope: 'server-process',
        },
      },
    };
    return Response.json(body, {
      status: result.replayed ? 200 : 201,
      headers: {
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Idempotent-Replay': result.replayed ? 'true' : 'false',
      },
    });
  } catch (error) {
    if (error instanceof NativeMiniLectureServiceError) {
      return errorResponse(
        {
          code: error.code,
          stage: error.stage,
          message: error.message,
          retryable: error.retryable,
          details: error.details,
        },
        error.status,
      );
    }
    return errorResponse(
      {
        code: 'INTERNAL_ERROR',
        stage: 'internal',
        message: error instanceof Error ? error.message : 'Unexpected mini-lecture error.',
        retryable: false,
      },
      500,
    );
  }
}
