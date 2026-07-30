import { NextRequest, NextResponse } from 'next/server';
import {
  nativeMiniLectureRequestSchema,
  type NativeMiniLectureErrorBody,
  type NativeMiniLectureSuccessBody,
} from '@/features/native-api/domain/mini-lecture';
import {
  generateNativeMiniLecture,
  NativeMiniLectureServiceError,
} from '@/features/native-api/server/mini-lecture-service';
import { publicApiRequestId, requireNativePlatformApi } from '@/lib/server/public-api';
import { withRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';
export const maxDuration = 300;

function errorResponse(
  error: NativeMiniLectureErrorBody['error'],
  status: number,
  requestId: string,
): Response {
  const body: NativeMiniLectureErrorBody = { ok: false, error };
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': requestId,
    },
  });
}

export async function POST(request: NextRequest): Promise<Response> {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;

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
      requestId,
    );
  }

  const bodyRecord =
    rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
      ? (rawBody as Record<string, unknown>)
      : null;
  const headerIdempotencyKey = request.headers.get('idempotency-key')?.trim() || undefined;
  const bodyIdempotencyKey =
    typeof bodyRecord?.idempotencyKey === 'string' ? bodyRecord.idempotencyKey.trim() : undefined;
  if (headerIdempotencyKey && bodyIdempotencyKey && headerIdempotencyKey !== bodyIdempotencyKey) {
    return errorResponse(
      {
        code: 'INVALID_REQUEST',
        stage: 'validation',
        message: 'Idempotency-Key header must match body.idempotencyKey.',
        retryable: false,
      },
      400,
      requestId,
    );
  }
  if (bodyRecord && !bodyIdempotencyKey && headerIdempotencyKey) {
    bodyRecord.idempotencyKey = headerIdempotencyKey;
  }

  const parsed = nativeMiniLectureRequestSchema.safeParse(bodyRecord);
  if (!parsed.success || !parsed.data.idempotencyKey) {
    return errorResponse(
      {
        code: 'INVALID_REQUEST',
        stage: 'validation',
        message: parsed.success
          ? 'idempotencyKey or Idempotency-Key header is required.'
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
      requestId,
    );
  }
  const idempotencyKey = parsed.data.idempotencyKey;

  try {
    const serviceHeaders = new Headers(request.headers);
    serviceHeaders.set('x-user-id', principal.userId);
    const result = await withRequestContext(
      {
        userId: principal.userId,
        route: '/api/native/v1/mini-lectures',
        operationCode: 'native_mini_lecture_generation',
        chargeReason: '生成原生端图片课堂讲解',
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
        'X-Request-Id': requestId,
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
        requestId,
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
      requestId,
    );
  }
}
