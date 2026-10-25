import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { resolveASRApiKey } from '@/lib/server/provider-config';
import { proxyFetch } from '@/lib/server/proxy-fetch';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';
import { getSystemLLMRuntimeConfig } from '@/lib/server/system-llm-config';

export const runtime = 'nodejs';

/** gpt-live-transcribe 边说边出字；需要时用环境变量换成别的转写模型。 */
const REALTIME_TRANSCRIBE_MODEL =
  process.env.SYNTARA_REALTIME_TRANSCRIBE_MODEL?.trim() || 'gpt-live-transcribe';
/** 临时密钥只用来建连接，一分钟内用不上就作废。 */
const CLIENT_SECRET_TTL_SECONDS = 60;

const requestSchema = z.object({
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2}$/)
    .optional(),
});

/**
 * 给聊天输入框的语音输入发一个 OpenAI Realtime 转写会话的临时密钥。
 * 客户端拿它直接用 WebRTC 连 OpenAI，音频不经过我们的服务器；平台密钥不下发。
 */
export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Invalid realtime transcription request.',
      parsed.error.flatten(),
    );
  }

  const systemOpenAI = await getSystemLLMRuntimeConfig();
  const apiKey = systemOpenAI.apiKey || (await resolveASRApiKey('openai-whisper'));
  if (!apiKey) {
    return publicApiError(requestId, 503, 'upstream_error', '平台还没有配置语音转写。');
  }
  // Realtime 只有 OpenAI 官方接口支持；自定义的转发地址不一定能转 WebRTC。
  const apiBase = 'https://api.openai.com/v1';

  try {
    const response = await proxyFetch(`${apiBase}/realtime/client_secrets`, {
      method: 'POST',
      signal: AbortSignal.timeout(15000),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Safety-Identifier': principal.userId,
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: CLIENT_SECRET_TTL_SECONDS },
        session: {
          type: 'transcription',
          audio: {
            input: {
              format: { type: 'audio/pcm', rate: 24000 },
              noise_reduction: { type: 'near_field' },
              transcription: {
                model: REALTIME_TRANSCRIBE_MODEL,
                ...(parsed.data.language
                  ? REALTIME_TRANSCRIBE_MODEL === 'gpt-live-transcribe'
                    ? { languages: [parsed.data.language] }
                    : { language: parsed.data.language }
                  : {}),
              },
              // gpt-live-transcribe 不支持服务端断句，客户端停下时自己 commit。
              turn_detection: null,
            },
          },
        },
      }),
    });
    const body = (await response.json().catch(() => null)) as {
      value?: string;
      expires_at?: number;
      error?: { message?: string };
    } | null;
    if (!response.ok || !body?.value) {
      return publicApiError(
        requestId,
        502,
        'upstream_error',
        body?.error?.message || `Realtime session failed (${response.status}).`,
      );
    }
    return publicApiSuccess(requestId, {
      clientSecret: body.value,
      expiresAt: body.expires_at ?? Math.floor(Date.now() / 1000) + CLIENT_SECRET_TTL_SECONDS,
      model: REALTIME_TRANSCRIBE_MODEL,
      callsUrl: `${apiBase}/realtime/calls`,
    });
  } catch (error) {
    return publicApiError(
      requestId,
      502,
      'upstream_error',
      error instanceof Error ? error.message : 'Realtime session failed.',
    );
  }
}
