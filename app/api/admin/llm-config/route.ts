import { z } from 'zod';
import { isAdminTextModel } from '@/lib/ai/admin-model-options';
import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getSystemLLMConfigView, updateSystemLLMConfig } from '@/lib/server/system-llm-config';

const modelSchema = z.string().trim().refine(isAdminTextModel, '请选择支持的通用文本模型');
const configSchema = z.object({
  modelId: modelSchema,
  tierModels: z.object({ low: modelSchema, medium: modelSchema, high: modelSchema }).optional(),
  apiKey: z.string().max(1000).optional(),
  baseUrl: z
    .string()
    .trim()
    .url()
    .refine((value) => /^https?:\/\//.test(value), '请输入有效服务地址')
    .optional(),
});

export async function GET() {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const config = await getSystemLLMConfigView();
  const response = apiSuccess({
    config: {
      providerId: config.providerId,
      modelId: config.modelId,
      tierModels: config.tierModels,
      baseUrl: config.baseUrl || '',
      hasApiKey: config.hasApiKey,
      maskedApiKey: config.apiKeyMasked,
      source: config.source,
      updatedAt: config.updatedAt,
    },
  });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  try {
    const parsed = configSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success)
      return apiError('INVALID_REQUEST', 400, parsed.error.issues[0]?.message || '配置无效');
    const { modelId, tierModels, baseUrl } = parsed.data;
    const apiKey = parsed.data.apiKey?.trim();

    const saved = await updateSystemLLMConfig({
      modelId,
      tierModels,
      ...(apiKey ? { apiKey } : {}),
      baseUrl,
    });
    return apiSuccess({
      config: {
        providerId: saved.providerId,
        modelId: saved.modelId,
        tierModels: saved.tierModels,
        baseUrl: saved.baseUrl || '',
        hasApiKey: saved.hasApiKey,
        maskedApiKey: saved.apiKeyMasked,
        source: saved.source,
        updatedAt: saved.updatedAt,
      },
    });
  } catch (error) {
    return apiError(
      'INTERNAL_ERROR',
      500,
      error instanceof Error ? error.message : 'Failed to save config',
    );
  }
}
