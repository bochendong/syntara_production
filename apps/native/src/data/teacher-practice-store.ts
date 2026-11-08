import type {
  LocalProblem,
  LocalProblemAttempt,
  LocalProblemDocument,
  LocalProblemProgress,
} from '../domain/models';
import { summarizeArchive } from './archive';
import type { LocalRepository } from './repository';

/** Window-scoped teacher demonstrations: never reads/writes the learner repository. */
type TeacherPracticeStore = Pick<
  LocalRepository,
  'loadProblemDocument' | 'saveProblemAttempt' | 'importArchive'
> & {
  addProblems: (problems: LocalProblem[]) => void;
  listProblemProgress: () => LocalProblemProgress[];
};

export function createTeacherPracticeStore(
  problems: LocalProblem[],
  onSubmission?: (progress: LocalProblemProgress) => void,
): TeacherPracticeStore {
  const documents = new Map<string, LocalProblemDocument>(
    problems.map((problem) => [problem.id, { problem, attempts: [], progress: null }]),
  );
  return {
    addProblems(problems) {
      for (const problem of problems) {
        const previous = documents.get(problem.id);
        documents.set(problem.id, { attempts: [], progress: null, ...previous, problem });
      }
    },
    listProblemProgress() {
      return [...documents.values()].flatMap(({ progress }) => (progress ? [progress] : []));
    },
    async loadProblemDocument(id) {
      return structuredClone(documents.get(id) ?? null);
    },
    async saveProblemAttempt(input) {
      const previous = documents.get(input.problemId);
      if (!previous) throw new Error('试做题目不存在。');
      const at = Date.now();
      const attempt: LocalProblemAttempt = {
        id: crypto.randomUUID(),
        problemId: input.problemId,
        kind: 'submit',
        answer: structuredClone(input.answer) as unknown as Record<string, unknown>,
        result: structuredClone(input.result ?? { feedback: input.feedback }),
        status: input.status,
        score: input.score,
        createdAt: at,
        updatedAt: at,
      };
      const progress = {
        id: `preview:${input.problemId}`,
        problemId: input.problemId,
        latestAttemptId: attempt.id,
        status: input.status,
        score: input.score,
        attemptedCount: (previous.progress?.attemptedCount ?? 0) + 1,
        passedCount: (previous.progress?.passedCount ?? 0) + Number(input.status === 'passed'),
        lastAttemptAt: at,
        createdAt: previous.progress?.createdAt ?? at,
        updatedAt: at,
      };
      const document = {
        problem: previous.problem,
        attempts: [attempt, ...previous.attempts],
        progress,
      };
      documents.set(input.problemId, document);
      onSubmission?.(progress);
      return structuredClone({ attempt, progress, document });
    },
    async importArchive(archive) {
      // Learning snapshots stay here; no student memories or course data are imported.
      for (const attempt of archive.problemAttempts) {
        const document = documents.get(attempt.problemId);
        if (!document) throw new Error('试做题目不存在。');
        documents.set(attempt.problemId, {
          ...document,
          attempts: [structuredClone(attempt), ...document.attempts],
        });
      }
      return { ...summarizeArchive(archive), studyMemories: 0 };
    },
  };
}
