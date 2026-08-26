import { NextResponse } from 'next/server';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'forum-image';
}

export async function GET(
  request: Request,
  context: { params: Promise<{ attachmentId: string }> },
) {
  return safeRoute(async () => {
    const { attachmentId } = await context.params;
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const attachment = await prisma.courseForumAttachment.findFirst({
      where: {
        id: attachmentId,
        OR: [
          { post: { communityId: null } },
          { post: { community: { visibility: 'public' } } },
          { answer: { post: { communityId: null } } },
          { answer: { post: { community: { visibility: 'public' } } } },
        ],
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
