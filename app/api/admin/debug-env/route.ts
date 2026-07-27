import { NextResponse } from 'next/server';
import { getAdminLoginDebugInfo } from '@/lib/server/admin-auth';

export async function GET() {
  return NextResponse.json({
    success: true,
    ...getAdminLoginDebugInfo(),
  });
}
