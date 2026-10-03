import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import { POST as auditedPOST } from '@/features/ppt-generation/server/notebook-outlines-route';
export const POST = withAiFailureAudit(auditedPOST);

export const maxDuration = 300;
