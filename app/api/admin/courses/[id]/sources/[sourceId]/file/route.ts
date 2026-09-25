import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { getOptionalPrisma } from '@/lib/server/prisma-safe';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; sourceId: string }> },
) {
  const admin = await requireAdmin();
  if ('response' in admin) return admin.response;

  const prisma = getOptionalPrisma();
  if (!prisma) return NextResponse.json({ error: '数据库不可用' }, { status: 503 });
  const { id, sourceId } = await context.params;
  const source = await prisma.courseSource.findFirst({
    where: { id: sourceId, courseId: id },
    select: { title: true, fileMime: true, fileData: true },
  });
  if (!source?.fileData) return NextResponse.json({ error: '原文件不可用' }, { status: 404 });

  const mime = source.fileMime || 'application/octet-stream';
  const inline =
    mime === 'application/pdf' ||
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/webp' ||
    mime === 'image/gif' ||
    mime === 'text/plain';
  const safeName = source.title.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 160) || 'source';
  const encodedName = encodeURIComponent(source.title.slice(0, 160));
  return new NextResponse(new Uint8Array(source.fileData), {
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:",
    },
  });
}
