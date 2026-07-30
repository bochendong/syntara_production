import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import {
  decodeMarkdownSectionPageCursor,
  listReadableMarkdownSectionPage,
  MARKDOWN_SECTION_LIST_DEFAULT_LIMIT,
  MARKDOWN_SECTION_LIST_MAX_LIMIT,
} from '@/lib/server/repositories/notebook-repository';

const querySchema = z.object({
  cursor: z.string().trim().min(1).max(2048).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(MARKDOWN_SECTION_LIST_MAX_LIMIT)
    .default(MARKDOWN_SECTION_LIST_DEFAULT_LIMIT),
});

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({
      cursor: url.searchParams.get('cursor') || undefined,
      limit: url.searchParams.get('limit') || undefined,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid markdown section page query', details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const cursor = parsed.data.cursor ? decodeMarkdownSectionPageCursor(parsed.data.cursor) : null;
    if (parsed.data.cursor && !cursor) {
      return NextResponse.json({ error: 'Invalid markdown section cursor' }, { status: 400 });
    }

    const page = await listReadableMarkdownSectionPage({
      db: prisma,
      userId: auth.userId,
      notebookId: id,
      cursor,
      limit: parsed.data.limit,
    });
    if (!page) {
      return NextResponse.json({ error: 'Notebook not found' }, { status: 404 });
    }
    return NextResponse.json({
      sections: page.sections,
      page: {
        limit: parsed.data.limit,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
      },
    });
  });
}
