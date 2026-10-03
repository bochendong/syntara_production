import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import type { NextRequest } from 'next/server';
import { handleImageNotebookPlanStreamRequest } from '@/features/ppt-generation/server/image-notebook-plan-route';

export const maxDuration = 300;

async function auditedPOST(req: NextRequest) {
  return handleImageNotebookPlanStreamRequest(req);
}

export const POST = withAiFailureAudit(auditedPOST);
