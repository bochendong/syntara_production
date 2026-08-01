import type { NotebookGenerationModelStage } from '@/lib/constants/notebook-generation-model-stages';

/** 总控「生成笔记本」侧栏：模型策略 */
export type NotebookGenerationModelMode = 'recommended' | 'custom' | 'max';

/** Max 模式：各步骤统一使用的主模型（与计费/部署常用命名一致） */
export const NOTEBOOK_MODEL_PRESET_FULL = 'gpt-5.6-sol';

/** 默认（推荐）模式：低成本步骤使用 mini */
export const NOTEBOOK_MODEL_PRESET_MINI = 'gpt-5.6-terra';

/**
 * 默认模式：在质量与成本之间的推荐搭配。
 * - 大纲 / 页面内容：完整模型（结构严谨、图文对齐）
 * - 元数据、角色、口播动作：mini（结构化或已有正文约束）
 */
export const NOTEBOOK_MODEL_RECOMMENDED_BY_STAGE: Record<NotebookGenerationModelStage, string> = {
  metadata: NOTEBOOK_MODEL_PRESET_MINI,
  agents: NOTEBOOK_MODEL_PRESET_MINI,
  outlines: NOTEBOOK_MODEL_PRESET_MINI,
  content: NOTEBOOK_MODEL_PRESET_MINI,
  actions: NOTEBOOK_MODEL_PRESET_MINI,
};
