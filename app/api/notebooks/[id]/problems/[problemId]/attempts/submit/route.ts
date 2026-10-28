import { isValidPhotoAnswerUpload } from '@/lib/problem-bank/photo-answer';

import { NextRequest, NextResponse } from 'next/server';
import type { NotebookProblemAttemptAnswer } from '@/lib/problem-bank';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';
import {
  evaluateNotebookMultipartProblem,
  evaluateNotebookNonCodeProblem,
} from '@/features/problems/server/evaluate';
import { judgeNotebookCodeProblem } from '@/features/problems/server/judge';
import {
  notebookProblemAttemptImageSchema,
  notebookProblemPartAnswerSchema,
} from '@/features/problems';
import {
  hasPassedPublicCodeRun,
  countNotebookProblemSubmissions,
  createNotebookProblemAttempt,
  getLatestNotebookProblemSubmission,
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

export const maxDuration = 300;

const photoAnswersSchema = z
  .array(
    notebookProblemAttemptImageSchema.refine(
      isValidPhotoAnswerUpload,
      '图片格式不支持或过大，请重新选择照片上传。',
    ),
  )
  .max(4)
  .optional();

const submitSchema = z.object({
  text: z.string().max(40000).optional(),
  selectedOptionIds: z.array(z.string().trim().min(1).max(64)).max(12).optional(),
  blanks: z.record(z.string(), z.string().max(4000)).optional(),
  code: z.string().max(120000).optional(),
  cells: z.record(z.string().max(140), z.string().max(8000)).optional(),
  images: photoAnswersSchema,
  parts: z
    .record(
      z.string().trim().min(1).max(40),
      notebookProblemPartAnswerSchema.extend({ images: photoAnswersSchema }),
    )
    .optional(),
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
      (Boolean(loaded.problem.publicContent.publicTestCode?.trim()) ||
        loaded.problem.publicContent.publicTests.length > 0) &&
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
    let answer: NotebookProblemAttemptAnswer = {
      text: payload.data.text,
      selectedOptionIds: payload.data.selectedOptionIds,
      blanks: payload.data.blanks,
      code: payload.data.code,
      cells: payload.data.cells,
      images: payload.data.images,
      parts: payload.data.parts,
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

        if (loaded.problem.type === 'multipart') {
          const needsModel =
            loaded.problem.publicContent.type === 'multipart' &&
            loaded.problem.publicContent.parts.some(
              (part) =>
                Boolean(answer.parts?.[part.label]) &&
                (part.content.type === 'short_answer' ||
                  part.content.type === 'proof' ||
                  Boolean(answer.parts?.[part.label]?.images?.length)),
            );
          const model = needsModel
            ? (await resolveModelFromHeaders(req, { allowOpenAIModelOverride: true })).model
            : undefined;
          const graded = await evaluateNotebookMultipartProblem({
            problem: scoringProblem,
            answer,
            previous: await getLatestNotebookProblemSubmission({ userId: auth.userId, problemId }),
            model,
            language: payload.data.language,
            secretJudge: loaded.secretJudge,
            courseIdentity,
          });
          answer = graded.answer;
          return graded;
        }

        if (
          loaded.problem.type === 'choice' ||
          loaded.problem.type === 'fill_blank' ||
          loaded.problem.type === 'table' ||
          (loaded.problem.type === 'calculation' && !answer.images?.length)
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
    if (evaluated.status === 'error' && loaded.problem.type !== 'code') {
      return NextResponse.json(
        { code: 'GRADING_FAILED', error: evaluated.result.feedback || 'AI 批改失败，请稍后重试。' },
        { status: 422 },
      );
    }
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
