import { z } from 'zod';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { visibleProblemWhere } from './native-problem-sync';
import {
  attemptScoreRatio,
  syncedAttemptAnswer,
  syncedAttemptResult,
} from '@/lib/problem-bank/synced-attempt';

const PAGE_SIZE = 20;
const cursorSchema = z.object({
  id: z.string().min(1).max(200),
  at: z.number().int().positive().max(8_640_000_000_000_000),
});

export function parseAttemptCursor(value: string | null) {
  if (!value) return null;
  if (value.length > 1000) throw new Error('Invalid cursor');
  return cursorSchema.parse(JSON.parse(value));
}

/** The authenticated learner's own submissions, subject to the same course/problem visibility. */
export async function readNativeProblemAttempts(
  prisma: PrismaClient,
  userId: string,
  courseId: string,
  problemId: string,
  before: z.infer<typeof cursorSchema> | null,
  classSessionId?: string,
) {
  const visible = await visibleProblemWhere(prisma, userId, courseId);
  if (!visible) return null;
  const problem = await prisma.notebookProblem.findFirst({
    where: { ...visible, id: problemId },
    select: { id: true, points: true },
  });
  if (!problem) return null;
  const rows = await prisma.notebookProblemAttempt.findMany({
    where: {
      userId,
      problemId,
      kind: { in: ['answer', 'submit'] },
      ...(classSessionId ? { classSessionId } : {}),
      ...(before
        ? {
            OR: [
              { createdAt: { lt: new Date(before.at) } },
              { createdAt: new Date(before.at), id: { lt: before.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    select: {
      id: true,
      kind: true,
      classSessionId: true,
      answerJson: true,
      resultJson: true,
      score: true,
      status: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  const page = rows.slice(0, PAGE_SIZE);
  const last = page.at(-1);
  return {
    attempts: page.map((row) => ({
      id: row.id,
      problemId,
      kind: 'submit',
      answer: syncedAttemptAnswer(row.answerJson),
      result: {
        ...syncedAttemptResult(row.resultJson, problem.points),
        classSessionId: row.classSessionId,
        ...(row.kind === 'submit' ? { serverCodeId: row.id } : {}),
      },
      score: attemptScoreRatio(row.score, problem.points),
      status: row.status,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    })),
    nextCursor:
      rows.length > PAGE_SIZE && last
        ? JSON.stringify({ id: last.id, at: last.createdAt.getTime() })
        : null,
  };
}
