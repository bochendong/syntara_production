import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import {
  repairCourseMultipart,
  MultipartRepairConflict,
} from '@/lib/server/course-problem-multipart';
export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  if (request.headers.get('origin') !== buildRequestOrigin(request))
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const body = await request.text();
  if (Buffer.byteLength(body, 'utf8') > 2000000)
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  const db = getOptionalPrisma();
  if (!db) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  try {
    const { id } = await context.params;
    return NextResponse.json(await repairCourseMultipart(db, id, JSON.parse(body)), {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  } catch (error) {
    if (error instanceof MultipartRepairConflict)
      return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return NextResponse.json(
        { error: 'Invalid multipart repair', details: String(error) },
        { status: 400 },
      );
    throw error;
  }
}
