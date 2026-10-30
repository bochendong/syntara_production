import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  COURSE_PROBLEM_IMPORT_DOCUMENTS,
  COURSE_PROBLEM_IMPORT_GUIDE,
} from '@/lib/course-problem-import-guide';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const documents = new Set(COURSE_PROBLEM_IMPORT_DOCUMENTS);

/** Public protocol documentation only. Course data and credentials are never served here. */
export async function GET(_request: Request, context: { params: Promise<{ document: string }> }) {
  const { document } = await context.params;
  if (!documents.has(document)) return new Response('Not found', { status: 404 });
  const content = await readFile(path.join(process.cwd(), 'docs', 'api', document), 'utf8');
  const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
  if (document === 'ai-course-problem-upload.md' && sha256 !== COURSE_PROBLEM_IMPORT_GUIDE.sha256) {
    return new Response('The reviewed import guide is unavailable.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  return new Response(content, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'no-store',
      ETag: `"sha256-${sha256}"`,
      'X-Content-SHA256': sha256,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
