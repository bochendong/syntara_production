import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { judgeNotebookCodeProblem } from '@/features/problems/server/judge';
import { runNotebookMultipartCodePart } from '@/features/problems/server/evaluate';
import {
  createNotebookProblemAttempt,
  getNotebookProblemForUser,
} from '@/features/problems/server/service';
import { STANDARD_PROBLEM_POINTS } from '@/lib/problem-bank/scoring-policy';

const runSchema = z.object({
  code: z.string().trim().min(1).max(120000),
  target: z.enum(['code', 'public', 'secret']).default('public'),
  language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  /// 大题里的代码小问
  part: z.string().trim().min(1).max(40).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; problemId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id, problemId } = await context.params;

    const payload = runSchema.safeParse(await request.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const loaded = await getNotebookProblemForUser(auth.userId, id, problemId);

    if (payload.data.part && loaded.problem.type === 'multipart') {
      if (payload.data.target === 'secret') {
        return NextResponse.json({ error: 'Secret tests run only on submit' }, { status: 400 });
      }
      const judged = await runNotebookMultipartCodePart({
        problem: { ...loaded.problem, points: STANDARD_PROBLEM_POINTS },
        label: payload.data.part,
        code: payload.data.code,
        target: payload.data.target,
        language: payload.data.language,
      });
      if (!judged) {
        return NextResponse.json({ error: 'This part is not a code part' }, { status: 400 });
      }
      return NextResponse.json({ attempt: null, result: judged.result });
    }
    if (loaded.problem.type !== 'code') {
      return NextResponse.json(
        { error: 'Run is only supported for code problems' },
        { status: 400 },
      );
    }

    const judged = await judgeNotebookCodeProblem({
      problem: { ...loaded.problem, points: STANDARD_PROBLEM_POINTS },
      secretJudge: loaded.secretJudge,
      kind: 'run',
      runTarget: payload.data.target,
      userAnswer: { code: payload.data.code },
      language: payload.data.language,
    });
    const attempt = await createNotebookProblemAttempt({
      userId: auth.userId,
      problemId,
      kind: 'run',
      status: judged.status,
      score: judged.score,
      answer: { code: payload.data.code },
      result: judged.result,
    });

    return NextResponse.json({
      attempt,
      result: judged.result,
    });
  });
}
