import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import {
  nativeBoundedAttemptContextSchema,
  nativeBoundedRecordSchema,
  nativeTeachingTurnRequestSchema,
  runNativeTeachingTurn,
} from '@/features/native-api/server/teaching-turn';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';
import { withRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';
export const maxDuration = 180;
const MAX_NATIVE_REVIEW_BODY_BYTES = 2 * 1024 * 1024;

const requestSchema = z.object({
  course: z.object({
    id: z.string().trim().min(1).max(200),
    name: z.string().trim().max(200).optional(),
    code: z.string().trim().max(80).optional(),
  }),
  query: z.string().trim().min(1).max(4000),
  today: z.string().trim().max(40).optional(),
  scheduleEvents: z.array(nativeBoundedRecordSchema).max(120).default([]),
  attempts: z.array(nativeBoundedAttemptContextSchema).max(24).default([]),
  memories: z.array(nativeBoundedRecordSchema).max(40).default([]),
  problemCandidates: z.array(nativeBoundedRecordSchema).max(40).default([]),
  constraints: z
    .object({
      totalMinutes: z.number().int().min(5).max(1_440).optional(),
      questionCount: z.number().int().min(1).max(40).optional(),
      maxTasks: z.number().int().min(1).max(20).optional(),
    })
    .strict()
    .optional(),
});

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_NATIVE_REVIEW_BODY_BYTES) {
    return publicApiError(
      requestId,
      413,
      'invalid_request',
      'Native review-plan context exceeds the 2 MB request limit.',
    );
  }
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Invalid native review-plan request.',
      parsed.error.flatten(),
    );
  }
  const input = nativeTeachingTurnRequestSchema.parse({
    requestId,
    clientTurnId: requestId,
    question: parsed.data.query,
    course: {
      id: parsed.data.course.id,
      name: parsed.data.course.name || parsed.data.course.code || '本机课程',
      code: parsed.data.course.code,
      language: 'zh-CN',
    },
    conversation: {
      id: `native-review-${requestId}`,
      recentMessages: [{ role: 'user', text: parsed.data.query }],
    },
    localContext: {
      calendarEvents: parsed.data.scheduleEvents,
      memories: parsed.data.memories,
      attempts: parsed.data.attempts,
      problemCandidates: parsed.data.problemCandidates,
      recentPlans:
        parsed.data.today || parsed.data.constraints
          ? [
              {
                kind: 'native_review_request',
                today: parsed.data.today,
                constraints: parsed.data.constraints,
              },
            ]
          : [],
    },
    preferences: { language: 'zh-CN', allowWebSearch: false },
  });
  try {
    const result = await withRequestContext(
      {
        userId: principal.userId,
        route: '/api/native/v1/review-plans',
        operationCode: 'native_review_plan',
        chargeReason: '原生端证据化复习计划',
      },
      () => runNativeTeachingTurn(request, input),
    );
    return publicApiSuccess(requestId, {
      decision: result.decision,
      messageMetadata: result.assistantMessage.metadata,
      text: result.assistantMessage.text,
    });
  } catch (error) {
    return publicApiError(
      requestId,
      500,
      'generation_failed',
      error instanceof Error ? error.message : 'Native review-plan generation failed.',
    );
  }
}
