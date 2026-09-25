import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/server/admin-auth';
import {
  applyCourseProblemUpload,
  CourseProblemUploadConflict,
  previewCourseProblemUpload,
} from '@/lib/server/admin-course-problem-upload';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

export const runtime = 'nodejs';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  }
  if (Number(request.headers.get('content-length') ?? 0) > 2_000_000) {
    return NextResponse.json({ error: 'Upload exceeds 2 MB' }, { status: 413 });
  }
  const db = getOptionalPrisma();
  if (!db) return NextResponse.json({ error: '数据库不可用' }, { status: 503 });
  const { id } = await context.params;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, 'utf8') > 2_000_000) {
      return NextResponse.json({ error: 'Upload exceeds 2 MB' }, { status: 413 });
    }
    const body: unknown = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
    }
    const fields = body as Record<string, unknown>;
    if (fields.courseId !== id) {
      return NextResponse.json({ error: 'Course id mismatch' }, { status: 400 });
    }
    const result =
      fields.apply === true
        ? await applyCourseProblemUpload(db, { courseId: id, changes: fields.changes })
        : await previewCourseProblemUpload(db, { courseId: id, changes: fields.changes });
    return NextResponse.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof CourseProblemUploadConflict) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return NextResponse.json(
        { error: 'Invalid upload', details: String(error) },
        { status: 400 },
      );
    }
    console.error('[admin-course-problem-upload] failed', error);
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 });
  }
}
