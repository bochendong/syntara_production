import { NextResponse } from 'next/server';

import { parseDocxBuffer } from '@/lib/docx/parse-docx-buffer';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  COURSE_SOURCE_MAX_FILE_BYTES,
  courseSourceFileKind,
  courseSourceFileValidationError,
} from '@/lib/uploads/course-source-policy';

export const runtime = 'nodejs';
export const maxDuration = 120;

export async function POST(request: Request) {
  return safeRoute(async () => {
    const formData = await request.formData();
    const file = formData.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '请选择 DOCX 文件。' }, { status: 400 });
    }
    const validationError = courseSourceFileValidationError(file);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: file.size <= 0 ? 400 : file.size > COURSE_SOURCE_MAX_FILE_BYTES ? 413 : 415 },
      );
    }
    if (courseSourceFileKind(file) !== 'docx') {
      return NextResponse.json({ error: '这个解析接口只支持 DOCX 文件。' }, { status: 415 });
    }
    const parsed = await parseDocxBuffer({
      buffer: Buffer.from(await file.arrayBuffer()),
      fileName: file.name,
      fileSize: file.size,
    });
    return NextResponse.json({ success: true, text: parsed.text, parser: 'docx-openxml' });
  });
}
