export const CHAT_RESPONSE_STRENGTHS = ['low', 'medium', 'high'] as const;

export type ChatResponseStrength = (typeof CHAT_RESPONSE_STRENGTHS)[number];

export const DEFAULT_CHAT_RESPONSE_STRENGTH: ChatResponseStrength = 'medium';

export const CHAT_RESPONSE_STRENGTH_CONFIG: Record<
  ChatResponseStrength,
  {
    label: string;
    modelId: string;
    relativeCost: number;
    description: string;
  }
> = {
  low: {
    label: '低',
    modelId: 'gpt-5.6-luna',
    relativeCost: 1,
    description: '适合日常问答，速度更快、用量更省。',
  },
  medium: {
    label: '中',
    modelId: 'gpt-5.6-terra',
    relativeCost: 2.5,
    description: '适合需要推理和分步讲解的学习问题。',
  },
  high: {
    label: '高',
    modelId: 'gpt-5.6-sol',
    relativeCost: 5,
    description: '适合复杂推导、综合分析和高难度问题。',
  },
};

export function isChatResponseStrength(value: unknown): value is ChatResponseStrength {
  return (
    typeof value === 'string' && (CHAT_RESPONSE_STRENGTHS as readonly string[]).includes(value)
  );
}

export function resolveChatResponseModelId(strength: ChatResponseStrength): string {
  return CHAT_RESPONSE_STRENGTH_CONFIG[strength].modelId;
}
