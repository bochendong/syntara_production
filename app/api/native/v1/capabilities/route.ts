import { NextRequest, NextResponse } from 'next/server';

import { nativePlatformApiAuthMode } from '@/lib/server/native-platform-access';
import {
  publicApiRequestId,
  publicApiSuccess,
  requireNativePlatformApi,
} from '@/lib/server/public-api';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId = publicApiRequestId(request);
  const principal = await requireNativePlatformApi(request, requestId);
  if (principal instanceof NextResponse) return principal;
  const available = Boolean(process.env.OPENAI_API_KEY?.trim());
  const authMode = nativePlatformApiAuthMode();

  return publicApiSuccess(requestId, {
    service: 'syntara-native-ai',
    schemaVersion: 1,
    version: 'native.v1',
    available,
    access: {
      mode: authMode,
      bearerRequired: authMode !== 'shared-test',
      providerCredentials: 'server-only',
    },
    models: [
      { id: 'gpt-5.6-sol', label: 'GPT-5.6 Sol', recommended: true },
      { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
      { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
    ],
    capabilities: {
      teachingTurn: available,
      miniLecture: available,
      reviewPlan: available,
      grading: available,
      syllabus: available,
      transcription: available,
      notebookGeneration: false,
    },
    details: {
      teachingTurn: { path: '/api/native/v1/turn', transport: ['json'] },
      miniLecture: {
        path: '/api/native/v1/mini-lectures',
        imageProvider: 'openai-image',
        imageModel: 'gpt-image-2',
        ttsProvider: 'openai-tts',
        ttsModel: 'gpt-4o-mini-tts',
        browserSpeechSynthesis: false,
      },
    },
    dataBoundary: {
      providerKeys: 'server-only',
      localContext: 'request-scoped',
      generatedAssets: 'download-to-app-data',
      generatedMetadata: 'sqlite',
    },
  });
}
