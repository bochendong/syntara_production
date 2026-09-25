import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { extractAssignmentFile, reviewAssignment } from '@/lib/server/course-assignment-review';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { withRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = { params: Promise<{ id: string; assignmentId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId, assignmentId } = await context.params;
    const role = await findCourseAccessRole(prisma, auth.userId, courseId);
    if (!role) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const assignment = await prisma.courseAssignment.findFirst({
      where: { id: assignmentId, courseId, ...(role === 'enrolled' ? { published: true } : {}) },
      select: { id: true },
    });
    if (!assignment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const submissions = await prisma.courseAssignmentSubmission.findMany({
      where: { assignmentId, ...(role === 'enrolled' ? { studentId: auth.userId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        fileName: true,
        reviewStatus: true,
        reviewError: true,
        feedbackJson: true,
        sourceVersion: true,
        createdAt: true,
        ...(role === 'owner' ? { student: { select: { name: true, email: true } } } : {}),
      },
    });
    return NextResponse.json(
      { submissions },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}

export async function POST(request: NextRequest, context: Context) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    if ('previewedByAdmin' in auth && auth.previewedByAdmin) {
      return NextResponse.json({ error: '管理员预览为只读模式。' }, { status: 403 });
    }
    const { id: courseId, assignmentId } = await context.params;
    if ((await findCourseAccessRole(prisma, auth.userId, courseId)) !== 'enrolled') {
      return NextResponse.json({ error: 'Only enrolled students can submit' }, { status: 403 });
    }
    const assignment = await prisma.courseAssignment.findFirst({
      where: { id: assignmentId, courseId, published: true },
      select: {
        id: true,
        title: true,
        instructions: true,
        exemplarText: true,
        version: true,
        course: { select: { name: true } },
      },
    });
    if (!assignment) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: '请选择作业文件。' }, { status: 400 });
    }
    let extracted: Awaited<ReturnType<typeof extractAssignmentFile>>;
    try {
      extracted = await extractAssignmentFile(file);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : '作业读取失败。' },
        { status: 400 },
      );
    }
    const submission = await prisma.courseAssignmentSubmission.create({
      data: {
        assignmentId,
        studentId: auth.userId,
        fileName: extracted.fileName,
        mimeType: extracted.mimeType,
        fileData: Uint8Array.from(extracted.data),
        extractedText: extracted.text,
        sourceVersion: assignment.version,
      },
      select: { id: true },
    });
    try {
      const feedback = await withRequestContext(
        {
          userId: auth.userId,
          courseId,
          courseName: assignment.course.name,
          route: `/api/courses/${courseId}/assignments/${assignmentId}/submissions`,
          operationCode: 'course_assignment_review',
          chargeReason: 'AI 检查作业',
          serviceLabel: '作业问题检查',
        },
        () =>
          reviewAssignment({
            title: assignment.title,
            instructions: assignment.instructions,
            exemplarText: assignment.exemplarText,
            studentText: extracted.text,
          }),
      );
      await prisma.courseAssignmentSubmission.update({
        where: { id: submission.id },
        data: { feedbackJson: feedback, reviewStatus: 'complete', reviewError: null },
      });
      return NextResponse.json(
        { id: submission.id, reviewStatus: 'complete', feedback },
        { status: 201 },
      );
    } catch (error) {
      await prisma.courseAssignmentSubmission.update({
        where: { id: submission.id },
        data: { reviewStatus: 'error', reviewError: 'AI 检查暂时失败，文件已保存。请稍后重试。' },
      });
      console.error('[course-assignment-review] failed', error);
      return NextResponse.json(
        { id: submission.id, reviewStatus: 'error', error: '作业已保存，AI 检查暂时失败。' },
        { status: 201 },
      );
    }
  });
}
