/** General-purpose text models verified against OpenAI's model catalog, 2026-09-23.
 * Account access is separate from documented model compatibility.
 */
export const ADMIN_TEXT_MODEL_OPTIONS = [
  { id: 'gpt-6-astra', label: 'GPT-6 Astra', description: '复杂推理与高难度任务' },
  { id: 'gpt-6-sol', label: 'GPT-6 Sol', description: '复杂编程与多步骤任务' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', description: '日常问答与高频任务' },
  { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', description: '综合分析与专业任务' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra', description: '能力与成本平衡' },
  { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna', description: '轻量问答与批量任务' },
  { id: 'gpt-5.4', label: 'GPT-5.4', description: '通用推理与编程' },
  { id: 'gpt-5.4-mini', label: 'GPT-5.4 Mini', description: '轻量推理' },
  { id: 'gpt-5.4-nano', label: 'GPT-5.4 Nano', description: '简单高频任务' },
] as const;
export function isAdminTextModel(value: unknown): value is string {
  return typeof value === 'string' && ADMIN_TEXT_MODEL_OPTIONS.some((model) => model.id === value);
}
export type ChatTierModels = { low: string; medium: string; high: string };
