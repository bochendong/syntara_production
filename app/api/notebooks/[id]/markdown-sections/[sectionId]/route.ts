import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { findReadableMarkdownSectionDetail } from '@/lib/server/repositories/notebook-repository';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; sectionId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id, sectionId } = await context.params;
    const section = await findReadableMarkdownSectionDetail({
      db: prisma,
      userId: auth.userId,
      notebookId: id,
      sectionId,
    });
    if (!section) {
      return NextResponse.json({ error: 'Markdown section not found' }, { status: 404 });
    }
    return NextResponse.json({ section });
  });
}
