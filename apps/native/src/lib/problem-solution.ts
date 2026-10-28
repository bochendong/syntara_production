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
  if (problem.type === 'multipart' && Array.isArray(problem.publicContent.parts)) {
    const grades = Array.isArray(grading.parts)
      ? (grading.parts as Array<{ label: string; grading: Record<string, unknown> }>)
      : [];
    answer = (
      problem.publicContent.parts as Array<{ label: string; content: Record<string, unknown> }>
    )
      .map((part) => {
        const result = problemSolution({
          ...problem,
          type: String(part.content.type),
          publicContent: part.content,
          grading: grades.find((g) => g.label === part.label)?.grading ?? {},
        });
        const codeAnswer = result.code ? `\`\`\`python\n${result.code}\n\`\`\`` : '';
        return `**小问 (${part.label})**\n\n${[result.answer, codeAnswer, result.explanation].filter(Boolean).join('\n\n')}`;
      })
      .join('\n\n');
  } else if (problem.type === 'choice') {
    const correct = Array.isArray(grading.correctOptionIds) ? grading.correctOptionIds : [];
    answer = problemOptions(problem)
      .filter((option) => correct.includes(option.id))
      .map((option) => `**${option.id}.** ${option.label}`)
      .join('\n\n');
  } else if (problem.type === 'code') {
    code = text(grading.solutionCode);
    const reference = text(grading.referenceAnswer);
    answer = reference === code ? '' : reference;
  } else if (problem.type === 'table' && Array.isArray(grading.cells)) {
    answer = grading.cells
      .map((cell) => {
        const item = cell as Record<string, unknown>;
        const accepted = Array.isArray(item.acceptedAnswers)
          ? item.acceptedAnswers.map(text).filter(Boolean)
          : [];
        return accepted.length
          ? `**${text(item.rowId)} · ${text(item.colId)}**: ${accepted.join(' / ')}`
          : '';
      })
      .filter(Boolean)
      .join('\n\n');
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
