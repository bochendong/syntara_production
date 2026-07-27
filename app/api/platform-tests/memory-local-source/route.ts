import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { getCsc148SourceUploadCase } from '@/features/qa/test-center/memory/csc148-source-upload-cases';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const caseId = new URL(request.url).searchParams.get('caseId')?.trim() || '';
  const sourceCase = getCsc148SourceUploadCase(caseId);
  if (!sourceCase) {
    return NextResponse.json({ error: '未知的 CSC148 queue 文件测试。' }, { status: 404 });
  }

  const queueRoot = path.resolve(process.cwd(), 'queue', 'CSC148');
  const sourcePath = path.resolve(queueRoot, sourceCase.filename);
  if (!sourcePath.startsWith(`${queueRoot}${path.sep}`)) {
    return NextResponse.json({ error: '非法的 queue 文件路径。' }, { status: 400 });
  }

  try {
    const [content, fileStat] = await Promise.all([readFile(sourcePath, 'utf8'), stat(sourcePath)]);
    return NextResponse.json(
      {
        sourceId: sourceCase.id,
        filename: sourceCase.filename,
        queuePath: `queue/CSC148/${sourceCase.filename}`,
        content,
        size: fileStat.size,
        modifiedAt: fileStat.mtimeMs,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: '无法读取本地 CSC148 queue 文件。',
        detail: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
