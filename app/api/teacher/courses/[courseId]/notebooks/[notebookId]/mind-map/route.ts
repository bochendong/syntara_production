import { NextResponse } from 'next/server';

import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string; notebookId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, notebookId } = await context.params;
    const notebook = await prisma.notebook.findFirst({
      where: { id: notebookId, courseId, ownerId: teacher.userId },
      select: { mindMapData: true, mindMapMime: true },
    });
    if (!notebook?.mindMapData) {
      return NextResponse.json({ error: '思维导图不存在' }, { status: 404 });
    }
    return new Response(notebook.mindMapData, {
      headers: {
        'content-type': notebook.mindMapMime || 'image/png',
        'content-length': String(notebook.mindMapData.byteLength),
        'cache-control': 'private, no-store',
      },
    });
  });
}
