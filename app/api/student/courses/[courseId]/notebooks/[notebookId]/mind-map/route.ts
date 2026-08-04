import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { canReadCourseNotebook } from '@/lib/server/repositories/course-enrollment-repository';

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string; notebookId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { courseId, notebookId } = await context.params;
    if (!(await canReadCourseNotebook(prisma, auth.userId, courseId, notebookId))) {
      return NextResponse.json({ error: '思维导图不存在或尚未开放' }, { status: 404 });
    }
    const notebook = await prisma.notebook.findFirst({
      where: { id: notebookId, courseId, removedAt: null },
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
