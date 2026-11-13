import type { Prisma, PrismaClient } from '@/lib/server/generated-prisma';

const REWARDS = { easy: 3, medium: 5, hard: 8 } as const;

export async function brawlPracticeRewardCandidate(
  db: Prisma.TransactionClient,
  userId: string,
  problemId: string,
  currentAttemptId?: string,
) {
  const problem = await db.notebookProblem.findUnique({
    where: { id: problemId },
    select: { difficulty: true, status: true, ownerId: true },
  });
  if (problem?.status !== 'published' || problem.ownerId !== null) return 0;
  const user = await db.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (user?.role !== 'STUDENT' && user?.role !== 'USER') return 0;
  const prior = await db.notebookProblemAttempt.findFirst({
    where: {
      userId,
      problemId,
      ...(currentAttemptId ? { id: { not: currentAttemptId } } : {}),
      kind: { in: ['submit', 'answer'] },
      status: 'passed',
      OR: [{ brawlVerified: true }, { brawlVerified: null }],
    },
    select: { id: true },
  });
  if (prior) return 0;
  return REWARDS[problem.difficulty];
}

/** Called after the attempt's progress upsert, which serializes writes for this learner and problem. */
export async function awardBrawlPracticePoints(
  tx: Prisma.TransactionClient,
  userId: string,
  problemId: string,
  attemptId: string,
) {
  const points = await brawlPracticeRewardCandidate(tx, userId, problemId, attemptId);
  if (!points) return;
  const reward = await tx.brawlProblemReward.createMany({
    data: [{ userId, problemId, points }],
    skipDuplicates: true,
  });
  if (reward.count)
    await tx.user.update({
      where: { id: userId },
      data: { brawlPracticePoints: { increment: points } },
    });
}

export async function readBrawlPracticePoints(db: Prisma.TransactionClient, userId: string) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { brawlPracticePoints: true },
  });
  return user?.brawlPracticePoints ?? 0;
}

export async function transferBrawlPracticePoints(db: PrismaClient, userId: string, id: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR NO KEY UPDATE`;
    const prior = await tx.brawlPointTransfer.findUnique({ where: { userId_id: { userId, id } } });
    if (prior) return prior.points;
    const points = await readBrawlPracticePoints(tx, userId);
    await tx.brawlPointTransfer.create({ data: { userId, id, points } });
    if (points)
      await tx.user.update({
        where: { id: userId },
        data: { brawlPracticePoints: { decrement: points } },
      });
    return points;
  });
}
