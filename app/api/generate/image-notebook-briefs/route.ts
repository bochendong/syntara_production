import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import type { NextRequest } from 'next/server';
import { handleImageNotebookBriefsRequest } from '@/features/ppt-generation/server/image-notebook-quality-route';

export const maxDuration = 120;

async function auditedPOST(req: NextRequest) {
  return handleImageNotebookBriefsRequest(req);
}

export const POST = withAiFailureAudit(auditedPOST);
