import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { judgeNotebookCodeProblem } from '@/features/problems/server/judge';
import {
  countNotebookProblemSubmissions,
  createNotebookProblemAttempt,
  getCourseProblemForUser,
} from '@/features/problems/server/service';
import {
  applySubmissionScorePolicy,
  LIMITED_SUBMISSION_COUNT,
  STANDARD_PROBLEM_POINTS,
} from '@/lib/problem-bank/scoring-policy';
import { resolveNotebookProblemCourseIdentity } from '@/lib/server/notebook-problems/course-identity';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { buildPartProblem, partSecretJudge } from '@/lib/problem-bank/multipart';
import { isNotebookMultipartProblemRecord } from '@/lib/problem-bank';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';
export const maxDuration = 300;
const requestSchema = z.object({
  courseId: z.string().trim().min(1).max(200),
  problemId: z.string().trim().min(1).max(200),
  attemptId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  code: z.string().trim().min(1).max(120000),
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  /// 大题里的代码小问：按 label 判这一问；mode=run 只跑公开测试
  part: z.string().trim().min(1).max(40).optional(),
  mode: z.enum(['submit', 'run']).default('submit'),
});

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid code submission.');
  const { courseId, problemId, code, language, attemptId, part, mode } = parsed.data;
  const prisma = getOptionalPrisma();
  if (!prisma)
    return publicApiError(requestId, 503, 'auth_not_configured', 'Problem storage is unavailable.');
  try {
    const loaded = await getCourseProblemForUser(principal.userId, courseId, problemId, {
      includeSecretJudgeForEvaluation: true,
    });
    if (part) {
      // 代码小问：结果交回 App，和其他小问一起存成整道大题的作答
      const multipart = { ...loaded.problem, points: STANDARD_PROBLEM_POINTS };
      if (!isNotebookMultipartProblemRecord(multipart))
        return publicApiError(
          requestId,
          400,
          'invalid_request',
          'This is not a multipart problem.',
        );
      const index = multipart.publicContent.parts.findIndex((item) => item.label === part);
      const target = multipart.publicContent.parts[index];
      const partProblem = target
        ? buildPartProblem(multipart, index, STANDARD_PROBLEM_POINTS)
        : null;
      if (!target || target.content.type !== 'code' || !partProblem)
        return publicApiError(requestId, 400, 'invalid_request', 'This part is not a code part.');
      const courseIdentity = await resolveNotebookProblemCourseIdentity({
        courseId: loaded.problem.courseId ?? courseId,
        notebookId: loaded.problem.notebookId,
      });
      const judged = await judgeNotebookCodeProblem({
        problem: partProblem,
        secretJudge: partSecretJudge(loaded.secretJudge, target),
        kind: mode === 'run' ? 'run' : 'submit',
        runTarget: 'public',
        userAnswer: { code },
        language,
        courseIdentity,
      });
      return publicApiSuccess(requestId, {
        saved: false,
        part,
        status: judged.status,
        score: judged.score,
        result: judged.result,
      });
    }
    if (loaded.problem.type !== 'code')
      return publicApiError(requestId, 400, 'invalid_request', 'This is not a code problem.');
    if (mode === 'run') {
      const courseIdentity = await resolveNotebookProblemCourseIdentity({
        courseId: loaded.problem.courseId ?? courseId,
        notebookId: loaded.problem.notebookId,
      });
      const judged = await judgeNotebookCodeProblem({
        problem: { ...loaded.problem, points: STANDARD_PROBLEM_POINTS },
        secretJudge: loaded.secretJudge,
        kind: 'run',
        runTarget: 'public',
        userAnswer: { code },
        language,
        courseIdentity,
      });
      return publicApiSuccess(requestId, { saved: false, ...judged });
    }
    const id = `native_code_${attemptId}`;
    const replay = await prisma.notebookProblemAttempt.findUnique({
      where: { id },
      select: {
        userId: true,
        problemId: true,
        answerJson: true,
        resultJson: true,
        status: true,
        score: true,
      },
    });
    if (replay) {
      const answer = replay.answerJson as { code?: unknown } | null;
      if (
        replay.userId !== principal.userId ||
        replay.problemId !== problemId ||
        answer?.code !== code
      )
        return publicApiError(
          requestId,
          409,
          'idempotency_conflict',
          'Submission identifier already used.',
        );
      return publicApiSuccess(requestId, {
        saved: true,
        replayed: true,
        status: replay.status,
        score: replay.score,
        result: replay.resultJson,
      });
    }
    const count = loaded.isTeacherPreview
      ? 0
      : await countNotebookProblemSubmissions({ userId: principal.userId, problemId });
    if (count >= LIMITED_SUBMISSION_COUNT)
      return publicApiError(requestId, 409, 'invalid_request', '这道题最多只能提交 3 次。');
    const problem = { ...loaded.problem, points: STANDARD_PROBLEM_POINTS };
    const courseIdentity = await resolveNotebookProblemCourseIdentity({
      courseId: loaded.problem.courseId ?? courseId,
      notebookId: loaded.problem.notebookId,
    });
    if (
      loaded.problem.publicContent.type === 'code' &&
      (loaded.problem.publicContent.publicTestCode?.trim() ||
        loaded.problem.publicContent.publicTests.length > 0)
    ) {
      const publicRun = await judgeNotebookCodeProblem({
        problem,
        secretJudge: loaded.secretJudge,
        kind: 'run',
        runTarget: 'public',
        userAnswer: { code },
        language,
        courseIdentity,
      });
      if (publicRun.status !== 'passed')
        return publicApiSuccess(requestId, {
          saved: false,
          status: publicRun.status,
          score: null,
          result: publicRun.result,
        });
    }
    const judged = await judgeNotebookCodeProblem({
      problem,
      secretJudge: loaded.secretJudge,
      kind: 'submit',
      userAnswer: { code },
      language,
      courseIdentity,
    });
    if (judged.status === 'error')
      return publicApiSuccess(requestId, {
        saved: false,
        status: judged.status,
        score: null,
        result: judged.result,
      });
    const scored = applySubmissionScorePolicy({
      type: 'code',
      attemptNumber: count + 1,
      score: judged.score,
      result: judged.result,
      language,
    });
    if (loaded.isTeacherPreview)
      return publicApiSuccess(requestId, {
        saved: false,
        preview: true,
        status: judged.status,
        score: scored.score,
        result: scored.result,
      });
    await createNotebookProblemAttempt({
      id,
      userId: principal.userId,
      problemId,
      kind: 'submit',
      status: judged.status,
      score: scored.score,
      answer: { code },
      result: scored.result,
    });
    return publicApiSuccess(requestId, {
      saved: true,
      replayed: false,
      status: judged.status,
      score: scored.score,
      result: scored.result,
    });
  } catch {
    return publicApiError(
      requestId,
      500,
      'internal_error',
      'Code submission could not be completed.',
    );
  }
}
