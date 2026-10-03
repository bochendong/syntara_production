import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import type { NextRequest } from 'next/server';
import { handleCreateClassroomGenerationJobRequest } from '@/features/ppt-generation/server';

export const maxDuration = 30;

async function auditedPOST(req: NextRequest) {
  return handleCreateClassroomGenerationJobRequest(req);
}

export const POST = withAiFailureAudit(auditedPOST);
