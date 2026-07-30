import { Buffer } from 'node:buffer';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

import { transcribeAudio } from '@/lib/audio/asr-providers';
import {
  publicApiError,
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';
import { resolveASRApiKey, resolveASRBaseUrl } from '@/lib/server/provider-config';
import { withRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';
export const maxDuration = 120;

const requestSchema = z.object({
  dataBase64: z.string().min(1).max(80_000_000),
  mimeType: z.string().trim().min(1).max(120).default('audio/webm'),
  fileName: z.string().trim().min(1).max(300).default('recording.webm'),
  language: z.string().trim().max(40).default('auto'),
  providerId: z.never().optional(),
  apiKey: z.never().optional(),
  baseUrl: z.never().optional(),
});

export async function POST(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const parsed = requestSchema.safeParse(await request.json());
  if (!parsed.success) {
    return publicApiError(
      requestId,
      400,
      'invalid_request',
      'Invalid native transcription request.',
      parsed.error.flatten(),
    );
  }
  try {
    const audio = Buffer.from(parsed.data.dataBase64, 'base64');
    if (!audio.length || audio.length > 25 * 1024 * 1024) {
      return publicApiError(
        requestId,
        400,
        'invalid_request',
        'Audio must decode to a non-empty file no larger than 25 MB.',
      );
    }
    const providerId = 'openai-whisper' as const;
    const result = await withRequestContext(
      {
        userId: principal.userId,
        route: '/api/native/v1/transcriptions',
        operationCode: 'native_transcription',
        chargeReason: '原生端 OpenAI 语音转写',
      },
      () =>
        transcribeAudio(
          {
            providerId,
            language: parsed.data.language,
            apiKey: resolveASRApiKey(providerId) || process.env.OPENAI_API_KEY?.trim(),
            baseUrl: resolveASRBaseUrl(providerId),
          },
          audio,
        ),
    );
    return publicApiSuccess(requestId, {
      text: result.text,
      provider: 'openai',
      model: 'gpt-4o-mini-transcribe',
      mimeType: parsed.data.mimeType,
      fileName: parsed.data.fileName,
    });
  } catch (error) {
    return publicApiError(
      requestId,
      500,
      'generation_failed',
      error instanceof Error ? error.message : 'Native transcription failed.',
    );
  }
}
