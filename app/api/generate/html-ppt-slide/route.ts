import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import { POST as auditedPOST } from '@/features/ppt-generation/server/html-ppt-slide/handler';
export const POST = withAiFailureAudit(auditedPOST);

export const runtime = 'nodejs';
export const maxDuration = 180;
