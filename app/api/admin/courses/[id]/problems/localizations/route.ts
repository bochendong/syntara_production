import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';
import {
  courseProblemLocalizationsSchema,
  ProblemLocalizationConflict,
  readCourseProblemLocalizations,
  updateCourseProblemLocalizations,
} from '@/lib/server/course-problem-localizations';

export const runtime = 'nodejs';
const noStore = { headers: { 'Cache-Control': 'private, no-store' } };
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  const db = getOptionalPrisma();
  if (!db) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const { id } = await context.params;
  return NextResponse.json(await readCourseProblemLocalizations(db, id), noStore);
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;
  if (request.headers.get('origin') !== new URL(request.url).origin)
    return NextResponse.json({ error: 'Invalid origin' }, { status: 403 });
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > 2000000)
    return NextResponse.json({ error: 'Payload too large' }, { status: 413 });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = courseProblemLocalizationsSchema.safeParse(raw);
  if (!parsed.success)
    return NextResponse.json(
      { error: 'Invalid localization data', details: parsed.error.flatten() },
      { status: 400 },
    );
  const db = getOptionalPrisma();
  if (!db) return NextResponse.json({ error: 'Storage unavailable' }, { status: 503 });
  const { id } = await context.params;
  try {
    return NextResponse.json(await updateCourseProblemLocalizations(db, id, parsed.data), noStore);
  } catch (error) {
    if (error instanceof ProblemLocalizationConflict)
      return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}
