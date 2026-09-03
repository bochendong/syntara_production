import { NextResponse } from 'next/server';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';

export async function GET(
  _request: Request,
  context: { params: Promise<{ courseId: string; studentId: string; attemptId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, studentId, attemptId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
      select: { id: true },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    const enrollment = await prisma.courseEnrollment.findUnique({
      where: { userId_courseId: { userId: studentId, courseId } },
      select: { id: true },
    });
    if (!enrollment) return NextResponse.json({ error: 'Student not found' }, { status: 404 });
    const attempt = await prisma.notebookProblemAttempt.findFirst({
      where: {
        id: attemptId,
        userId: studentId,
        problem: { OR: [{ courseId }, { notebook: { courseId } }] },
      },
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
        problem: { select: { id: true, title: true, problemNumber: true } },
      },
    });
    if (!attempt) return NextResponse.json({ error: 'Attempt not found' }, { status: 404 });
    return NextResponse.json({ attempt: { ...attempt, createdAt: attempt.createdAt.getTime() } });
  });
}
