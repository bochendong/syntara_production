import type { NotebookProblemAttemptRecord } from './schema';

/** Teacher trials return feedback without persisting grades or learner progress. */
export function createTeacherPreviewAttempt(
  input: Pick<
    NotebookProblemAttemptRecord,
    'userId' | 'problemId' | 'kind' | 'status' | 'answer' | 'result'
  >,
): NotebookProblemAttemptRecord {
  const now = Date.now();
  return {
    ...input,
    id: `teacher-preview-${crypto.randomUUID()}`,
    score: null,
    result: input.result ? { ...input.result, earnedPoints: undefined } : undefined,
    createdAt: now,
    updatedAt: now,
  };
}
