import { NextRequest } from 'next/server';
import { generateText } from 'ai';
import { createLogger } from '@/lib/logger';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { assertUserHasCredits } from '@/lib/server/credits';
import { recordLLMUsage } from '@/lib/server/llm-usage';
import { getRequestContext, runWithRequestContext } from '@/lib/server/request-context';
import { resolveModel } from '@/lib/server/resolve-model';
const log = createLogger('Verify Model');

export async function POST(req: NextRequest) {
  return runWithRequestContext(req, '/api/verify-model', async () => {
    try {
      const { model } = await req.json();

      if (!model) {
        return apiError('MISSING_REQUIRED_FIELD', 400, 'Model name is required');
      }

      // Parse model string and resolve server-side fallback
      let resolvedModel;
      try {
        resolvedModel = await resolveModel({
          modelString: model,
        });
      } catch (error) {
        return apiError(
          'INVALID_REQUEST',
          401,
          error instanceof Error ? error.message : String(error),
        );
      }

      await assertUserHasCredits(getRequestContext()?.userId);

      // Send a minimal test message
      const { text, usage } = await generateText({
        model: resolvedModel.model,
        prompt: 'Say "OK" if you can hear me.',
      });

      const inputTokens = Math.max(0, Math.round(usage?.inputTokens || 0));
      const outputTokens = Math.max(0, Math.round(usage?.outputTokens || 0));
      const totalTokens =
        Math.max(0, Math.round(usage?.totalTokens || 0)) || inputTokens + outputTokens;
      const modelId = resolvedModel.modelString.split(':').pop() || resolvedModel.modelString;
      await recordLLMUsage({
        userId: getRequestContext()?.userId,
        userEmail: getRequestContext()?.userEmail,
        userName: getRequestContext()?.userName,
        route: '/api/verify-model',
        source: 'model-verification',
        providerId: resolvedModel.providerId,
        modelId,
        modelString: resolvedModel.modelString,
        inputTokens,
        outputTokens,
        totalTokens,
        operationCode: 'model_verification',
        chargeReason: '验证语言模型连接',
        serviceLabel: 'Language Model API',
      });

      return apiSuccess({
        message: 'Connection successful',
        response: text,
      });
    } catch (error) {
      log.error('API test error:', error);

      let errorMessage = 'Connection failed';
      if (error instanceof Error) {
        // Parse common error messages
        if (error.message.includes('401') || error.message.includes('Unauthorized')) {
          errorMessage = 'API key is invalid or expired';
        } else if (error.message.includes('404') || error.message.includes('not found')) {
          errorMessage = 'Model not found or API endpoint error';
        } else if (error.message.includes('429')) {
          errorMessage = 'API rate limit exceeded, please try again later';
        } else if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
          errorMessage = 'Cannot connect to API server, please check the Base URL';
        } else if (error.message.includes('timeout')) {
          errorMessage = 'Connection timed out, please check your network';
        } else {
          errorMessage = error.message;
        }
      }

      return apiError('INTERNAL_ERROR', 500, errorMessage);
    }
  });
}
