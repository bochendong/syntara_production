import type { NotebookProblemAttemptResult } from '@/lib/problem-bank/schema';

export const STANDARD_PROBLEM_POINTS = 100;

/** Every submission is graded on its answer, independent of earlier attempts. */
export function applySubmissionScorePolicy(args: {
  score: number;
  result: NotebookProblemAttemptResult;
}): { score: number; result: NotebookProblemAttemptResult } {
  const score = Math.round(Math.max(0, Math.min(STANDARD_PROBLEM_POINTS, args.score)) * 10) / 10;
  return { score, result: { ...args.result, earnedPoints: score } };
}
