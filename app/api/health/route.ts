import { NextResponse } from 'next/server';
import { apiSuccess } from '@/lib/server/api-response';
import {
  getServerWebSearchProviders,
  getServerImageProviders,
  getServerVideoProviders,
  getServerTTSProviders,
} from '@/lib/server/provider-config';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (process.env.SYNTARA_APP_ENV !== 'staging') {
    return apiSuccess({
      status: 'ok',
      version: process.env.npm_package_version || '0.1.0',
      capabilities: {
        webSearch: Object.keys(getServerWebSearchProviders()).length > 0,
        imageGeneration: Object.keys(await getServerImageProviders()).length > 0,
        videoGeneration: Object.keys(await getServerVideoProviders()).length > 0,
        tts: Object.keys(await getServerTTSProviders()).length > 0,
      },
    });
  }
  return NextResponse.json(
    {
      status: 'ok',
      service: 'syntara-native',
      environment: process.env.SYNTARA_APP_ENV || 'legacy',
    },
    { headers: { 'cache-control': 'no-store' } },
  );
}
