import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import type { NextRequest } from 'next/server';
import { handleNotebookMetadataGenerationRequest } from '@/features/ppt-generation/server';

export const maxDuration = 120;

async function auditedPOST(req: NextRequest) {
  return handleNotebookMetadataGenerationRequest(req);
}

export const POST = withAiFailureAudit(auditedPOST);
