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

const log = createLogger('ServerProviders');

export async function GET() {
  try {
    const providers = getServerProviders();
    const openaiFromServer = providers.openai || {};
    // Avoid a remote database round trip on the user-facing settings page when
    // the runtime provider config already contains everything the client needs.
    const systemLLM = openaiFromServer.models?.length
      ? null
      : await import('@/lib/server/system-llm-config').then((module) =>
          module.getSystemLLMConfigView(),
        );
    const openaiModels =
      openaiFromServer.models && openaiFromServer.models.length > 0
        ? openaiFromServer.models
        : [systemLLM!.modelId];
    const openaiBaseUrl =
      openaiFromServer.baseUrl ||
      systemLLM?.baseUrl ||
      process.env.OPENAI_BASE_URL?.trim() ||
      'https://api.openai.com/v1';

    return apiSuccess({
      providers: {
        ...providers,
        openai: {
          ...openaiFromServer,
          models: openaiModels,
          baseUrl: openaiBaseUrl,
        },
      },
      tts: getServerTTSProviders(),
      asr: getServerASRProviders(),
      pdf: getServerPDFProviders(),
      image: getServerImageProviders(),
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
