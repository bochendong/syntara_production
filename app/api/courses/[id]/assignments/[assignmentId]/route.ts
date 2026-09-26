import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { extractAssignmentFile } from '@/lib/server/course-assignment-review';

export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = { params: Promise<{ id: string; assignmentId: string }> };

function assignmentFileResponse(
  file: {
    name: string | null;
    mimeType: string | null;
    data: Uint8Array | null;
    text: string | null;
  },
  preview: boolean,
) {
  if (!file.data || !file.mimeType || !file.name) return null;
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, no-store',
    'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  };
  if (preview && file.mimeType !== 'application/pdf' && !file.mimeType.startsWith('image/')) {
    return new NextResponse(file.text ?? '', {
      headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }
  return new NextResponse(new Uint8Array(file.data), {
    headers: { ...headers, 'Content-Type': file.mimeType },
  });
}

async function ownerAccess(courseId: string, userId: string) {
  return (await findCourseAccessRole(prisma, userId, courseId)) === 'owner';
}

export async function GET(request: NextRequest, context: Context) {
  return safeRoute(async () => {
    const search = new URL(request.url).searchParams;
    const fileKind = search.get('preview') ?? search.get('download');
    const preview = search.has('preview');
    if (fileKind === 'school') {
      const auth = await requireUserId({ ensureFallbackUser: false });
      if ('response' in auth) return auth.response;
      const { id: courseId, assignmentId } = await context.params;
      const role = await findCourseAccessRole(prisma, auth.userId, courseId);
      if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      const assignment = await prisma.courseAssignment.findFirst({
        where: { id: assignmentId, courseId, ...(role === 'enrolled' ? { published: true } : {}) },
        select: {
          schoolFileName: true,
          schoolMimeType: true,
          schoolFileData: true,
          schoolFileText: true,
        },
      });
      const response = assignmentFileResponse(
        {
          name: assignment?.schoolFileName ?? null,
          mimeType: assignment?.schoolMimeType ?? null,
          data: assignment?.schoolFileData ?? null,
          text: assignment?.schoolFileText ?? null,
        },
        preview,
      );
      return response ?? NextResponse.json({ error: '学校作业原件不存在。' }, { status: 404 });
    }
    if (fileKind !== 'exemplar') return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const auth = await requireTeacher();
    if ('response' in auth) return auth.response;
    const { id: courseId, assignmentId } = await context.params;
    if (!(await ownerAccess(courseId, auth.userId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const assignment = await prisma.courseAssignment.findFirst({
      where: { id: assignmentId, courseId },
      select: {
        exemplarFileName: true,
        exemplarMimeType: true,
        exemplarFileData: true,
        exemplarText: true,
      },
    });
    const response = assignmentFileResponse(
      {
        name: assignment?.exemplarFileName ?? null,
        mimeType: assignment?.exemplarMimeType ?? null,
        data: assignment?.exemplarFileData ?? null,
        text: assignment?.exemplarText ?? null,
      },
      preview,
    );
    return response ?? NextResponse.json({ error: '范本不存在。' }, { status: 404 });
  });
}

export async function PATCH(request: NextRequest, context: Context) {
  return safeRoute(async () => {
    const auth = await requireTeacher();
    if ('response' in auth) return auth.response;
    const { id: courseId, assignmentId } = await context.params;
    if (!(await ownerAccess(courseId, auth.userId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const existing = await prisma.courseAssignment.findFirst({
      where: { id: assignmentId, courseId },
      select: { id: true },
    });
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const form = await request.formData();
    const title = String(form.get('title') ?? '').trim();
    const instructions = String(form.get('instructions') ?? '').trim();
    const schoolTaskText = String(form.get('schoolTaskText') ?? '').trim();
    if (
      !title ||
      title.length > 200 ||
      !instructions ||
      instructions.length > 20_000 ||
      schoolTaskText.length > 20_000
    ) {
      return NextResponse.json({ error: '请填写标题和注意事项。' }, { status: 400 });
    }
    const file = form.get('file');
    const schoolFile = form.get('schoolFile');
    const removeExemplar = form.get('removeExemplar') === 'true';
    const removeSchoolFile = form.get('removeSchoolFile') === 'true';
    let extracted: Awaited<ReturnType<typeof extractAssignmentFile>> | null = null;
    let schoolExtracted: Awaited<ReturnType<typeof extractAssignmentFile>> | null = null;
    if (file instanceof File && file.size > 0) {
      try {
        extracted = await extractAssignmentFile(file, { previewText: true });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : '范本读取失败。' },
          { status: 400 },
        );
      }
    }
    if (schoolFile instanceof File && schoolFile.size > 0) {
      try {
        schoolExtracted = await extractAssignmentFile(schoolFile, { previewText: true });
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : '学校作业原件读取失败。' },
          { status: 400 },
        );
      }
    }
    await prisma.courseAssignment.update({
      where: { id: assignmentId },
      data: {
        title,
        instructions,
        schoolTaskText: schoolTaskText || null,
        published: form.get('published') === 'true',
        version: { increment: 1 },
        ...(schoolExtracted
          ? {
              schoolFileName: schoolExtracted.fileName,
              schoolMimeType: schoolExtracted.mimeType,
              schoolFileData: Uint8Array.from(schoolExtracted.data),
              schoolFileText: schoolExtracted.text,
            }
          : removeSchoolFile
            ? {
                schoolFileName: null,
                schoolMimeType: null,
                schoolFileData: null,
                schoolFileText: null,
              }
            : {}),
        ...(extracted
          ? {
              exemplarFileName: extracted.fileName,
              exemplarMimeType: extracted.mimeType,
              exemplarFileData: Uint8Array.from(extracted.data),
              exemplarText: extracted.text,
            }
          : removeExemplar
            ? {
                exemplarFileName: null,
                exemplarMimeType: null,
                exemplarFileData: null,
                exemplarText: null,
              }
            : {}),
      },
    });
    return NextResponse.json({ ok: true });
  });
}
