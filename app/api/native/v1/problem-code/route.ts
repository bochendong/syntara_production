import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { judgeNotebookCodeProblem } from '@/features/problems/server/judge';
import {
  createNotebookProblemAttempt,
  getCourseProblemForUser,
} from '@/features/problems/server/service';
import {
  applySubmissionScorePolicy,
  STANDARD_PROBLEM_POINTS,
} from '@/lib/problem-bank/scoring-policy';
import { classSessionForAttempt } from '@/lib/server/class-session-attempts';
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
  teacherPreview: z.boolean().optional(),
  courseId: z.string().trim().min(1).max(200),
  problemId: z.string().trim().min(1).max(200),
  attemptId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
  code: z.string().trim().min(1).max(120000),
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  /// 大题里的代码小问：按 label 判这一问；mode=run 只跑公开测试
  part: z.string().trim().min(1).max(40).optional(),
  mode: z.enum(['submit', 'run']).default('submit'),
  /// mode=run：public 跑公开测试；code 直接运行整段代码（Racket 题的「运行」和自己试）
  target: z.enum(['public', 'code']).default('public'),
  /// 从课堂入口提交：这节课的 id
  classSessionId: z.string().trim().min(1).max(200).optional(),
});

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid code submission.');
  const { courseId, problemId, code, language, attemptId, part, mode, target, classSessionId } =
    parsed.data;
  const prisma = getOptionalPrisma();
  if (!prisma)
    return publicApiError(requestId, 503, 'auth_not_configured', 'Problem storage is unavailable.');
  try {
    const loaded = await getCourseProblemForUser(principal.userId, courseId, problemId, {
      includeSecretJudgeForEvaluation: true,
    });
    if (parsed.data.teacherPreview && !loaded.isTeacherPreview)
      return publicApiError(
        requestId,
        403,
        'unauthorized',
        'Teacher preview requires course management access.',
      );
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
        runTarget: target,
        userAnswer: { code },
        language,
        courseIdentity,
      });
      // 跑测试的结果留一条记录（不改做题进度），连续跑不过会变成学习记忆里的卡点。
      if (!loaded.isTeacherPreview && target !== 'code' && judged.status !== 'error') {
        try {
          await createNotebookProblemAttempt({
            userId: principal.userId,
            problemId,
            kind: 'run',
            status: judged.status,
            score: judged.score,
            answer: { code },
            result: judged.result,
            preserveProgress: true,
          });
        } catch (error) {
          console.warn('[native-problem-code] run record failed', { problemId, error });
        }
      }
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
    // 核对课堂归属；核对不上时仍按平时作答保存，所有提交按实际答案评分。
    const verifiedClassSessionId = loaded.isTeacherPreview
      ? null
      : await classSessionForAttempt({
          userId: principal.userId,
          problemId,
          classSessionId,
        });
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
    const scored = applySubmissionScorePolicy({ score: judged.score, result: judged.result });
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
      classSessionId: verifiedClassSessionId,
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
