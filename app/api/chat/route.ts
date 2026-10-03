import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import type { NextRequest } from 'next/server';
import { handleStatelessChatRequest } from '@/features/chat/server';

export const maxDuration = 300;

async function auditedPOST(req: NextRequest) {
  return handleStatelessChatRequest(req);
}

export const POST = withAiFailureAudit(auditedPOST);
