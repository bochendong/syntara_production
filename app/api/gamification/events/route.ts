import { z } from 'zod';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireUserId } from '@/lib/server/api-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  buildGamificationDisabledEvent,
  logGamificationError,
  recordGamificationEvent,
} from '@/lib/server/gamification';

const lessonSchema = z.object({
  type: z.literal('lesson_milestone_completed'),
  courseId: z.string().trim().min(1),
  courseName: z.string().trim().optional(),
  progressPercent: z.number().finite().min(0).max(100),
  checkpointCount: z.number().finite().int().min(0),
});

const quizSchema = z.object({
  type: z.literal('quiz_completed'),
  sceneId: z.string().trim().min(1),
  sceneTitle: z.string().trim().optional(),
  referenceKey: z.string().trim().min(1),
  questionCount: z.number().finite().int().min(1),
  correctCount: z.number().finite().int().min(0),
  accuracyPercent: z.number().finite().min(0).max(100),
});

const reviewSchema = z.object({
  type: z.literal('review_completed'),
  sceneId: z.string().trim().min(1),
  sceneTitle: z.string().trim().optional(),
  referenceKey: z.string().trim().min(1),
  hadPreviousIncorrect: z.boolean(),
});

const bodySchema = z.union([lessonSchema, quizSchema, reviewSchema]);

export async function POST(request: Request) {
  const auth = await requireUserId();
  if ('response' in auth) return auth.response;

  let body: z.infer<typeof bodySchema>;
  try {
    body = bodySchema.parse(await request.json());
  } catch (error) {
    return apiError('INVALID_REQUEST', 400, error instanceof Error ? error.message : '请求体无效');
  }

  const prisma = getOptionalPrisma();
  if (!prisma) {
    return apiSuccess({ ...buildGamificationDisabledEvent(body.type) });
  }

  try {
    const result = await prisma.$transaction((tx) =>
      recordGamificationEvent(tx, auth.userId, body),
    );
    return apiSuccess({ ...result });
  } catch (error) {
    logGamificationError('Failed to record gamification event', error);
    return apiError('INVALID_REQUEST', 400, error instanceof Error ? error.message : '奖励结算失败');
  }
}
