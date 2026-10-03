import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import { NextRequest, NextResponse } from 'next/server';

import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';

/**
 * Kept as an explicit tombstone for older clients and saved learning actions.
 * Practice plans must select existing course problem-bank records; this route
 * must never fabricate or persist replacement questions when the bank is short.
 */
async function auditedPOST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id } = await context.params;

    return NextResponse.json(
      {
        error: '题目生成已停用。学习计划只能从当前课程题库选择已有题目。',
        code: 'problem_generation_retired',
        problemBankEndpoint: `/api/courses/${encodeURIComponent(id)}/problems?summary=1`,
      },
      { status: 410 },
    );
  });
}

export const POST = withAiFailureAudit(auditedPOST);
