import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { gradeQuizAnswer } from '@/features/practice/server';
import { createLogger } from '@/lib/logger';
import { isValidPhotoAnswerUpload } from '@/lib/problem-bank/photo-answer';
import { requireAdmin, requireResolvedUser } from '@/lib/server/admin-auth';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { publicApiRequestId, requireNativePlatformApi } from '@/lib/server/public-api';
import { withRequestContext } from '@/lib/server/request-context';

const log = createLogger('Quiz Grade');
const requestSchema = z.object({
  question: z.string().trim().min(1).max(20_000),
  userAnswer: z.string().trim().min(1).max(20_000),
  points: z.number().int().min(1).max(100),
  language: z.enum(['zh-CN', 'en-US']).optional(),
  questionType: z.enum(['short_answer', 'proof', 'code_tracing']).optional(),
  commentPrompt: z.string().trim().max(12_000).optional(),
  referenceAnswer: z.string().trim().max(20_000).optional(),
  proof: z.string().trim().max(20_000).optional(),
  analysis: z.string().trim().max(20_000).optional(),
  images: z
    .array(
      z
        .object({ dataUrl: z.string(), mimeType: z.string(), size: z.number() })
        .refine(isValidPhotoAnswerUpload),
    )
    .max(4)
    .optional(),
});

export async function POST(req: NextRequest) {
  let userId: string;
  if (process.env.SYNTARA_APP_ENV === 'staging') {
    // Reuse the native test-account gate; administrators may also run isolated checks.
    const native = await requireNativePlatformApi(req, publicApiRequestId(req));
    if (native instanceof NextResponse) {
      const admin = await requireAdmin();
      if ('response' in admin) return native;
      const expectedOrigin = new URL(process.env.NEXTAUTH_URL || req.url).origin;
      if (req.headers.get('origin') !== expectedOrigin) {
        return apiError('INVALID_REQUEST', 403, 'Invalid request origin');
      }
      userId = admin.identity.userId;
    } else {
      userId = native.userId;
    }
  } else {
    const user = await requireResolvedUser();
    if (!user) return apiError('INVALID_REQUEST', 401, 'Please sign in');
    userId = user.id;
  }
  try {
    const parsed = requestSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return apiError('INVALID_REQUEST', 400, 'Invalid grading request');
    }
    const gradeResult = await withRequestContext({ userId, route: '/api/quiz-grade' }, () =>
      gradeQuizAnswer(parsed.data, req),
    );
    return apiSuccess({ ...gradeResult });
  } catch (error) {
    log.error('Error:', error);
    return apiError('INTERNAL_ERROR', 500, 'Failed to grade answer');
  }
}
