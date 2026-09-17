/** Administrator-managed image model; stale client preferences cannot downgrade it. */
export const SYSTEM_OPENAI_IMAGE_MODEL = 'gpt-image-2.5-flare';

/** Shared fallback for every non-chat, non-image OpenAI call. */
export const SYSTEM_OPENAI_FALLBACK_MODEL = 'gpt-5.6-sol';

/** Teacher lecture / notebook generation. */
export const SYSTEM_OPENAI_LECTURE_MODEL = 'gpt-5.6-sol';

export const SYSTEM_CHAT_MODEL_BY_STRENGTH = {
  low: 'gpt-5.6-luna',
  medium: 'gpt-5.6-sol',
  high: 'gpt-6-astra',
} as const;

export type OpenAIReasoningEffort =
  | 'none'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max';

export function isGpt6Model(modelId: string): boolean {
  return modelId.trim().toLowerCase().startsWith('gpt-6');
}

export function isGpt56Model(modelId: string): boolean {
  return modelId.trim().toLowerCase().startsWith('gpt-5.6');
}

/**
 * Lowest reasoning effort a model accepts.
 * GPT-6 Astra rejects `none` with HTTP 400; GPT-5.6 still allows it.
 */
export function lowestOpenAIReasoningEffort(modelId: string): OpenAIReasoningEffort {
  if (isGpt6Model(modelId)) return 'low';
  if (isGpt56Model(modelId)) return 'none';
  if (modelId.trim().toLowerCase().startsWith('gpt-5')) return 'minimal';
  if (modelId.trim().toLowerCase().startsWith('o')) return 'low';
  return 'none';
}

/**
 * Chat already selects a stronger model by reply strength. Keep reasoning
 * modest so Sol/Astra cannot spend the entire output budget on hidden tokens.
 */
export function chatOpenAIReasoningEffort(modelId: string): OpenAIReasoningEffort {
  if (isGpt6Model(modelId)) return 'medium';
  if (modelId.toLowerCase().includes('sol')) return 'low';
  return 'low';
}

export function chatMaxOutputTokens(modelId: string): number {
  if (isGpt6Model(modelId)) return 48_000;
  if (modelId.toLowerCase().includes('sol')) return 32_000;
  return 16_000;
}

export function openaiModelIdFromString(modelString: string | undefined): string {
  const raw = modelString?.trim() || '';
  if (!raw) return '';
  return raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw;
}
