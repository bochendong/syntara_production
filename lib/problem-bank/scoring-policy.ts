import type { NotebookProblemAttemptResult, NotebookProblemType } from '@/lib/problem-bank/schema';

export const STANDARD_PROBLEM_POINTS = 100;
export const LIMITED_SUBMISSION_COUNT = 3;

const LIMITED_ATTEMPT_TYPES = new Set<NotebookProblemType>([
  'choice',
  'calculation',
  'fill_blank',
  'code',
]);

// A wrong first attempt uses the first 40-point opportunity; a wrong second
// attempt uses the next 30. The final attempt can therefore earn at most 30.
const MAX_SCORE_BY_ATTEMPT = [100, 60, 30] as const;

export function hasLimitedSubmissions(type: NotebookProblemType): boolean {
  return LIMITED_ATTEMPT_TYPES.has(type);
}

export function maxScoreForAttempt(attemptNumber: number): number {
  return MAX_SCORE_BY_ATTEMPT[Math.max(0, Math.min(2, attemptNumber - 1))];
}

export function remainingSubmissions(submissionCount: number): number {
  return Math.max(0, LIMITED_SUBMISSION_COUNT - submissionCount);
}

function roundScore(score: number): number {
  return Math.round(score * 10) / 10;
}

export function applySubmissionScorePolicy(args: {
  type: NotebookProblemType;
  attemptNumber: number;
  score: number;
  result: NotebookProblemAttemptResult;
  language: 'zh-CN' | 'en-US';
}): { score: number; result: NotebookProblemAttemptResult } {
  const normalizedScore = Math.max(0, Math.min(STANDARD_PROBLEM_POINTS, args.score));
  if (!hasLimitedSubmissions(args.type)) {
    const score = roundScore(normalizedScore);
    return { score, result: { ...args.result, earnedPoints: score } };
  }

  const maximum = maxScoreForAttempt(args.attemptNumber);
  const score = roundScore((normalizedScore / STANDARD_PROBLEM_POINTS) * maximum);
  const policyFeedback =
    args.language === 'zh-CN'
      ? `第 ${args.attemptNumber}/${LIMITED_SUBMISSION_COUNT} 次提交，本次最高可得 ${maximum} 分。`
      : `Submission ${args.attemptNumber}/${LIMITED_SUBMISSION_COUNT}; this attempt is worth up to ${maximum} points.`;

  return {
    score,
    result: {
      ...args.result,
      earnedPoints: score,
      feedback: [args.result.feedback, policyFeedback].filter(Boolean).join('\n\n'),
    },
  };
}
