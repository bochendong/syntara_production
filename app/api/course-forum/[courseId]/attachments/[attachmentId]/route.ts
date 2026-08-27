import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireCourseForumAccess } from '@/features/course-forum/server/course-forum-access';

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'forum-image';
}

export async function GET(
  request: Request,
  context: { params: Promise<{ courseId: string; attachmentId: string }> },
) {
  return safeRoute(async () => {
    const { courseId, attachmentId } = await context.params;
    const access = await requireCourseForumAccess(courseId);
    if (!access.ok) return access.response;
    const attachment = await prisma.courseForumAttachment.findFirst({
      where: {
        id: attachmentId,
        OR: [{ post: { courseId } }, { answer: { post: { courseId } } }],
      },
      select: { data: true, fileName: true, mimeType: true, contentSha: true },
    });
    if (!attachment) return NextResponse.json({ error: '图片不存在' }, { status: 404 });
    const download = new URL(request.url).searchParams.get('download') === '1';
    return new Response(attachment.data, {
      headers: {
        'Content-Type': attachment.mimeType,
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeFileName(attachment.fileName)}"`,
        'Cache-Control': 'private, max-age=3600',
        ETag: `"${attachment.contentSha}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
