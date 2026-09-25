import { createLogger } from '@/lib/logger';
import type { ChatTierModels } from '@/lib/ai/admin-model-options';
import {
  SYSTEM_CHAT_MODEL_BY_STRENGTH,
  SYSTEM_OPENAI_FALLBACK_MODEL,
} from '@/lib/ai/system-model-policy';
import { getPrismaOrNull } from '@/lib/server/prisma-safe';
import { decryptSystemSecret, encryptSystemSecret } from '@/lib/server/system-secret-crypto';

const log = createLogger('SystemLLMConfig');
function configuredDefaultOpenAIModel(): string {
  const configured = process.env.DEFAULT_MODEL?.trim();
  if (!configured) return SYSTEM_OPENAI_FALLBACK_MODEL;
  if (configured.startsWith('openai:')) return configured.slice('openai:'.length);
  return configured.includes(':') ? SYSTEM_OPENAI_FALLBACK_MODEL : configured;
}

export const DEFAULT_OPENAI_MODEL = configuredDefaultOpenAIModel();
export const DEFAULT_OPENAI_BASE_URL =
  process.env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1';

export interface SystemLLMConfigView {
  tierModels: ChatTierModels;
  providerId: 'openai';
  modelId: string;
  baseUrl?: string;
  apiKeyMasked: string;
  hasApiKey: boolean;
  source: 'database' | 'environment';
  /** 仅当 key 来自数据库中的管理员配置时有值 */
  updatedAt: string | null;
}

export interface SystemLLMRuntimeConfig {
  tierModels: ChatTierModels;
  providerId: 'openai';
  modelId: string;
  baseUrl?: string;
  apiKey: string;
  source: 'database' | 'environment';
}

function maskApiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '********';
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

async function loadSystemLLMRuntimeConfig(): Promise<SystemLLMRuntimeConfig> {
  const prisma = getPrismaOrNull();
  const preferDbInDev = process.env.NODE_ENV === 'development';
  if (prisma) {
    try {
      const row = await prisma.systemLLMConfig.findUnique({ where: { id: 'default' } });
      if (row?.apiKey?.trim()) {
        const apiKey = decryptSystemSecret(row.apiKey);
        return {
          tierModels: {
            low: row.lowModelId || SYSTEM_CHAT_MODEL_BY_STRENGTH.low,
            medium: row.mediumModelId || SYSTEM_CHAT_MODEL_BY_STRENGTH.medium,
            high: row.highModelId || SYSTEM_CHAT_MODEL_BY_STRENGTH.high,
          },
          providerId: 'openai',
          modelId: row.modelId?.trim() || DEFAULT_OPENAI_MODEL,
          baseUrl: row.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL,
          apiKey,
          source: 'database',
        };
      }
      if (preferDbInDev) {
        log.warn(
          'Development mode: System LLM config row has no API key, falling back to env OPENAI_API_KEY.',
        );
      }
    } catch (error) {
      log.error('Cannot load administrator OpenAI configuration:', error);
      throw new Error('全站 OpenAI 配置读取失败，请稍后重试；未使用其他 API Key。');
    }
  }

  return {
    providerId: 'openai',
    tierModels: { ...SYSTEM_CHAT_MODEL_BY_STRENGTH },
    modelId: DEFAULT_OPENAI_MODEL,
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    apiKey: process.env.OPENAI_API_KEY?.trim() || '',
    source: 'environment',
  };
}

/** Read the shared configuration on every resolution, including background workers.
 * A process-local TTL can continue using a revoked key after another process saves.
 */
export async function getSystemLLMRuntimeConfig(): Promise<SystemLLMRuntimeConfig> {
  return loadSystemLLMRuntimeConfig();
}

export async function getSystemLLMConfigView(): Promise<SystemLLMConfigView> {
  const config = await getSystemLLMRuntimeConfig();
  let updatedAt: string | null = null;
  const prisma = getPrismaOrNull();
  if (prisma && config.source === 'database') {
    try {
      const row = await prisma.systemLLMConfig.findUnique({
        where: { id: 'default' },
        select: { updatedAt: true },
      });
      updatedAt = row?.updatedAt ? row.updatedAt.toISOString() : null;
    } catch (error) {
      log.warn('Failed to read SystemLLMConfig updatedAt:', error);
    }
  }
  return {
    providerId: 'openai',
    tierModels: config.tierModels,
    modelId: config.modelId,
    baseUrl: config.baseUrl,
    apiKeyMasked: maskApiKey(config.apiKey),
    hasApiKey: Boolean(config.apiKey),
    source: config.source,
    updatedAt,
  };
}

export async function updateSystemLLMConfig(input: {
  tierModels?: ChatTierModels;
  apiKey?: string;
  modelId?: string;
  baseUrl?: string;
}): Promise<SystemLLMConfigView> {
  const prisma = getPrismaOrNull();
  if (!prisma) {
    throw new Error('DATABASE_URL 未配置，无法保存系统 OpenAI 配置。');
  }

  const existing = await prisma.systemLLMConfig.findUnique({ where: { id: 'default' } });
  const trimmedNewKey = input.apiKey?.trim() ?? '';
  let storedApiKey = trimmedNewKey ? encryptSystemSecret(trimmedNewKey) : '';
  if (!storedApiKey) {
    if (existing?.apiKey?.trim()) {
      storedApiKey = existing.apiKey.trim();
    } else if (process.env.OPENAI_API_KEY?.trim()) {
      storedApiKey = encryptSystemSecret(process.env.OPENAI_API_KEY.trim());
    } else {
      throw new Error('首次保存必须填写 OpenAI API Key。');
    }
  }

  const modelId = input.modelId?.trim() || DEFAULT_OPENAI_MODEL;
  const baseUrl = input.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL;

  const tierFields = input.tierModels
    ? {
        lowModelId: input.tierModels.low,
        mediumModelId: input.tierModels.medium,
        highModelId: input.tierModels.high,
      }
    : {};
  await prisma.systemLLMConfig.upsert({
    where: { id: 'default' },
    create: {
      id: 'default',
      ...tierFields,
      providerId: 'openai',
      modelId,
      apiKey: storedApiKey,
      baseUrl,
    },
    update: {
      ...tierFields,
      providerId: 'openai',
      modelId,
      apiKey: storedApiKey,
      baseUrl,
    },
  });

  return getSystemLLMConfigView();
}
