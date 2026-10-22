import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { saveNativeLearningProgress } from '@/lib/server/native-course-sync';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

const learningProgressSchema = z.object({
  courseId: z.string().trim().min(1).max(200),
  kind: z.enum(['not_started', 'notebook', 'completed_all']),
  notebookId: z.string().trim().min(1).max(200).nullish(),
});

/** App 上拖动学习进度后写回账号，和网页右侧的学习进度是同一份。 */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const prisma = getOptionalPrisma();
  if (!prisma) {
    return publicApiError(
      requestId,
      503,
      'auth_not_configured',
      'Progress storage is unavailable.',
    );
  }
  const parsed = learningProgressSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid learning progress.');
  }
  const progress = await saveNativeLearningProgress(prisma, principal.userId, parsed.data);
  if (!progress) return publicApiError(requestId, 404, 'not_found', 'Course not found.');
  return publicApiSuccess(requestId, { learningProgress: progress });
}
