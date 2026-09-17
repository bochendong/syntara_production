/**
 * Server-side Provider Configuration
 *
 * Loads provider configs from YAML (primary) + environment variables (fallback).
 * Keys never leave the server — only provider IDs and metadata are exposed via API.
 */

import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';
import { CHAT_RESPONSE_STRENGTH_CONFIG } from '@/lib/ai/chat-response-strength';
import {
  NOTEBOOK_MODEL_PRESET_FULL,
  NOTEBOOK_MODEL_PRESET_MINI,
} from '@/lib/constants/notebook-generation-model-presets';
import { SYSTEM_OPENAI_IMAGE_MODEL } from '@/lib/ai/system-model-policy';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { createLogger } from '@/lib/logger';
import type { SiteProviderAdminRow } from '@/lib/types/admin-site-providers';

const log = createLogger('ServerProviderConfig');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServerProviderEntry {
  apiKey: string;
  baseUrl?: string;
  models?: string[];
  proxy?: string;
}

interface ServerConfig {
  providers: Record<string, ServerProviderEntry>;
  tts: Record<string, ServerProviderEntry>;
  asr: Record<string, ServerProviderEntry>;
  pdf: Record<string, ServerProviderEntry>;
  image: Record<string, ServerProviderEntry>;
  video: Record<string, ServerProviderEntry>;
  webSearch: Record<string, ServerProviderEntry>;
}

// ---------------------------------------------------------------------------
// Env-var prefix mappings
// ---------------------------------------------------------------------------

const LLM_ENV_MAP: Record<string, string> = {
  OPENAI: 'openai',
  ANTHROPIC: 'anthropic',
  GOOGLE: 'google',
  DEEPSEEK: 'deepseek',
  QWEN: 'qwen',
  KIMI: 'kimi',
  MINIMAX: 'minimax',
  GLM: 'glm',
  SILICONFLOW: 'siliconflow',
  DOUBAO: 'doubao',
  GROK: 'grok',
};

const TTS_ENV_MAP: Record<string, string> = {
  TTS_OPENAI: 'openai-tts',
  TTS_AZURE: 'azure-tts',
  TTS_GLM: 'glm-tts',
  TTS_QWEN: 'qwen-tts',
  TTS_ELEVENLABS: 'elevenlabs-tts',
};

const ASR_ENV_MAP: Record<string, string> = {
  ASR_OPENAI: 'openai-whisper',
  ASR_QWEN: 'qwen-asr',
};

const PDF_ENV_MAP: Record<string, string> = {
  PDF_UNPDF: 'unpdf',
  PDF_MINERU: 'mineru',
};

const IMAGE_ENV_MAP: Record<string, string> = {
  IMAGE_SEEDREAM: 'seedream',
  IMAGE_QWEN_IMAGE: 'qwen-image',
  IMAGE_NANO_BANANA: 'nano-banana',
  IMAGE_GROK: 'grok-image',
  IMAGE_OPENAI_IMAGE: 'openai-image',
};

const VIDEO_ENV_MAP: Record<string, string> = {
  VIDEO_SEEDANCE: 'seedance',
  VIDEO_KLING: 'kling',
  VIDEO_VEO: 'veo',
  VIDEO_SORA: 'sora',
  VIDEO_GROK: 'grok-video',
};

const WEB_SEARCH_ENV_MAP: Record<string, string> = {
  TAVILY: 'tavily',
};

// ---------------------------------------------------------------------------
// YAML loading
// ---------------------------------------------------------------------------

type YamlData = Partial<{
  providers: Record<string, Partial<ServerProviderEntry>>;
  tts: Record<string, Partial<ServerProviderEntry>>;
  asr: Record<string, Partial<ServerProviderEntry>>;
  pdf: Record<string, Partial<ServerProviderEntry>>;
  image: Record<string, Partial<ServerProviderEntry>>;
  video: Record<string, Partial<ServerProviderEntry>>;
  'web-search': Record<string, Partial<ServerProviderEntry>>;
}>;

