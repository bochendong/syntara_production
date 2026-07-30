import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { gradeQuizAnswer } from '@/features/practice/server';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';
import { withRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';
export const maxDuration = 120;

const requestSchema = z
  .object({
    question: z.string().trim().min(1).max(20_000),
    userAnswer: z.string().trim().min(1).max(20_000),
    points: z.number().int().min(1).max(100),
    commentPrompt: z.string().trim().max(12_000).optional(),
    language: z.enum(['zh-CN', 'en-US']).optional(),
    questionType: z.enum(['short_answer', 'proof', 'code_tracing']).optional(),
    referenceAnswer: z.string().trim().max(20_000).optional(),
    proof: z.string().trim().max(20_000).optional(),
    analysis: z.string().trim().max(20_000).optional(),
    model: z.never().optional(),
    apiKey: z.never().optional(),
    baseUrl: z.never().optional(),
  })
  .passthrough();

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Invalid native grading request.',
      parsed.error.flatten(),
    );
  }
  try {
    const result = await withRequestContext(
      {
        userId: principal.userId,
        route: '/api/native/v1/grade',
        operationCode: 'native_grade_answer',
        chargeReason: '原生端 AI 批改',
      },
      () => gradeQuizAnswer(parsed.data, request),
    );
    return publicApiSuccess(requestId, result);
  } catch (error) {
    return publicApiError(
      requestId,
      500,
      'generation_failed',
      error instanceof Error ? error.message : 'Native grading failed.',
    );
  }
}
