import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import { POST as auditedPOST } from '@/features/ppt-generation/server/scene-outlines-stream-route';
export const POST = withAiFailureAudit(auditedPOST);

export const maxDuration = 300;
