/**
 * OpenAI image generation.
 *
 * `gpt-image-2` uses the Responses API image-generation tool in background
 * mode. Image generation routinely exceeds one minute, while a local or
 * corporate HTTP proxy may terminate an idle synchronous connection at the
 * 60-second mark. Submitting once and polling the same response id avoids both
 * that transport failure and accidental duplicate paid generations.
 *
 * Older GPT Image models retain the Images API path for compatibility.
 */

import type {
  ImageGenerationConfig,
  ImageGenerationOptions,
  ImageGenerationResult,
} from '../types';

const DEFAULT_MODEL = 'gpt-image-2';
const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const RESPONSES_IMAGE_HOST_MODEL = 'gpt-5.6-sol';
const RESPONSES_POLL_INTERVAL_MS = 2_000;
const RESPONSES_TIMEOUT_MS = 15 * 60_000;
const RESPONSES_CREATE_MAX_RETRIES = 2;

type OpenAiImageSize = '1024x1024' | '1024x1536' | '1536x1024';

type OpenAiResponsesImagePayload = {
  id?: unknown;
  status?: unknown;
  error?: { message?: unknown } | null;
  incomplete_details?: { reason?: unknown } | null;
  output?: Array<{
    type?: unknown;
    result?: unknown;
  }>;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    total_tokens?: unknown;
    input_tokens_details?: {
      text_tokens?: unknown;
      image_tokens?: unknown;
    };
  };
};

function parseSizeDims(size: OpenAiImageSize): { width: number; height: number } {
  const [w, h] = size.split('x').map(Number);
  return { width: w || 1024, height: h || 1024 };
}

function resolveOpenAiSize(options: ImageGenerationOptions): OpenAiImageSize {
  if (options.aspectRatio) {
    switch (options.aspectRatio) {
      case '1:1':
        return '1024x1024';
      case '9:16':
        return '1024x1536';
      case '16:9':
        return '1536x1024';
      case '4:3':
        return '1536x1024';
      default:
        return '1536x1024';
    }
  }
  const w = options.width || 1024;
  const h = options.height || 1024;
  const r = w / h;
  if (r > 1.2) return '1536x1024';
  if (r < 0.85) return '1024x1536';
  return '1024x1024';
}

function isOfficialOpenAiBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

function isPendingResponse(payload: OpenAiResponsesImagePayload): boolean {
  return payload.status === 'queued' || payload.status === 'in_progress';
}

function responseFailureMessage(payload: OpenAiResponsesImagePayload): string {
  const errorMessage = payload.error?.message;
  if (typeof errorMessage === 'string' && errorMessage.trim()) return errorMessage;
  const incompleteReason = payload.incomplete_details?.reason;
  if (typeof incompleteReason === 'string' && incompleteReason.trim()) return incompleteReason;
  return `OpenAI background image response ended with status: ${String(payload.status || 'unknown')}`;
}

async function responseJson(
  response: Response,
  failureLabel: string,
): Promise<OpenAiResponsesImagePayload> {
  const text = await response.text();
  const payload = (() => {
    try {
      return JSON.parse(text) as OpenAiResponsesImagePayload;
    } catch {
      return null;
    }
  })();
  if (!response.ok || !payload) {
    throw new Error(`${failureLabel} (${response.status}): ${text || response.statusText}`);
  }
  return payload;
}

function shouldRetryCreateStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function createBackgroundImageResponse(args: {
  request: typeof fetch;
  url: string;
  headers: Record<string, string>;
  body: string;
}): Promise<Response> {
  const { request, url, headers, body } = args;
  let lastError: unknown;

  for (let attempt = 0; attempt <= RESPONSES_CREATE_MAX_RETRIES; attempt += 1) {
    try {
      const response = await request(url, {
        method: 'POST',
        headers: {
          ...headers,
          'x-stainless-retry-count': String(attempt),
        },
        body,
      });
      if (!shouldRetryCreateStatus(response.status) || attempt === RESPONSES_CREATE_MAX_RETRIES) {
        return response;
      }
    } catch (error) {
      lastError = error;
      if (attempt === RESPONSES_CREATE_MAX_RETRIES) throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('OpenAI background image submission failed');
}

async function generateWithResponsesImageTool(args: {
  baseUrl: string;
  request: typeof fetch;
  apiKey: string;
  imageModel: string;
  size: OpenAiImageSize;
  options: ImageGenerationOptions;
  providerId: string;
}): Promise<ImageGenerationResult> {
  const { baseUrl, request, apiKey, imageModel, size, options, providerId } = args;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  const createBody = JSON.stringify({
    model: RESPONSES_IMAGE_HOST_MODEL,
    input: options.prompt,
    // The host model only has to dispatch the image-generation tool. Disabling
    // reasoning avoids spending text-model tokens before GPT Image 2 starts.
    reasoning: { effort: 'none' },
    background: true,
    store: true,
    tools: [
      {
        type: 'image_generation',
        model: imageModel,
        size,
        quality: options.quality || 'auto',
        background: 'opaque',
        output_format: 'png',
      },
    ],
    tool_choice: { type: 'image_generation' },
  });
  let payload = await responseJson(
    await createBackgroundImageResponse({
      request,
      url: `${baseUrl}/responses`,
      headers,
      body: createBody,
    }),
    'OpenAI background image submission failed',
  );

  const responseId = typeof payload.id === 'string' ? payload.id : '';
  if (isPendingResponse(payload) && !responseId) {
    throw new Error('OpenAI background image response is missing a response id');
  }

  const deadline = Date.now() + RESPONSES_TIMEOUT_MS;
  while (isPendingResponse(payload) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, RESPONSES_POLL_INTERVAL_MS));
    let pollResponse: Response;
    try {
      pollResponse = await request(`${baseUrl}/responses/${encodeURIComponent(responseId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      });
    } catch {
      // Polling an existing response is idempotent. Keep the same response id
      // across a transient proxy failure instead of submitting another image.
      continue;
    }
    payload = await responseJson(pollResponse, 'OpenAI background image poll failed');
  }

  if (isPendingResponse(payload)) {
    throw new Error(
      `OpenAI background image response ${responseId} did not finish within ${RESPONSES_TIMEOUT_MS / 60_000} minutes`,
    );
  }
  if (payload.status !== 'completed') throw new Error(responseFailureMessage(payload));

  const imageCall = payload.output?.find((item) => item.type === 'image_generation_call');
  if (!imageCall || typeof imageCall.result !== 'string' || !imageCall.result) {
    throw new Error('OpenAI background image response missing image_generation_call result');
  }

  const { width, height } = parseSizeDims(size);
  const usage = payload.usage
    ? {
        providerId,
        modelId: imageModel,
        inputTokens: Number(payload.usage.input_tokens) || 0,
        outputTokens: Number(payload.usage.output_tokens) || 0,
        totalTokens: Number(payload.usage.total_tokens) || 0,
        textInputTokens: Number(payload.usage.input_tokens_details?.text_tokens) || 0,
        imageInputTokens: Number(payload.usage.input_tokens_details?.image_tokens) || 0,
      }
    : undefined;

  return {
    base64: imageCall.result,
    width,
    height,
    usage,
  };
}

/**
 * Validates the API key via GET /models (no image generation charge).
 */
export async function testOpenAiImageConnectivity(
  config: ImageGenerationConfig,
): Promise<{ success: boolean; message: string }> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const request = config.fetch || fetch;
  try {
    const response = await request(`${baseUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
    if (response.status === 401 || response.status === 403) {
      const text = await response.text();
      return {
        success: false,
        message: `OpenAI auth failed (${response.status}): ${text}`,
      };
    }
    if (!response.ok) {
      const text = await response.text();
      return { success: false, message: `OpenAI error (${response.status}): ${text}` };
    }
    return { success: true, message: 'Connected to OpenAI API' };
  } catch (err) {
    return { success: false, message: `OpenAI connectivity error: ${err}` };
  }
}

export async function generateWithOpenAiImage(
  config: ImageGenerationConfig,
  options: ImageGenerationOptions,
): Promise<ImageGenerationResult> {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const request = config.fetch || fetch;
  const model = config.model || DEFAULT_MODEL;
  const size = resolveOpenAiSize(options);
  const { width, height } = parseSizeDims(size);

  if (model === 'gpt-image-2' && isOfficialOpenAiBaseUrl(baseUrl)) {
    return generateWithResponsesImageTool({
      baseUrl,
      request,
      apiKey: config.apiKey,
      imageModel: model,
      size,
      options,
      providerId: config.providerId,
    });
  }

  const response = await request(`${baseUrl}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      prompt: options.prompt,
      n: 1,
      size,
      quality: options.quality || 'auto',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI image generation failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const imageData = data.data?.[0];
  const usage = data.usage
    ? {
        providerId: config.providerId,
        modelId: model,
        inputTokens: Number(data.usage.input_tokens) || 0,
        outputTokens: Number(data.usage.output_tokens) || 0,
        totalTokens: Number(data.usage.total_tokens) || 0,
        textInputTokens: Number(data.usage.input_tokens_details?.text_tokens) || 0,
        imageInputTokens: Number(data.usage.input_tokens_details?.image_tokens) || 0,
      }
    : undefined;
  if (!imageData) {
    throw new Error('OpenAI returned empty image response');
  }

  if (imageData.b64_json) {
    return {
      base64: imageData.b64_json,
      width,
      height,
      usage,
    };
  }

  if (imageData.url) {
    return {
      url: imageData.url,
      width,
      height,
      usage,
    };
  }

  throw new Error('OpenAI image response missing b64_json and url');
}
