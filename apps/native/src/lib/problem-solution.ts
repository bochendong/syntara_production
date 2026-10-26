import type { LocalProblem } from '../domain/models';
import { problemOptions } from '../data/local-problem-grading';

export type ProblemSolution = { answer: string; explanation: string; code: string };
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Read only stored reference material; never infer an answer from the learner's attempt. */
export function problemSolution(problem: LocalProblem): ProblemSolution {
  const grading = problem.grading;
  let answer = '';
  let code = '';
  const explanation = text(grading.analysis) || text(problem.publicContent.explanation);
  if (problem.type === 'choice') {
    const correct = Array.isArray(grading.correctOptionIds) ? grading.correctOptionIds : [];
    answer = problemOptions(problem)
      .filter((option) => correct.includes(option.id))
      .map((option) => `**${option.id}.** ${option.label}`)
      .join('\n\n');
  } else if (problem.type === 'code') {
    code = text(grading.solutionCode);
    const reference = text(grading.referenceAnswer);
    answer = reference === code ? '' : reference;
  } else if (problem.type === 'fill_blank' && Array.isArray(grading.blanks)) {
    answer = grading.blanks
      .map((blank, index) => {
        const row = blank as Record<string, unknown>;
        const accepted = Array.isArray(row.acceptedAnswers)
          ? row.acceptedAnswers.map(text).filter(Boolean)
          : [];
        return `${index + 1}. ${accepted.join(' / ')}`;
      })
      .join('\n\n');
  } else {
    answer = text(grading.referenceProof) || text(grading.referenceAnswer);
    if (!answer && Array.isArray(grading.acceptedForms)) {
      answer = grading.acceptedForms.map(text).filter(Boolean).join(' / ');
    }
  }
  return {
    answer: answer || (!code ? explanation : ''),
    code,
    explanation: answer || code ? (explanation === answer ? '' : explanation) : '',
  };
}
