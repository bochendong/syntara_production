import type { NotebookProblemAttemptAnswer } from '@/lib/problem-bank';
import { STANDARD_PROBLEM_POINTS } from '@/lib/problem-bank/scoring-policy';
import { brawlPracticeRewardCandidate } from '@/lib/server/brawl-practice-points';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { resolveNotebookProblemCourseIdentity } from '@/lib/server/notebook-problems/course-identity';
import {
  evaluateNotebookMultipartProblem,
  evaluateNotebookNonCodeProblem,
} from '@/lib/server/notebook-problems/evaluate';
import { judgeNotebookCodeProblem } from '@/lib/server/notebook-problems/judge';
import { getCourseProblemForUser } from '@/lib/server/notebook-problems/service';
import { withRequestContext } from '@/lib/server/request-context';
import { resolveModel } from '@/lib/server/resolve-model';

export async function verifyNativeBrawlReward(
  db: PrismaClient,
  userId: string,
  courseId: string,
  problemId: string,
  answer: NotebookProblemAttemptAnswer,
) {
  if (!(await brawlPracticeRewardCandidate(db, userId, problemId))) return false;
  const loaded = await getCourseProblemForUser(userId, courseId, problemId, {
    skipMaintenance: true,
    includeSecretJudgeForEvaluation: true,
  });
  if (loaded.isTeacherPreview) return false;

  const problem = { ...loaded.problem, points: STANDARD_PROBLEM_POINTS };
  const needsModel =
    problem.type === 'proof' ||
    problem.type === 'short_answer' ||
    Boolean(answer.images?.length) ||
    (problem.publicContent.type === 'multipart' &&
      problem.publicContent.parts.some(
        (part) =>
          part.content.type === 'proof' ||
          part.content.type === 'short_answer' ||
          Boolean(answer.parts?.[part.label]?.images?.length),
      ));
  const language = 'zh-CN' as const;
  const result = await withRequestContext(
    { userId, courseId, route: '/api/native/v1/problems', skipCreditCharge: true },
    async () => {
      const model = needsModel ? (await resolveModel({})).model : undefined;
      const textPassRatio = 0.8;
      if (problem.type === 'multipart' || problem.type === 'code') {
        const courseIdentity = await resolveNotebookProblemCourseIdentity({
          courseId: problem.courseId,
          notebookId: problem.notebookId,
        });
        const grading = { problem, language, secretJudge: loaded.secretJudge, courseIdentity };
        return problem.type === 'multipart'
          ? evaluateNotebookMultipartProblem({ ...grading, answer, model, textPassRatio })
          : judgeNotebookCodeProblem({ ...grading, kind: 'submit', userAnswer: answer });
      }
      return evaluateNotebookNonCodeProblem({ problem, answer, model, language, textPassRatio });
    },
  );
  if (result.status === 'error')
    throw new Error('Practice reward grading is temporarily unavailable.');
  return result.status === 'passed';
}
