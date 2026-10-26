import type { LocalProblem } from '../domain/models';
import type { NativeGradeRequest } from './platform-api-contracts';
import { problemStem } from './local-problem-grading';

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** Keep the bank's reference proof and rubric together when calling the native grader. */
export function problemAiGradeRequest(
  problem: LocalProblem,
  userAnswer: string,
): NativeGradeRequest {
  const grading = problem.grading;
  const criteria = Array.isArray(grading.rubricCriteria)
    ? grading.rubricCriteria.flatMap((value) => {
        if (!value || typeof value !== 'object') return [];
        const row = value as Record<string, unknown>;
        return typeof row.description === 'string' &&
          typeof row.points === 'number' &&
          Number.isFinite(row.points) &&
          row.points > 0
          ? [{ description: row.description, points: row.points }]
          : [];
      })
    : [];
  const total = criteria.reduce((sum, row) => sum + row.points, 0);
  const rawPoints =
    typeof grading.points === 'number' && grading.points > 0
      ? grading.points
      : total > 0
        ? total
        : 10;
  const points = Math.max(1, Math.min(100, Math.round(rawPoints)));
  const commentPrompt = [
    optionalText(grading.commentPrompt),
    optionalText(grading.rubric),
    criteria.length
      ? `评分要点（原始总分 ${total}，请按比例换算到本次满分 ${points}）：\n${criteria
          .map((row, index) => `${index + 1}. ${row.description}（${row.points} 分）`)
          .join('\n')}`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n\n');
  return {
    question: problemStem(problem),
    userAnswer,
    points,
    language: 'zh-CN',
    questionType: problem.type === 'proof' ? 'proof' : 'short_answer',
    referenceAnswer: optionalText(grading.referenceAnswer),
    proof: optionalText(grading.referenceProof) ?? optionalText(grading.proof),
    analysis: optionalText(grading.analysis),
    commentPrompt: commentPrompt || undefined,
  };
}