function loadYamlFile(filename: string): YamlData {
  try {
    const filePath = path.join(process.cwd(), filename);
    if (!fs.existsSync(filePath)) return {};
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = yaml.load(raw) as Record<string, unknown> | null;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as YamlData;
  } catch (e) {
    log.warn(`[ServerProviderConfig] Failed to load ${filename}:`, e);
    return {};
  }
}

// ---------------------------------------------------------------------------
// Env-var helpers
// ---------------------------------------------------------------------------

function loadEnvSection(
  envMap: Record<string, string>,
  yamlSection: Record<string, Partial<ServerProviderEntry>> | undefined,
): Record<string, ServerProviderEntry> {
  const result: Record<string, ServerProviderEntry> = {};

  // First, add everything from YAML as defaults
  if (yamlSection) {
    for (const [id, entry] of Object.entries(yamlSection)) {
      if (entry?.apiKey) {
        result[id] = {
          apiKey: entry.apiKey,
          baseUrl: entry.baseUrl,
          models: entry.models,
          proxy: entry.proxy,
        };
      }
    }
  }

  // Then, apply env vars (env takes priority over YAML)
  for (const [prefix, providerId] of Object.entries(envMap)) {
    const envApiKey = process.env[`${prefix}_API_KEY`] || undefined;
    const envBaseUrl = process.env[`${prefix}_BASE_URL`] || undefined;
    const envModelsStr = process.env[`${prefix}_MODELS`];
    const envModels = envModelsStr
      ? envModelsStr
          .split(',')
          .map((m) => m.trim())
          .filter(Boolean)
      : undefined;

    if (result[providerId]) {
      // YAML entry exists — env vars override individual fields
      if (envApiKey) result[providerId].apiKey = envApiKey;
      if (envBaseUrl) result[providerId].baseUrl = envBaseUrl;
      if (envModels) result[providerId].models = envModels;
      continue;
    }

    if (!envApiKey) continue;
    result[providerId] = {
      apiKey: envApiKey,
      baseUrl: envBaseUrl,
      models: envModels,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// Module-level cache (process singleton)
// ---------------------------------------------------------------------------

const DEFAULT_FILENAME = 'server-providers.yml';

/** Cache keyed by YAML filename (empty string = default file). */
const _configs: Map<string, ServerConfig> = new Map();

function buildConfig(yamlData: YamlData): ServerConfig {
  const image = loadEnvSection(IMAGE_ENV_MAP, yamlData.image);
  if (!image['openai-image'] && process.env.OPENAI_API_KEY) {
    image['openai-image'] = {
      apiKey: process.env.OPENAI_API_KEY,
      baseUrl: process.env.IMAGE_OPENAI_IMAGE_BASE_URL || undefined,
      models: process.env.IMAGE_OPENAI_IMAGE_MODELS?.split(',')
        .map((model) => model.trim())
        .filter(Boolean),
    };
  }
  return {
    providers: loadEnvSection(LLM_ENV_MAP, yamlData.providers),
    tts: loadEnvSection(TTS_ENV_MAP, yamlData.tts),
    asr: loadEnvSection(ASR_ENV_MAP, yamlData.asr),
    pdf: loadEnvSection(PDF_ENV_MAP, yamlData.pdf),
    image,
    video: loadEnvSection(VIDEO_ENV_MAP, yamlData.video),
    webSearch: loadEnvSection(WEB_SEARCH_ENV_MAP, yamlData['web-search']),
  };
}

function logConfig(config: ServerConfig, label: string): void {
  const counts = [
    Object.keys(config.providers).length,
    Object.keys(config.tts).length,
    Object.keys(config.asr).length,
    Object.keys(config.pdf).length,
    Object.keys(config.image).length,
    Object.keys(config.video).length,
    Object.keys(config.webSearch).length,
  ];
  if (counts.some((c) => c > 0)) {
    log.info(
      `[ServerProviderConfig] Loaded (${label}): ${counts[0]} LLM, ${counts[1]} TTS, ${counts[2]} ASR, ${counts[3]} PDF, ${counts[4]} Image, ${counts[5]} Video, ${counts[6]} WebSearch providers`,
    );
  }
}

function getConfig(): ServerConfig {
  const cached = _configs.get('');
  if (cached) return cached;

  const yamlData = loadYamlFile(DEFAULT_FILENAME);
  const config = buildConfig(yamlData);
  logConfig(config, DEFAULT_FILENAME);
  _configs.set('', config);
  return config;
}

/** The OpenAI credential and endpoint always travel together. Legacy per-feature
 * keys and browser overrides cannot supersede the administrator's saved config.
 */
async function getEffectiveConfig(): Promise<ServerConfig> {
  const legacy = getConfig();
  const system = await getSystemLLMRuntimeConfig();
  const entry = { apiKey: system.apiKey, baseUrl: system.baseUrl };
  const replace = (section: Record<string, ServerProviderEntry>, id: string, models?: string[]) => {
    const result = { ...section };
    delete result[id];
    if (system.apiKey) result[id] = { ...entry, models };
    return result;
  };
  return {
    ...legacy,
    providers: replace(legacy.providers, 'openai', [
      ...new Set([
        ...Object.values(CHAT_RESPONSE_STRENGTH_CONFIG).map((tier) => tier.modelId),
        NOTEBOOK_MODEL_PRESET_FULL,
        NOTEBOOK_MODEL_PRESET_MINI,
        system.modelId,
      ]),
    ]),
    image: replace(legacy.image, 'openai-image', [SYSTEM_OPENAI_IMAGE_MODEL]),
    tts: replace(legacy.tts, 'openai-tts'),
    asr: replace(legacy.asr, 'openai-whisper'),
    // Sora remains opt-in, but when enabled it uses the same OpenAI credentials.
    video: legacy.video.sora
      ? replace(legacy.video, 'sora', legacy.video.sora.models)
      : legacy.video,
  };
}

// ---------------------------------------------------------------------------
// Public API — LLM
// ---------------------------------------------------------------------------

/** Returns server-configured LLM providers (no apiKeys) */
export async function getServerProviders(): Promise<
  Record<string, { models?: string[]; baseUrl?: string }>
> {
  const cfg = await getEffectiveConfig();
  const result: Record<string, { models?: string[]; baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.providers)) {
    result[id] = {};
    if (entry.models && entry.models.length > 0) result[id].models = entry.models;
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

/** Resolve API keys. OpenAI always uses the administrator's shared key; other
 * providers may still accept an explicitly supplied client key. */
export async function resolveApiKey(providerId: string, clientKey?: string): Promise<string> {
  if (providerId !== 'openai' && clientKey) return clientKey;
  return (await getEffectiveConfig()).providers[providerId]?.apiKey || '';
}

/** Resolve base URLs. OpenAI always uses the administrator's shared endpoint;
 * other providers may still accept an explicitly supplied client endpoint. */
export async function resolveBaseUrl(
  providerId: string,
  clientBaseUrl?: string,
): Promise<string | undefined> {
  if (providerId !== 'openai' && clientBaseUrl) return clientBaseUrl;
  return (await getEffectiveConfig()).providers[providerId]?.baseUrl;
}

/** Resolve proxy URL for a provider (server config only) */
export function resolveProxy(providerId: string): string | undefined {
  return getConfig().providers[providerId]?.proxy;
}

// ---------------------------------------------------------------------------
// Public API — TTS
// ---------------------------------------------------------------------------

export async function getServerTTSProviders(): Promise<Record<string, { baseUrl?: string }>> {
  const cfg = await getEffectiveConfig();
  const result: Record<string, { baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.tts)) {
    result[id] = {};
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

export async function resolveTTSApiKey(providerId: string, clientKey?: string): Promise<string> {
  if (providerId !== 'openai-tts' && clientKey) return clientKey;
  return (await getEffectiveConfig()).tts[providerId]?.apiKey || '';
}

export async function resolveTTSBaseUrl(
  providerId: string,
  clientBaseUrl?: string,
): Promise<string | undefined> {
  if (providerId !== 'openai-tts' && clientBaseUrl) return clientBaseUrl;
  return (await getEffectiveConfig()).tts[providerId]?.baseUrl;
}

// ---------------------------------------------------------------------------
// Public API — ASR
// ---------------------------------------------------------------------------

export async function getServerASRProviders(): Promise<Record<string, { baseUrl?: string }>> {
  const cfg = await getEffectiveConfig();
  const result: Record<string, { baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.asr)) {
    result[id] = {};
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

export async function resolveASRApiKey(providerId: string, clientKey?: string): Promise<string> {
  if (providerId !== 'openai-whisper' && clientKey) return clientKey;
  return (await getEffectiveConfig()).asr[providerId]?.apiKey || '';
}

export async function resolveASRBaseUrl(
  providerId: string,
  clientBaseUrl?: string,
): Promise<string | undefined> {
  if (providerId !== 'openai-whisper' && clientBaseUrl) return clientBaseUrl;
  return (await getEffectiveConfig()).asr[providerId]?.baseUrl;
}

// ---------------------------------------------------------------------------
// Public API — PDF
// ---------------------------------------------------------------------------

export function getServerPDFProviders(): Record<string, { baseUrl?: string }> {
  const cfg = getConfig();
  const result: Record<string, { baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.pdf)) {
    result[id] = {};
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

export function resolvePDFApiKey(providerId: string, clientKey?: string): string {
  if (clientKey) return clientKey;
  return getConfig().pdf[providerId]?.apiKey || '';
}

export function resolvePDFBaseUrl(providerId: string, clientBaseUrl?: string): string | undefined {
  if (clientBaseUrl) return clientBaseUrl;
  return getConfig().pdf[providerId]?.baseUrl;
}

// ---------------------------------------------------------------------------
// Public API — Image Generation
// ---------------------------------------------------------------------------

export async function getServerImageProviders(): Promise<
  Record<string, { baseUrl?: string; models?: string[] }>
> {
  const cfg = await getEffectiveConfig();
  const result: Record<string, { baseUrl?: string; models?: string[] }> = {};
  for (const [id, entry] of Object.entries(cfg.image)) {
    result[id] = {};
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
    if (entry.models?.length) result[id].models = entry.models;
  }
  return result;
}

export async function resolveImageApiKey(providerId: string, clientKey?: string): Promise<string> {
  if (providerId !== 'openai-image' && clientKey) return clientKey;
  return (await getEffectiveConfig()).image[providerId]?.apiKey || '';
}

export async function resolveImageBaseUrl(
  providerId: string,
  clientBaseUrl?: string,
): Promise<string | undefined> {
  if (providerId !== 'openai-image' && clientBaseUrl) return clientBaseUrl;
  return (await getEffectiveConfig()).image[providerId]?.baseUrl;
}

// ---------------------------------------------------------------------------
// Public API — Video Generation
// ---------------------------------------------------------------------------

export async function getServerVideoProviders(): Promise<
  Record<string, { baseUrl?: string; models?: string[] }>
> {
  const cfg = await getEffectiveConfig();
  const result: Record<string, { baseUrl?: string; models?: string[] }> = {};
  for (const [id, entry] of Object.entries(cfg.video)) {
    result[id] = {};
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
    if (entry.models?.length) result[id].models = entry.models;
  }
  return result;
}

export async function resolveVideoApiKey(providerId: string, clientKey?: string): Promise<string> {
  if (providerId !== 'sora' && clientKey) return clientKey;
  return (await getEffectiveConfig()).video[providerId]?.apiKey || '';
}

export async function resolveVideoBaseUrl(
  providerId: string,
  clientBaseUrl?: string,
): Promise<string | undefined> {
  if (providerId !== 'sora' && clientBaseUrl) return clientBaseUrl;
  return (await getEffectiveConfig()).video[providerId]?.baseUrl;
}

// ---------------------------------------------------------------------------
// Public API — Web Search (Tavily)
// ---------------------------------------------------------------------------

/** Returns server-configured web search providers (no apiKeys exposed) */
export function getServerWebSearchProviders(): Record<string, { baseUrl?: string }> {
  const cfg = getConfig();
  const result: Record<string, { baseUrl?: string }> = {};
  for (const [id, entry] of Object.entries(cfg.webSearch)) {
    result[id] = {};
    if (entry.baseUrl) result[id].baseUrl = entry.baseUrl;
  }
  return result;
}

/** Resolve Tavily API key: client key > server key > TAVILY_API_KEY env > empty */
export function resolveWebSearchApiKey(clientKey?: string): string {
  if (clientKey) return clientKey;
  const serverKey = getConfig().webSearch.tavily?.apiKey;
  if (serverKey) return serverKey;
  return process.env.TAVILY_API_KEY || '';
}

// ---------------------------------------------------------------------------
// Admin console — site-wide provider status (no secrets)
// ---------------------------------------------------------------------------

export type { SiteProviderAdminRow } from '@/lib/types/admin-site-providers';

function rowsFromSection(section: Record<string, ServerProviderEntry>): SiteProviderAdminRow[] {
  const getApiKeyLast4 = (apiKey?: string): string | null => {
    const trimmed = apiKey?.trim() || '';
    if (!trimmed) return null;
    return trimmed.length <= 4 ? trimmed : trimmed.slice(-4);
  };

  return Object.entries(section).map(([id, entry]) => ({
    id,
    hasApiKey: Boolean(entry.apiKey?.trim()),
    apiKeyLast4: getApiKeyLast4(entry.apiKey),
    baseUrl: entry.baseUrl ?? null,
    models: entry.models ?? null,
  }));
}

/** 管理员可见的服务端 provider 配置（全站 OpenAI 配置已合并），不含密钥明文。 */
export async function getSiteProviderAdminView(): Promise<{
  llm: SiteProviderAdminRow[];
  image: SiteProviderAdminRow[];
  tts: SiteProviderAdminRow[];
  webSearch: SiteProviderAdminRow[];
}> {
  const cfg = await getEffectiveConfig();
  return {
    llm: rowsFromSection(cfg.providers),
    image: rowsFromSection(cfg.image),
    tts: rowsFromSection(cfg.tts),
    webSearch: rowsFromSection(cfg.webSearch),
  };
}

/** 各提供方对应的环境变量名，供管理员在 .env / 托管面板中配置 */
export function getAdminProviderEnvHints(): {
  llm: Record<string, { apiKey: string; baseUrl: string; models: string }>;
  image: Record<string, { apiKey: string; baseUrl: string; models: string }>;
  tts: Record<string, { apiKey: string; baseUrl: string }>;
  webSearch: Record<string, { apiKey: string; baseUrl: string }>;
} {
  return {
    llm: Object.fromEntries(
      Object.entries(LLM_ENV_MAP).map(([prefix, pid]) => [
        pid,
        {
          apiKey: `${prefix}_API_KEY`,
          baseUrl: `${prefix}_BASE_URL`,
          models: `${prefix}_MODELS`,
        },
      ]),
    ),
    image: Object.fromEntries(
      Object.entries(IMAGE_ENV_MAP).map(([prefix, pid]) => [
        pid,
        {
          apiKey: `${prefix}_API_KEY`,
          baseUrl: `${prefix}_BASE_URL`,
          models: `${prefix}_MODELS`,
        },
      ]),
    ),
    tts: Object.fromEntries(
      Object.entries(TTS_ENV_MAP).map(([prefix, pid]) => [
        pid,
        { apiKey: `${prefix}_API_KEY`, baseUrl: `${prefix}_BASE_URL` },
      ]),
    ),
    webSearch: Object.fromEntries(
      Object.entries(WEB_SEARCH_ENV_MAP).map(([prefix, pid]) => [
        pid,
        { apiKey: `${prefix}_API_KEY`, baseUrl: `${prefix}_BASE_URL` },
      ]),
    ),
  };
}
