import { NextResponse, type NextRequest } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import {
  archiveAdminCourseSource,
  CourseSourceArchiveConflict,
} from '@/lib/server/admin-course-source-archive';

export const runtime = 'nodejs';
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  if (request.headers.get('origin') !== buildRequestOrigin(request))
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const data = await request.formData();
  const file = data.get('file');
  const mode = data.get('mode') ?? 'preview';
  if (
    !(file instanceof File) ||
    !file.size ||
    file.size > 10_000_000 ||
    !file.name.trim() ||
    file.name.length > 240 ||
    /[\x00-\x1f\x7f/\\]/.test(file.name) ||
    !['preview', 'commit'].includes(String(mode)) ||
    !/\.(pdf|zip)$/i.test(file.name)
  )
    return NextResponse.json(
      { error: 'A PDF or ZIP of at most 10 MB is required.' },
      { status: 400 },
    );
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdf = file.name.toLowerCase().endsWith('.pdf');
  if (
    (pdf && Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') ||
    (!pdf && (bytes[0] !== 0x50 || bytes[1] !== 0x4b))
  )
    return NextResponse.json({ error: 'File signature mismatch.' }, { status: 400 });
  const db = getOptionalPrisma();
  if (!db) return NextResponse.json({ error: 'Storage unavailable.' }, { status: 503 });
  const { id } = await context.params;
  try {
    const result = await archiveAdminCourseSource(db, {
      courseId: id,
      actorId: admin.identity.userId,
      name: file.name,
      mime: pdf ? 'application/pdf' : 'application/zip',
      bytes,
      apply: mode === 'commit',
      expectedHash: String(data.get('expectedHash') ?? ''),
    });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof CourseSourceArchiveConflict)
      return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
