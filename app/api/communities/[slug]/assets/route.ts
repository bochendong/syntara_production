import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { requireCommunityManager } from '@/lib/server/community-admin';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const dynamic = 'force-dynamic';

const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function safeFileName(value: string) {
  return value.replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'community-banner.jpg';
}

function imageMimeType(file: File) {
  const type = file.type.toLowerCase();
  if (ALLOWED_IMAGE_TYPES.has(type)) return type;
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.png')) return 'image/png';
  if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerName.endsWith('.webp')) return 'image/webp';
  return '';
}

function assetKind(value: FormDataEntryValue | null) {
  return value === 'avatar' ? 'avatar' : 'banner';
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if (auth.response) return auth.response;

    const { slug } = await context.params;
    const access = await requireCommunityManager(slug, auth.userId);
    if (!access.ok) return access.response;

    const formData = await request.formData();
    const kind = assetKind(formData.get('kind'));
    const image = formData.get('image');
    if (!(image instanceof File) || image.size <= 0) {
      return NextResponse.json({ error: '请选择图片' }, { status: 400 });
    }
    const mimeType = imageMimeType(image);
    if (!mimeType) {
      return NextResponse.json({ error: '只支持 JPG、PNG 或 WebP 图片' }, { status: 400 });
    }
    if (image.size > MAX_IMAGE_BYTES) {
      return NextResponse.json({ error: '封面图片不能超过 6 MB' }, { status: 400 });
    }

    const data = Buffer.from(await image.arrayBuffer());
    const asset = await prisma.communityAsset.create({
      data: {
        communityId: access.community.id,
        uploaderId: auth.userId,
        kind,
        fileName: safeFileName(image.name),
        mimeType,
        byteSize: data.byteLength,
        contentSha: createHash('sha256').update(data).digest('hex'),
        data,
      },
      select: { id: true },
    });

    const assetUrl = `/api/communities/${encodeURIComponent(slug)}/assets/${encodeURIComponent(asset.id)}`;
    await prisma.community.update({
      where: { id: access.community.id },
      data: kind === 'avatar' ? { avatarUrl: assetUrl } : { bannerUrl: assetUrl },
      select: { id: true },
    });

    return NextResponse.json(
      kind === 'avatar' ? { avatarUrl: assetUrl } : { bannerUrl: assetUrl },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
