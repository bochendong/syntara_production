import type { LocalProblemDocument } from '../domain/models';
import { problemAttemptHasMistake } from './problem-attempt-history';

/** Keep ordinary drafts intact and give each classroom session its own namespace. */
export function classroomDraftAccount(account: string, classSessionId?: string): string {
  return classSessionId ? `${account}:class:${JSON.stringify(classSessionId)}` : account;
}

/** A view of this lesson only; never deletes or rewrites the stored history. */
export function classroomProblemDocument(
  document: LocalProblemDocument | null,
  classSessionId?: string,
): LocalProblemDocument | null {
  if (!document || !classSessionId) return document;
  const attempts = document.attempts.filter(
    (attempt) => attempt.result?.classSessionId === classSessionId,
  );
  const submissions = attempts.filter(
    (attempt) =>
      ['submit', 'answer'].includes(attempt.kind) &&
      !['solution_viewed', 'hidden_tests_viewed', 'answer_reset'].includes(
        String(attempt.result?.event),
      ),
  );
  const latest = submissions[0];
  const first = submissions.at(-1);
  return {
    ...document,
    attempts,
    progress: latest
      ? {
          id: `class:${classSessionId}:${document.problem.id}`,
          problemId: document.problem.id,
          latestAttemptId: latest.id,
          status: latest.status,
          score: latest.score,
          attemptedCount: submissions.length,
          passedCount: submissions.filter((attempt) => attempt.status === 'passed').length,
          hasIncorrectAttempt: submissions.some(problemAttemptHasMistake),
          lastAttemptAt: latest.createdAt,
          createdAt: first!.createdAt,
          updatedAt: latest.updatedAt,
        }
      : null,
  };
}
