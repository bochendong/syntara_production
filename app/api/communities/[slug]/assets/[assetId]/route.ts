import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'community-asset';
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string; assetId: string }> },
) {
  return safeRoute(async () => {
    const { slug, assetId } = await context.params;
    const asset = await prisma.communityAsset.findFirst({
      where: { id: assetId, community: { slug } },
      select: {
        data: true,
        fileName: true,
        mimeType: true,
        contentSha: true,
        community: {
          select: {
            visibility: true,
            ownerId: true,
            members: { select: { userId: true } },
          },
        },
      },
    });
    if (!asset) return NextResponse.json({ error: '图片不存在' }, { status: 404 });

    if (asset.community.visibility === 'private') {
      const auth = await requireUserId({ ensureFallbackUser: false });
      if (auth.response) return auth.response;
      const canView =
        asset.community.ownerId === auth.userId ||
        asset.community.members.some((member) => member.userId === auth.userId);
      if (!canView) return NextResponse.json({ error: '无权查看图片' }, { status: 403 });
    }

    const download = new URL(request.url).searchParams.get('download') === '1';
    return new Response(asset.data, {
      headers: {
        'Content-Type': asset.mimeType,
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeFileName(asset.fileName)}"`,
        'Cache-Control': 'private, max-age=3600',
        ETag: `"${asset.contentSha}"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  });
}
