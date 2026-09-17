/**
 * Verify Image Provider API
 *
 * Lightweight endpoint that validates provider credentials without generating images.
 *
 * POST /api/verify-image-provider
 *
 * Headers:
 *   x-image-provider: ImageProviderId
 *   x-image-model: string (optional)
 * Provider credentials are always resolved on the server.
 *
 * Response: { success: boolean, message: string }
 */

import { NextRequest } from 'next/server';
import { testImageConnectivity } from '@/lib/media/image-providers';
import { resolveImageApiKey, resolveImageBaseUrl } from '@/lib/server/provider-config';
import type { ImageProviderId } from '@/lib/media/types';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { createLogger } from '@/lib/logger';
import { proxyFetch } from '@/lib/server/proxy-fetch';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';
import { SYSTEM_OPENAI_IMAGE_MODEL } from '@/lib/ai/system-model-policy';

const log = createLogger('VerifyImageProvider');

export async function POST(request: NextRequest) {
  try {
    const providerId = (request.headers.get('x-image-provider') || 'seedream') as ImageProviderId;
    const systemOpenAI = providerId === 'openai-image' ? await getSystemLLMRuntimeConfig() : null;
    const model =
      providerId === 'openai-image'
        ? SYSTEM_OPENAI_IMAGE_MODEL
        : request.headers.get('x-image-model') || undefined;
    const apiKey = systemOpenAI?.apiKey || (await resolveImageApiKey(providerId)) || '';
    const baseUrl = systemOpenAI?.baseUrl || (await resolveImageBaseUrl(providerId));

    if (!apiKey) {
      return apiError('MISSING_API_KEY', 400, 'No API key configured');
    }

    const result = await testImageConnectivity({
      providerId,
      apiKey,
      baseUrl,
      model,
      fetch: proxyFetch as typeof fetch,
    });

    if (!result.success) {
      return apiError('UPSTREAM_ERROR', 500, result.message);
    }

    return apiSuccess({ message: result.message });
  } catch (err) {
    log.error('Connectivity test error:', err);
    return apiError('INTERNAL_ERROR', 500, `Connectivity test error: ${err}`);
  }
}
