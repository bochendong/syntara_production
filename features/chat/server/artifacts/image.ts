/**
 * Server-side image generation for the course chat assistant.
 *
 * Mirrors the provider resolution of server-side media generation
 * (system OpenAI image model first, then configured image providers) and the
 * credit/usage accounting of POST /api/generate/image, then normalizes the
 * result to PNG (or WebP when the PNG would be very large) with sharp.
 */
import { generateImage, IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import type {
  ImageGenerationOptions,
  ImageGenerationResult,
  ImageProviderId,
} from '@/lib/media/types';
import { SYSTEM_OPENAI_IMAGE_MODEL } from '@/lib/ai/system-model-policy';
import { createLogger } from '@/lib/logger';
import { recordCloudUsageCost } from '@/lib/server/cloud-usage-limits';
import { assertUserHasCredits, chargeCreditsForImageGeneration } from '@/lib/server/credits';
import { recordLLMUsage } from '@/lib/server/llm-usage';
import {
  getServerImageProviders,
  resolveImageApiKey,
  resolveImageBaseUrl,
} from '@/lib/server/provider-config';
import { proxyFetch } from '@/lib/server/proxy-fetch';
import { getRequestContext } from '@/lib/server/request-context';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';
import { estimateOpenAIImageGenerationCost } from '@/lib/utils/openai-pricing';

const log = createLogger('ChatArtifactImage');

export type ChatImageAspectRatio = NonNullable<ImageGenerationOptions['aspectRatio']>;

export type GenerateChatImageInput = {
  prompt: string;
  aspectRatio?: ChatImageAspectRatio;
  userId: string;
  courseId: string;
  courseName?: string;
};

export type GeneratedChatImage = {
  buffer: Buffer;
  mimeType: string;
  width?: number;
  height?: number;
};

const USAGE_ROUTE = '/api/courses/chat/generate-image';
const USAGE_SOURCE = 'course-chat-image';
const LARGE_PNG_BYTES = 6 * 1024 * 1024;

const ASPECT_RATIO_OUTPUT_SIZES: Record<ChatImageAspectRatio, { width: number; height: number }> = {
  '16:9': { width: 1792, height: 1008 },
  '4:3': { width: 1536, height: 1152 },
  '1:1': { width: 1024, height: 1024 },
  '9:16': { width: 1008, height: 1792 },
};

async function resolveImageProvider(): Promise<{
  providerId: ImageProviderId;
  apiKey: string;
  baseUrl?: string;
  model?: string;
}> {
  const systemOpenAI = await getSystemLLMRuntimeConfig();
  const candidates = Array.from(
    new Set([
      ...(systemOpenAI.apiKey ? ['openai-image'] : []),
      ...Object.keys(await getServerImageProviders()),
    ]),
  ) as ImageProviderId[];
  for (const providerId of candidates) {
    const isOpenAI = providerId === 'openai-image';
    const apiKey = (isOpenAI ? systemOpenAI.apiKey : '') || (await resolveImageApiKey(providerId));
    if (!apiKey) continue;
    return {
      providerId,
      apiKey,
      baseUrl:
        (isOpenAI ? systemOpenAI.baseUrl : undefined) || (await resolveImageBaseUrl(providerId)),
      model: isOpenAI ? SYSTEM_OPENAI_IMAGE_MODEL : IMAGE_PROVIDERS[providerId]?.models?.[0]?.id,
    };
  }
  throw new Error('当前没有可用的图片生成服务，请联系管理员配置图片模型。');
}

async function resultBuffer(result: ImageGenerationResult): Promise<Buffer> {
  if (result.base64) {
    return Buffer.from(result.base64.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, ''), 'base64');
  }
  if (result.url) {
    const response = await proxyFetch(result.url);
    if (!response.ok) throw new Error(`下载生成的图片失败（HTTP ${response.status}）。`);
    return Buffer.from(await response.arrayBuffer());
  }
  throw new Error('图片服务没有返回图片数据。');
}

function costEstimateUsd(
  providerId: ImageProviderId,
  modelId: string,
  result: ImageGenerationResult,
): number {
  if (providerId !== 'openai-image' || !result.usage) return 0;
  const estimate = estimateOpenAIImageGenerationCost({ modelId, ...result.usage });
  return estimate?.retailUsd ?? 0;
}

