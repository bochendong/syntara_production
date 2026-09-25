import { NextRequest, NextResponse } from 'next/server';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { extractAssignmentFile } from '@/lib/server/course-assignment-review';

export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = { params: Promise<{ id: string; assignmentId: string }> };

async function ownerAccess(courseId: string, userId: string) {
  return (await findCourseAccessRole(prisma, userId, courseId)) === 'owner';
}

export async function GET(request: NextRequest, context: Context) {
  return safeRoute(async () => {
    const auth = await requireTeacher();
    if ('response' in auth) return auth.response;
    const { id: courseId, assignmentId } = await context.params;
    if (!(await ownerAccess(courseId, auth.userId))) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (new URL(request.url).searchParams.get('download') !== 'exemplar') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const assignment = await prisma.courseAssignment.findFirst({
      where: { id: assignmentId, courseId },
      select: { exemplarFileName: true, exemplarMimeType: true, exemplarFileData: true },
    });
    if (
      !assignment?.exemplarFileData ||
      !assignment.exemplarMimeType ||
      !assignment.exemplarFileName
    ) {
      return NextResponse.json({ error: '范本不存在。' }, { status: 404 });
    }
    return new NextResponse(new Uint8Array(assignment.exemplarFileData), {
      headers: {
        'Content-Type': assignment.exemplarMimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(assignment.exemplarFileName)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
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
    if (!title || title.length > 200 || !instructions || instructions.length > 20_000) {
      return NextResponse.json({ error: '请填写标题和注意事项。' }, { status: 400 });
    }
    const file = form.get('file');
    const removeExemplar = form.get('removeExemplar') === 'true';
    let extracted: Awaited<ReturnType<typeof extractAssignmentFile>> | null = null;
    if (file instanceof File && file.size > 0) {
      try {
        extracted = await extractAssignmentFile(file);
      } catch (error) {
        return NextResponse.json(
          { error: error instanceof Error ? error.message : '范本读取失败。' },
          { status: 400 },
        );
      }
    }
    await prisma.courseAssignment.update({
      where: { id: assignmentId },
      data: {
        title,
        instructions,
        published: form.get('published') === 'true',
        version: { increment: 1 },
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
