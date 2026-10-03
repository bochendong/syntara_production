import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import type { NextRequest } from 'next/server';
import { handleImageNotebookPlanRequest } from '@/features/ppt-generation/server/image-notebook-plan-route';

export const maxDuration = 300;

async function auditedPOST(req: NextRequest) {
  return handleImageNotebookPlanRequest(req);
}

export const POST = withAiFailureAudit(auditedPOST);
