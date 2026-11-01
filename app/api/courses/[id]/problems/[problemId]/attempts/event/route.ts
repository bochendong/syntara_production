import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  createNotebookProblemAttempt,
  getCourseProblemForUser,
} from '@/features/problems/server/service';
import { prisma } from '@/lib/server/prisma';

const eventSchema = z.object({
  event: z.enum(['solution_viewed', 'hidden_tests_viewed']),
});

/**
 * 学生在网页题库里打开了题解（或隐藏测试）。和 App 一样记一条不评分的记录，
 * 还没做对就看答案会成为学习记忆里的一次卡住。同一道题只记第一次。
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; problemId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id, problemId } = await context.params;

    const payload = eventSchema.safeParse(await request.json().catch(() => null));
    if (!payload.success) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const loaded = await getCourseProblemForUser(auth.userId, id, problemId);
    if (loaded.isTeacherPreview) return NextResponse.json({ recorded: false });

    const [progress, previous] = await Promise.all([
      prisma.notebookProblemProgress.findUnique({
        where: { problemId_userId: { problemId, userId: auth.userId } },
        select: { status: true, score: true, attemptedCount: true, passedCount: true },
      }),
      prisma.notebookProblemAttempt.findFirst({
        where: {
          userId: auth.userId,
          problemId,
          resultJson: { path: ['event'], equals: payload.data.event },
        },
        select: { id: true },
      }),
    ]);
    if (previous || (progress?.passedCount ?? 0) > 0) {
      return NextResponse.json({ recorded: false });
    }

    const maxScore = loaded.problem.points || 1;
    await createNotebookProblemAttempt({
      userId: auth.userId,
      problemId,
      kind: 'answer',
      status: 'pending',
      score: null,
      answer: {},
      result: {
        correct: null,
        event: payload.data.event,
        progressSnapshot: progress
          ? {
              status: progress.status,
              score:
                progress.score === null
                  ? null
                  : Math.max(0, Math.min(1, progress.score / maxScore)),
              attemptedCount: progress.attemptedCount,
            }
          : null,
        feedback:
          payload.data.event === 'solution_viewed'
            ? '在网页查看了参考答案。'
            : '在网页查看了隐藏测试。',
        publicCases: [],
      },
      timingSource: 'web-learning-snapshot',
      preserveProgress: true,
    });
    return NextResponse.json({ recorded: true });
  });
}
