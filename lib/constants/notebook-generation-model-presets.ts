import { SYSTEM_OPENAI_LECTURE_MODEL } from '@/lib/ai/system-model-policy';
import type { NotebookGenerationModelStage } from '@/lib/constants/notebook-generation-model-stages';

/** 总控「生成笔记本」侧栏：模型策略 */
export type NotebookGenerationModelMode = 'recommended' | 'custom' | 'max';

/** Max 模式：各步骤统一使用的主模型（与计费/部署常用命名一致） */
export const NOTEBOOK_MODEL_PRESET_FULL = SYSTEM_OPENAI_LECTURE_MODEL;

/** 讲义生成统一使用 Sol，不再用 Terra 做低成本档。 */
export const NOTEBOOK_MODEL_PRESET_MINI = SYSTEM_OPENAI_LECTURE_MODEL;

/**
 * 讲义 / 笔记本各步骤都使用 Sol。
 */
export const NOTEBOOK_MODEL_RECOMMENDED_BY_STAGE: Record<NotebookGenerationModelStage, string> = {
  metadata: NOTEBOOK_MODEL_PRESET_FULL,
  agents: NOTEBOOK_MODEL_PRESET_FULL,
  outlines: NOTEBOOK_MODEL_PRESET_FULL,
  content: NOTEBOOK_MODEL_PRESET_FULL,
  actions: NOTEBOOK_MODEL_PRESET_FULL,
};
