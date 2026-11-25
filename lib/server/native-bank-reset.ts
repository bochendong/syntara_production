import { z } from 'zod';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { visibleProblemWhere } from './native-problem-sync';

export const bankResetSchema = z.object({
  action: z.literal('resetPractice'),
  courseId: z.string().min(1).max(200),
  problemIds: z.array(z.string().min(1).max(200)).min(1).max(10000),
  through: z.number().int().positive().max(8_640_000_000_000_000),
});

export async function resetBankPractice(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof bankResetSchema>,
) {
  const visible = await visibleProblemWhere(db, userId, input.courseId);
  if (!visible) return null;
  const ids = [...new Set(input.problemIds)];
  const cutoff = new Date(Math.min(Date.now(), input.through));
  return db.$transaction(async (tx) => {
    // Serialize resets with grading and offline replays for this account.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 37501))`;
    const count = await tx.notebookProblem.count({ where: { ...visible, id: { in: ids } } });
    if (count !== ids.length) return null;
    const newer = await tx.notebookProblemProgress.count({
      where: {
        userId,
        problemId: { in: ids },
        lastAttemptAt: { gt: cutoff },
        OR: [{ resetAt: null }, { resetAt: { lt: cutoff } }],
      },
    });
    if (newer) return { conflict: true } as const;
    await tx.$executeRaw`
      INSERT INTO "NotebookProblemProgress" (id, "userId", "problemId", "resetAt", "updatedAt")
      SELECT gen_random_uuid()::text, ${userId}, id, (${cutoff}::timestamptz AT TIME ZONE 'UTC'), (NOW() AT TIME ZONE 'UTC') FROM unnest(${ids}::text[]) AS selected(id)
      ON CONFLICT ("problemId", "userId") DO UPDATE SET
        "resetAt" = EXCLUDED."resetAt", "updatedAt" = EXCLUDED."updatedAt", "latestAttemptId" = NULL,
        status = 'pending', score = NULL, "attemptedCount" = 0, "passedCount" = 0, "lastAttemptAt" = NULL
      WHERE "NotebookProblemProgress"."resetAt" IS NULL OR "NotebookProblemProgress"."resetAt" < EXCLUDED."resetAt"
    `;
    return { resetAt: cutoff.getTime() };
  });
}
