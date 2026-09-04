import { NextResponse } from 'next/server';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';

function submissionLimit(request: Request) {
  const value = Number.parseInt(new URL(request.url).searchParams.get('limit') || '20', 10);
  return Number.isFinite(value) ? Math.min(50, Math.max(1, value)) : 20;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ courseId: string; problemId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;

    const { courseId, problemId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
      select: { id: true, externalBinding: { select: { id: true } } },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const problem = await prisma.notebookProblem.findFirst({
      where: {
        id: problemId,
        OR: [{ courseId }, { notebook: { courseId } }],
      },
      select: {
        id: true,
        title: true,
        type: true,
        difficulty: true,
        points: true,
        publicContentJson: true,
        chapter: { select: { name: true } },
      },
    });
    if (!problem) return NextResponse.json({ error: 'Problem not found' }, { status: 404 });

    const enrollments = await prisma.courseEnrollment.findMany({
      where: {
        courseId,
        user: {
          isActive: true,
          ...(course.externalBinding
            ? {
                externalCourseMemberships: {
                  some: {
                    bindingId: course.externalBinding.id,
                    role: 'STUDENT',
                    active: true,
                  },
                },
              }
            : {}),
        },
      },
      select: { userId: true },
    });

    const submissions = await prisma.notebookProblemAttempt.findMany({
      where: {
        problemId,
        userId: { in: enrollments.map((enrollment) => enrollment.userId) },
        kind: { in: ['submit', 'answer'] },
      },
      orderBy: { createdAt: 'desc' },
      take: submissionLimit(request),
      select: {
        id: true,
        kind: true,
        status: true,
        score: true,
        answerJson: true,
        resultJson: true,
        activeDurationMs: true,
        timingSource: true,
        createdAt: true,
        user: { select: { id: true, name: true, image: true } },
      },
    });

    return NextResponse.json({
      submissions: submissions.map((submission) => ({
        id: submission.id,
        kind: submission.kind,
        status: submission.status,
        score: submission.score,
        answer: submission.answerJson,
        result: submission.resultJson,
        activeDurationMs: submission.activeDurationMs,
        timingSource: submission.timingSource,
        createdAt: submission.createdAt.getTime(),
        student: {
          id: submission.user.id,
          name: submission.user.name?.trim() || '未命名学生',
          avatarUrl: submission.user.image || undefined,
        },
        problem: {
          id: problem.id,
          title: problem.title,
          type: problem.type,
          difficulty: problem.difficulty,
          points: problem.points,
          publicContent: problem.publicContentJson,
          chapterName: problem.chapter?.name ?? null,
        },
      })),
    });
  });
}
