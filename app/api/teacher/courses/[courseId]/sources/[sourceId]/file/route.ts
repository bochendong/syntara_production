import { NextResponse } from 'next/server';

import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';

export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string; sourceId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, sourceId } = await context.params;
    const source = await prisma.courseSource.findFirst({
      where: { id: sourceId, courseId, ownerId: teacher.userId },
      select: {
        title: true,
        fileMime: true,
        fileData: true,
        extractedText: true,
      },
    });
    if (!source) return NextResponse.json({ error: 'Source file not found' }, { status: 404 });
    const data =
      source.fileData || (source.extractedText ? Buffer.from(source.extractedText, 'utf8') : null);
    if (!data) return NextResponse.json({ error: 'Source file not found' }, { status: 404 });
    return new Response(data, {
      headers: {
        'content-type':
          source.fileData && source.fileMime ? source.fileMime : 'text/markdown; charset=utf-8',
        'content-length': String(data.byteLength),
        'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(source.title)}`,
        'cache-control': 'private, no-store',
      },
    });
  });
}
