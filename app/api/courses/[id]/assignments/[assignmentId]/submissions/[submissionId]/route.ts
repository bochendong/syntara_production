import { NextRequest, NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { reviewAssignment } from '@/lib/server/course-assignment-review';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { withRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';
export const maxDuration = 300;
type Context = { params: Promise<{ id: string; assignmentId: string; submissionId: string }> };

async function accessibleSubmission(
  courseId: string,
  assignmentId: string,
  submissionId: string,
  userId: string,
) {
  const role = await findCourseAccessRole(prisma, userId, courseId);
  if (!role) return null;
  return prisma.courseAssignmentSubmission.findFirst({
    where: {
      id: submissionId,
      assignmentId,
      assignment: { courseId, ...(role === 'enrolled' ? { published: true } : {}) },
      ...(role === 'enrolled' ? { studentId: userId } : {}),
    },
    include: {
      assignment: {
        select: {
          title: true,
          instructions: true,
          exemplarText: true,
          course: { select: { name: true } },
        },
      },
    },
  });
}

export async function GET(request: NextRequest, context: Context) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { id: courseId, assignmentId, submissionId } = await context.params;
    if (new URL(request.url).searchParams.get('download') !== '1') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const submission = await accessibleSubmission(
      courseId,
      assignmentId,
      submissionId,
      auth.userId,
    );
    if (!submission) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return new NextResponse(new Uint8Array(submission.fileData), {
      headers: {
        'Content-Type': submission.mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(submission.fileName)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  });
}

export async function POST(_request: NextRequest, context: Context) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    if ('previewedByAdmin' in auth && auth.previewedByAdmin) {
      return NextResponse.json({ error: '管理员预览为只读模式。' }, { status: 403 });
    }
    const { id: courseId, assignmentId, submissionId } = await context.params;
    const submission = await accessibleSubmission(
      courseId,
      assignmentId,
      submissionId,
      auth.userId,
    );
    if (!submission) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (submission.reviewStatus !== 'error') {
      return NextResponse.json({ error: '只有检查失败的提交可以重试。' }, { status: 409 });
    }
    const claimed = await prisma.courseAssignmentSubmission.updateMany({
      where: { id: submissionId, reviewStatus: 'error' },
      data: { reviewStatus: 'pending', reviewError: null },
    });
    if (claimed.count !== 1) {
      return NextResponse.json({ error: '这份作业正在检查。' }, { status: 409 });
    }
    try {
      const feedback = await withRequestContext(
        {
          userId: auth.userId,
          courseId,
          courseName: submission.assignment.course.name,
          route: `/api/courses/${courseId}/assignments/${assignmentId}/submissions/${submissionId}`,
          operationCode: 'course_assignment_review_retry',
          chargeReason: '重新检查作业',
          serviceLabel: '作业问题检查',
        },
        () =>
          reviewAssignment({
            title: submission.assignment.title,
            instructions: submission.assignment.instructions,
            exemplarText: submission.assignment.exemplarText,
            studentText: submission.extractedText,
          }),
      );
      await prisma.courseAssignmentSubmission.update({
        where: { id: submissionId },
        data: { feedbackJson: feedback, reviewStatus: 'complete', reviewError: null },
      });
      return NextResponse.json({ reviewStatus: 'complete', feedback });
    } catch (error) {
      await prisma.courseAssignmentSubmission.update({
        where: { id: submissionId },
        data: { reviewStatus: 'error', reviewError: 'AI 检查暂时失败，请稍后重试。' },
      });
      console.error('[course-assignment-review] retry failed', error);
      return NextResponse.json({ error: 'AI 检查暂时失败，请稍后重试。' }, { status: 503 });
    }
  });
}
