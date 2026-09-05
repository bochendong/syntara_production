import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';
import { evaluateNotebookNonCodeProblem } from '@/features/problems/server/evaluate';
import { judgeNotebookCodeProblem } from '@/features/problems/server/judge';
import { notebookProblemAttemptImageSchema } from '@/features/problems';
import {
  hasPassedPublicCodeRun,
  countNotebookProblemSubmissions,
  createNotebookProblemAttempt,
  getNotebookProblemForUser,
} from '@/features/problems/server/service';
import { resolveNotebookProblemCourseIdentity } from '@/lib/server/notebook-problems/course-identity';
import {
  applySubmissionScorePolicy,
  hasLimitedSubmissions,
  LIMITED_SUBMISSION_COUNT,
  remainingSubmissions,
  STANDARD_PROBLEM_POINTS,
} from '@/lib/problem-bank/scoring-policy';

const submitSchema = z.object({
  text: z.string().max(40000).optional(),
  selectedOptionIds: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
  blanks: z.record(z.string(), z.string().max(4000)).optional(),
  code: z.string().max(120000).optional(),
  images: z.array(notebookProblemAttemptImageSchema).max(4).optional(),
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  activeDurationMs: z.number().int().min(0).max(14_400_000).optional(),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string; problemId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id, problemId } = await context.params;

    const payload = submitSchema.safeParse(await req.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const loaded = await getNotebookProblemForUser(auth.userId, id, problemId, {
      includeSecretJudgeForEvaluation: true,
    });
    if (
      loaded.problem.publicContent.type === 'code' &&
      loaded.problem.publicContent.publicTests.length > 0 &&
      !(await hasPassedPublicCodeRun({
        userId: auth.userId,
        problemId,
        code: payload.data.code ?? '',
      }))
    ) {
      return NextResponse.json(
        {
          code: 'PUBLIC_TESTS_REQUIRED',
          error:
            payload.data.language === 'zh-CN'
              ? '请先在「测试用例」中运行测试，当前代码通过全部公开测试后再提交。'
              : 'Run tests in Testcase first. Your current code must pass all public tests before submitting.',
        },
        { status: 409 },
      );
    }
    const limitedSubmissions = hasLimitedSubmissions(loaded.problem.type);
    const previousSubmissionCount = limitedSubmissions
      ? await countNotebookProblemSubmissions({ userId: auth.userId, problemId })
      : 0;
    if (limitedSubmissions && previousSubmissionCount >= LIMITED_SUBMISSION_COUNT) {
      return NextResponse.json(
        {
          code: 'ATTEMPT_LIMIT_REACHED',
          error: `这道题最多只能提交 ${LIMITED_SUBMISSION_COUNT} 次。`,
          remainingSubmissions: 0,
        },
        { status: 409 },
      );
    }
    const attemptNumber = previousSubmissionCount + 1;
    const scoringProblem = { ...loaded.problem, points: STANDARD_PROBLEM_POINTS };
    const courseIdentity = await resolveNotebookProblemCourseIdentity({
      courseId: loaded.problem.courseId,
      notebookId: loaded.problem.notebookId ?? id,
    });
    const answer = {
      text: payload.data.text,
      selectedOptionIds: payload.data.selectedOptionIds,
      blanks: payload.data.blanks,
      code: payload.data.code,
      images: payload.data.images,
    };

    const evaluated = await runWithRequestContext(
      req,
      '/api/notebooks/problems/attempts/submit',
      async () => {
        if (loaded.problem.type === 'code') {
          return judgeNotebookCodeProblem({
            problem: scoringProblem,
            secretJudge: loaded.secretJudge,
            kind: 'submit',
            userAnswer: answer,
            language: payload.data.language,
            courseIdentity,
          });
        }

        if (
          loaded.problem.type === 'choice' ||
          loaded.problem.type === 'fill_blank' ||
          ((loaded.problem.type === 'calculation' ||
            loaded.problem.type === 'short_answer' ||
            loaded.problem.type === 'proof') &&
            (answer.images?.length ?? 0) > 0 &&
            !(answer.text ?? '').trim())
        ) {
          return evaluateNotebookNonCodeProblem({
            problem: scoringProblem,
            answer,
            language: payload.data.language,
          });
        }

        const { model } = await resolveModelFromHeaders(req, {
          allowOpenAIModelOverride: true,
        });
        return evaluateNotebookNonCodeProblem({
          problem: scoringProblem,
          answer,
          model,
          language: payload.data.language,
        });
      },
    );
    const scored = applySubmissionScorePolicy({
      type: loaded.problem.type,
      attemptNumber,
      score: evaluated.score,
      result: evaluated.result,
      language: payload.data.language,
    });

    const attempt = await createNotebookProblemAttempt({
      userId: auth.userId,
      problemId,
      kind: loaded.problem.type === 'code' ? 'submit' : 'answer',
      status: evaluated.status,
      score: scored.score,
      answer,
      result: scored.result,
      activeDurationMs: payload.data.activeDurationMs,
      timingSource: payload.data.activeDurationMs === undefined ? undefined : 'client_active_v1',
    });

    return NextResponse.json({
      attempt,
      result: scored.result,
      attemptNumber: limitedSubmissions ? attemptNumber : null,
      remainingSubmissions: limitedSubmissions ? remainingSubmissions(attemptNumber) : null,
    });
  });
}
