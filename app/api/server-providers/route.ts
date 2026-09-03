import {
  getServerProviders,
  getServerTTSProviders,
  getServerASRProviders,
  getServerPDFProviders,
  getServerImageProviders,
  getServerVideoProviders,
  getServerWebSearchProviders,
} from '@/lib/server/provider-config';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { CHAT_RESPONSE_STRENGTH_CONFIG } from '@/lib/ai/chat-response-strength';

const log = createLogger('ServerProviders');

export async function GET() {
  try {
    const providers = getServerProviders();
    const openaiFromServer = providers.openai || {};
    const systemLLM = await import('@/lib/server/system-llm-config').then((module) =>
      module.getSystemLLMConfigView(),
    );
    const openaiModels = Array.from(
      new Set([
        ...Object.values(CHAT_RESPONSE_STRENGTH_CONFIG).map((tier) => tier.modelId),
        ...(openaiFromServer.models || []),
        systemLLM.modelId,
      ]),
    );
    const openaiBaseUrl =
      openaiFromServer.baseUrl ||
      systemLLM.baseUrl ||
      process.env.OPENAI_BASE_URL?.trim() ||
      'https://api.openai.com/v1';
    const image = getServerImageProviders();
    const tts = getServerTTSProviders();
    const asr = getServerASRProviders();

    // One administrator-managed OpenAI key powers every OpenAI capability.
    // Only availability metadata is sent to the browser; the secret stays server-side.
    if (systemLLM.hasApiKey) {
      image['openai-image'] = {
        ...image['openai-image'],
        baseUrl: image['openai-image']?.baseUrl || openaiBaseUrl,
      };
      tts['openai-tts'] = {
        ...tts['openai-tts'],
        baseUrl: tts['openai-tts']?.baseUrl || openaiBaseUrl,
      };
      asr['openai-whisper'] = {
        ...asr['openai-whisper'],
        baseUrl: asr['openai-whisper']?.baseUrl || openaiBaseUrl,
      };
    }

    return apiSuccess({
      providers: {
        ...providers,
        openai: {
          ...openaiFromServer,
          models: openaiModels,
          baseUrl: openaiBaseUrl,
        },
      },
      tts,
      asr,
      pdf: getServerPDFProviders(),
      image,
      video: getServerVideoProviders(),
      webSearch: getServerWebSearchProviders(),
    });
  } catch (error) {
    log.error('Error fetching server providers:', error);
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Unknown error',
    );
  }
}
