import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { parseDownloadRange, readDesktopRelease } from '@/lib/server/desktop-release';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function download(request: Request, head = false) {
  const release = await readDesktopRelease();
  if (!release) {
    return Response.json({ error: '安装包暂未提供，请稍后再试。' }, { status: 404 });
  }
  const { info, filePath } = release;
  const etag = `"${info.sha256}"`;
  const headers = new Headers({
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${info.fileName}"`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Last-Modified': new Date(info.builtAt).toUTCString(),
    ETag: etag,
  });
  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }
  const requestedRange = request.headers.get('range');
  const ifRange = request.headers.get('if-range');
  const useRange = requestedRange && (!ifRange || ifRange === etag);
  const range = useRange ? parseDownloadRange(requestedRange, info.size) : null;
  if (useRange && !range) {
    headers.set('Content-Range', `bytes */${info.size}`);
    return new Response(null, { status: 416, headers });
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? info.size - 1;
  headers.set('Content-Length', String(end - start + 1));
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${info.size}`);
  const body = head
    ? null
    : (Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>);
  return new Response(body, { status: range ? 206 : 200, headers });
}

export function GET(request: Request) {
  return download(request);
}

export function HEAD(request: Request) {
  return download(request, true);
}
