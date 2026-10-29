import { NextResponse } from 'next/server';
import { APP_VERSION, APP_RELEASE, SYNC_PROTOCOL } from '@/lib/version/app-release';
export function GET() {
  return NextResponse.json(
    {
      version: APP_VERSION,
      release: APP_RELEASE,
      syncProtocol: SYNC_PROTOCOL,
      revision: process.env.RAILWAY_GIT_COMMIT_SHA ?? null,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
