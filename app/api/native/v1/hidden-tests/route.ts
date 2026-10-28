import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getCourseProblemForUser } from '@/features/problems/server/service';
import { judgeNotebookCodeProblem } from '@/features/problems/server/judge';
import { buildPartProblem, partSecretJudge } from '@/lib/problem-bank/multipart';
import { isNotebookMultipartProblemRecord } from '@/lib/problem-bank';
import { STANDARD_PROBLEM_POINTS } from '@/lib/problem-bank/scoring-policy';
import { resolveNotebookProblemCourseIdentity } from '@/lib/server/notebook-problems/course-identity';
import { notebookCodeTestSchema } from '@/lib/problem-bank/schema';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';
const requestSchema = z.object({
  courseId: z.string().trim().min(1).max(200),
  problemId: z.string().trim().min(1).max(200),
  part: z.string().trim().min(1).max(40).optional(),
  mode: z.enum(['view', 'run']).default('view'),
  code: z.string().trim().min(1).max(120000).optional(),
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  indices: z.array(z.number().int().min(0).max(47)).min(1).max(48).optional(),
});

/** Reveal only structured test cases; private helpers, scripts and files stay on the server. */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return publicApiError(requestId, 400, 'invalid_request', 'Invalid hidden test request.');
  if (!getOptionalPrisma())
    return publicApiError(requestId, 503, 'auth_not_configured', 'Problem storage is unavailable.');
  const { courseId, problemId, part, mode, code, language, indices } = parsed.data;
  if (mode === 'run' && !code)
    return publicApiError(requestId, 400, 'invalid_request', 'Code is required to run tests.');
  try {
    const loaded = await getCourseProblemForUser(principal.userId, courseId, problemId, {
      includeSecretJudgeForEvaluation: true,
    });
    let judgedProblem = loaded.problem;
    let judgeSecrets = loaded.secretJudge;
    if (part) {
      if (
        loaded.problem.type !== 'multipart' ||
        loaded.problem.publicContent.type !== 'multipart' ||
        !loaded.problem.publicContent.parts.some(
          (item) => item.label === part && item.content.type === 'code',
        )
      )
        return publicApiError(requestId, 400, 'invalid_request', 'This part is not a code part.');
      if (mode === 'run') {
        if (!isNotebookMultipartProblemRecord(loaded.problem))
          return publicApiError(
            requestId,
            400,
            'invalid_request',
            'This is not a multipart problem.',
          );
        const index = loaded.problem.publicContent.parts.findIndex((item) => item.label === part);
        const target = loaded.problem.publicContent.parts[index];
        const built = buildPartProblem(loaded.problem, index, STANDARD_PROBLEM_POINTS);
        if (!built || !target)
          return publicApiError(requestId, 400, 'invalid_request', 'This part is not a code part.');
        judgedProblem = built;
        judgeSecrets = partSecretJudge(loaded.secretJudge, target);
      }
    } else if (loaded.problem.type !== 'code') {
      return publicApiError(requestId, 400, 'invalid_request', 'This is not a code problem.');
    }
    const secret = part ? loaded.secretJudge?.parts?.[part] : loaded.secretJudge;
    const cases = z
      .array(notebookCodeTestSchema)
      .max(48)
      .safeParse(secret?.secretTests ?? []);
    if (!cases.success)
      return publicApiError(requestId, 500, 'internal_error', 'Hidden tests are unavailable.');
    if (mode === 'run') {
      if (!judgeSecrets || !cases.data.length || !code)
        return publicApiError(requestId, 400, 'invalid_request', 'No runnable hidden cases.');
      const selected = indices ?? cases.data.map((_, index) => index);
      if (
        new Set(selected).size !== selected.length ||
        selected.some((index) => !cases.data[index])
      )
        return publicApiError(requestId, 400, 'invalid_request', 'Invalid hidden test selection.');
      const identity = await resolveNotebookProblemCourseIdentity({
        courseId: loaded.problem.courseId ?? courseId,
        notebookId: loaded.problem.notebookId,
      });
      const judged = await judgeNotebookCodeProblem({
        problem: { ...judgedProblem, points: STANDARD_PROBLEM_POINTS },
        secretJudge: {
          ...judgeSecrets,
          secretTestCode: undefined,
          secretTests: selected.map((index) => ({ ...cases.data[index], id: `hidden-${index}` })),
        },
        kind: 'run',
        runTarget: 'secret',
        userAnswer: { code },
        language,
        courseIdentity: identity,
      });
      return publicApiSuccess(
        requestId,
        {
          cases: (judged.result.caseResults ?? []).map(({ id, passed }) => ({ id, passed })),
          feedback: judged.status === 'error' ? '隐藏测试运行失败，请检查代码后重试。' : undefined,
        },
        { headers: { 'Cache-Control': 'private, no-store' } },
      );
    }
    return publicApiSuccess(
      requestId,
      {
        cases: cases.data.map(({ expression, expected }) => ({ expression, expected })),
        hasScript: Boolean(secret?.secretTestCode),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch {
    return mode === 'run'
      ? publicApiError(requestId, 500, 'internal_error', 'Hidden tests could not be run.')
      : publicApiError(requestId, 404, 'not_found', 'Problem not found or unavailable.');
  }
}
