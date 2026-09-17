import { apiSuccess } from '@/lib/server/api-response';
import {
  getServerWebSearchProviders,
  getServerImageProviders,
  getServerVideoProviders,
  getServerTTSProviders,
} from '@/lib/server/provider-config';

const version = process.env.npm_package_version || '0.1.0';

export async function GET() {
  return apiSuccess({
    status: 'ok',
    version,
    capabilities: {
      webSearch: Object.keys(getServerWebSearchProviders()).length > 0,
      imageGeneration: Object.keys(await getServerImageProviders()).length > 0,
      videoGeneration: Object.keys(await getServerVideoProviders()).length > 0,
      tts: Object.keys(await getServerTTSProviders()).length > 0,
    },
  });
}
