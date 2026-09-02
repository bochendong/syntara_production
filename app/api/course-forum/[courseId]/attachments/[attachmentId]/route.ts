import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireCourseForumAccess } from '@/features/course-forum/server/course-forum-access';

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'forum-image';
}

function encodedFileName(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDisposition(fileName: string, download: boolean) {
  const safeName = safeFileName(fileName);
  const asciiFallback = safeName.replace(/[^\x20-\x7e]/g, '_');
  return `${download ? 'attachment' : 'inline'}; filename="${asciiFallback}"; filename*=UTF-8''${encodedFileName(safeName)}`;
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
        'Content-Disposition': contentDisposition(attachment.fileName, download),
        'Cache-Control': 'private, max-age=3600',
        ETag: `"${attachment.contentSha}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
