import { NextResponse } from 'next/server';

import { hasTeacherCourseAccess } from '@/lib/server/external-course-access';
import { safeRoute } from '@/lib/server/json-error-response';
import {
  convertOfficeSourceToPdf,
  courseSourcePreviewPdfPath,
  persistCourseSourcePreviewPdf,
} from '@/lib/server/office-source-pdf';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { courseSourceFileKind } from '@/lib/uploads/course-source-policy';

export const runtime = 'nodejs';
export const maxDuration = 300;

function pdfResponse(data: Buffer, sourceTitle: string) {
  const previewName = sourceTitle.replace(/\.(docx|pptx)$/i, '') || 'document';
  return new Response(Uint8Array.from(data), {
    headers: {
      'content-type': 'application/pdf',
      'content-length': String(data.byteLength),
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(`${previewName}.pdf`)}`,
      'cache-control': 'private, no-store',
    },
  });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string; sourceId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher({ refreshSpeedupAccess: false });
    if ('response' in teacher) return teacher.response;
    const { courseId, sourceId } = await context.params;
    if (!(await hasTeacherCourseAccess(prisma, teacher.userId, courseId))) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    const source = await prisma.courseSource.findFirst({
      where: { id: sourceId, courseId, ownerId: teacher.userId, removedAt: null },
      select: {
        title: true,
        fileMime: true,
        fileData: true,
        ingestStatus: true,
        errorReason: true,
      },
    });
    if (!source?.fileData) {
      return NextResponse.json({ error: 'Source file not found' }, { status: 404 });
    }
    const kind = courseSourceFileKind({
      name: source.title,
      type: source.fileMime || 'application/octet-stream',
    });
    if (kind === 'pdf') return pdfResponse(Buffer.from(source.fileData), source.title);
    if (kind !== 'docx' && kind !== 'pptx') {
      return NextResponse.json({ error: '该文件不需要 PDF 预览。' }, { status: 415 });
    }

    const path = courseSourcePreviewPdfPath(sourceId);
    const cached = await prisma.asset.findUnique({
      where: { path },
      select: { data: true },
    });
    if (cached?.data) return pdfResponse(Buffer.from(cached.data), source.title);

    // Sources uploaded before the PDF-preview rollout do not have a derived
    // asset. Build it lazily once so existing teacher files become previewable
    // without re-uploading or rerunning notebook generation.
    try {
      const converted = await convertOfficeSourceToPdf({
        title: source.title,
        mimeType: source.fileMime || 'application/octet-stream',
        data: Buffer.from(source.fileData),
      });
      await persistCourseSourcePreviewPdf(sourceId, converted.pdf);
      return pdfResponse(converted.pdf, source.title);
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Office 文件转换失败';
      console.error('[teacher-source-preview] Office PDF conversion failed', {
        courseId,
        sourceId,
        title: source.title,
        mimeType: source.fileMime,
        error: detail,
        stack: error instanceof Error ? error.stack : undefined,
      });
      return NextResponse.json(
        {
          error:
            source.ingestStatus === 'error' && source.errorReason
              ? `${source.errorReason}；PDF 预览转换失败：${detail}`
              : `PDF 预览转换失败：${detail}`,
        },
        { status: 422 },
      );
    }
  });
}
