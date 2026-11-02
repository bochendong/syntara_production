import { NextResponse } from 'next/server';
import { APP_VERSION, APP_RELEASE, SYNC_PROTOCOL } from '@/lib/version/app-release';
import { readBuildRevision } from '@/lib/version/source-revision';
export function GET() {
  return NextResponse.json(
    {
      version: APP_VERSION,
      release: APP_RELEASE,
      syncProtocol: SYNC_PROTOCOL,
      revision: readBuildRevision(),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