/** Generate one image for the chat, charging the requesting user. */
export async function generateChatImage(
  input: GenerateChatImageInput,
): Promise<GeneratedChatImage> {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('图片描述不能为空。');
  const aspectRatio = input.aspectRatio ?? '1:1';
  const requestContext = getRequestContext();

  await assertUserHasCredits(input.userId);
  const provider = await resolveImageProvider();
  log.info(
    `Generating chat image: provider=${provider.providerId}, model=${provider.model || 'default'}, course=${input.courseId}, aspect=${aspectRatio}`,
  );

  const result = await generateImage(
    { ...provider, fetch: proxyFetch as typeof fetch },
    { prompt, aspectRatio },
  );
  const resolvedModelId =
    result.usage?.modelId ||
    provider.model ||
    (provider.providerId === 'openai-image' ? SYSTEM_OPENAI_IMAGE_MODEL : '');
  const inputTokens = Math.max(0, Math.round(result.usage?.inputTokens || 0));
  const outputTokens = Math.max(0, Math.round(result.usage?.outputTokens || 0));
  const totalTokens =
    Math.max(0, Math.round(result.usage?.totalTokens || 0)) || inputTokens + outputTokens;

  // Accounting mirrors POST /api/generate/image.
  if (provider.providerId === 'openai-image') {
    await chargeCreditsForImageGeneration({
      userId: input.userId,
      providerId: provider.providerId,
      modelId: resolvedModelId,
      route: USAGE_ROUTE,
      prompt,
      courseId: input.courseId,
      courseName: input.courseName,
      operationCode: 'media_image_generation',
      chargeReason: '课程助手生成图片',
      serviceLabel: 'OpenAI Image API',
      usage: result.usage,
    });
  }
  if (totalTokens > 0) {
    await recordLLMUsage({
      requestContent: { prompt, aspectRatio },
      responseContent: { width: result.width, height: result.height, usage: result.usage },
      userId: input.userId,
      userEmail: requestContext?.userEmail,
      userName: requestContext?.userName,
      route: USAGE_ROUTE,
      source: USAGE_SOURCE,
      providerId: provider.providerId,
      modelId: resolvedModelId,
      modelString: `${provider.providerId}:${resolvedModelId}`,
      inputTokens,
      outputTokens,
      totalTokens,
      courseId: input.courseId,
      courseName: input.courseName,
      operationCode: 'media_image_generation',
      chargeReason: '课程助手生成图片',
      serviceLabel: 'Image API',
      // Already charged above with the image-specific pricing table.
      skipCreditCharge: true,
    });
  } else {
    await recordCloudUsageCost({
      userId: input.userId,
      route: USAGE_ROUTE,
      source: USAGE_SOURCE,
      estimatedCostUsd: costEstimateUsd(provider.providerId, resolvedModelId, result),
      requestCount: 1,
      metadata: {
        providerId: provider.providerId,
        modelId: resolvedModelId,
        hasUsage: Boolean(result.usage),
        courseId: input.courseId,
      },
    });
  }

  const raw = await resultBuffer(result);
  const sharp = (await import('sharp')).default;
  let pipeline = sharp(raw, { failOn: 'none' }).rotate();
  const metadata = await pipeline.metadata();
  const target = ASPECT_RATIO_OUTPUT_SIZES[aspectRatio];
  const width = metadata.autoOrient?.width ?? metadata.width ?? result.width;
  const height = metadata.autoOrient?.height ?? metadata.height ?? result.height;
  // Some providers ignore the requested ratio (e.g. OpenAI portrait sizes).
  const ratioOff =
    width && height && Math.abs(width / height - target.width / target.height) > 0.01;
  if (ratioOff) {
    pipeline = pipeline.resize(target.width, target.height, {
      fit: 'contain',
      background: '#ffffff',
    });
  }
  const png = await pipeline.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true });
  if (png.data.byteLength <= LARGE_PNG_BYTES) {
    return {
      buffer: png.data,
      mimeType: 'image/png',
      width: png.info.width,
      height: png.info.height,
    };
  }
  const webp = await sharp(png.data).webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
  return {
    buffer: webp.data,
    mimeType: 'image/webp',
    width: webp.info.width,
    height: webp.info.height,
  };
}
