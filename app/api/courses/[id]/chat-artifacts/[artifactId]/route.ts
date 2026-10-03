import { NextResponse } from 'next/server';

import { loadChatArtifactForUser } from '@/features/chat/server/artifacts/store';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';

export const runtime = 'nodejs';

function contentDisposition(type: 'inline' | 'attachment', fileName: string): string {
  const asciiFallback =
    fileName
      .replace(/[^\x20-\x7e]/g, '_')
      .replace(/["\\;]/g, '_')
      .trim() || 'download';
  const encoded = encodeURIComponent(fileName).replace(
    /['()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${type}; filename="${asciiFallback}"; filename*=UTF-8''${encoded}`;
}

/** Download or preview a file the course chat assistant generated. */
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; artifactId: string }> },
) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id: courseId, artifactId } = await context.params;
    const loaded = await loadChatArtifactForUser({
      db: prisma,
      courseId,
      artifactId,
      userId: auth.userId,
    });
    if (!loaded) {
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    const download = new URL(request.url).searchParams.get('download') === '1';
    const { artifact, data } = loaded;
    return new Response(Uint8Array.from(data), {
      headers: {
        'content-type': artifact.mimeType,
        'content-length': String(data.byteLength),
        'content-disposition': contentDisposition(
          download || artifact.fileKind === 'docx' ? 'attachment' : 'inline',
          artifact.fileName,
        ),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
      },
    });
  });
}
