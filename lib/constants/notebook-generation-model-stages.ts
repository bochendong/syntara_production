/**
 * Notebook 创建链路里各 LLM 步骤对应的请求头键名（仅 OpenAI modelId，Key 仍由服务端托管）。
 * 与 `resolveModelFromHeadersForNotebookStage` 及侧栏「分阶段模型」一致。
 */
export const NOTEBOOK_GENERATION_MODEL_STAGES = [
  'metadata',
  'agents',
  'outlines',
  'content',
  'actions',
] as const;

export type NotebookGenerationModelStage = (typeof NOTEBOOK_GENERATION_MODEL_STAGES)[number];

export const NOTEBOOK_GENERATION_MODEL_STAGE_HEADER_KEYS: Record<
  NotebookGenerationModelStage,
  string
> = {
  metadata: 'x-notebook-model-metadata',
  agents: 'x-notebook-model-agents',
  outlines: 'x-notebook-model-outlines',
  content: 'x-notebook-model-content',
  actions: 'x-notebook-model-actions',
};
