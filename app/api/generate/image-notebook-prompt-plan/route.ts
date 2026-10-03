import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import { handleImageNotebookPromptPlanRequest } from '@/features/ppt-generation/server/image-notebook-plan-route';

export const maxDuration = 300;

export const POST = withAiFailureAudit(handleImageNotebookPromptPlanRequest);
