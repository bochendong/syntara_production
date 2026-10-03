import { withAiFailureAudit } from '@/lib/server/ai-failure-log';
import { after, NextResponse } from 'next/server';
import { withRequestContext } from '@/lib/server/request-context';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { toPrismaJson } from '@/lib/server/prisma-json';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';
import { runSourceProcessing } from '@/lib/server/teacher-source-processing';

export const runtime = 'nodejs';
export const maxDuration = 300;

async function auditedPOST(
  request: Request,
  context: { params: Promise<{ courseId: string; sourceId: string }> },
) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId, sourceId } = await context.params;
    const [course, source] = await Promise.all([
      prisma.course.findFirst({
        where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
        select: { id: true, name: true, courseCode: true },
      }),
      prisma.courseSource.findFirst({
        where: { id: sourceId, courseId, ownerId: teacher.userId, removedAt: null },
      }),
    ]);
    if (!course || !source) {
      return NextResponse.json({ error: '课程或源文件不存在' }, { status: 404 });
    }
    if (!source.fileData && !source.extractedText && !source.openaiFileId) {
      return NextResponse.json({ error: '源文件没有可处理的数据库内容' }, { status: 409 });
    }
    if (source.ingestStatus === 'uploading') {
      return NextResponse.json({ error: '源文件尚未上传完成，请稍后再处理。' }, { status: 409 });
    }

    const isProblemBank = source.sourceCategory === 'problem_bank';
    const notebookId = isProblemBank ? null : `teacher-notebook:${source.id}`;
    const taskId = isProblemBank
      ? `teacher-problem-import:${source.id}`
      : `teacher-generation:${notebookId}`;
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${taskId}, 0))`;
      const existingTask = await tx.agentTask.findUnique({
        where: { id: taskId },
        select: { status: true, stage: true, progress: true },
      });
      if (existingTask?.status === 'queued' || existingTask?.status === 'running') {
        return NextResponse.json(
          { ok: true, taskId, notebookId, ...existingTask },
          { status: 202 },
        );
      }

      const requestPayload = toPrismaJson({
        notebookId,
        sourceId: source.id,
        sourceTitle: source.title,
        sourcePageCount: 0,
        sourceTextCharacters: source.extractedText?.length || 0,
        courseCode: course.courseCode || course.name,
      });
      const task = await tx.agentTask.upsert({
        where: { id: taskId },
        create: {
          id: taskId,
          ownerId: teacher.userId,
          courseId,
          // The notebook does not exist yet. Linking it here violates the
          // AgentTask_notebookId_fkey before generation has had a chance to
          // persist the notebook. generateTeacherCourseNotebook attaches the
          // relation after persistTeacherCourseNotebook succeeds.
          notebookId: null,
          taskType: isProblemBank ? 'teacher_problem_bank_import' : 'teacher_notebook_generation',
          status: 'queued',
          stage: 'queued',
          progress: 0,
          attemptCount: 1,
          request: requestPayload,
        },
        update: {
          notebookId: null,
          status: 'queued',
          stage: 'queued',
          progress:
            isProblemBank && existingTask?.status === 'failed' && existingTask.progress < 100
              ? existingTask.progress
              : 0,
          attemptCount: { increment: 1 },
          request: requestPayload,
          error: null,
        },
        select: { status: true, stage: true, progress: true, attemptCount: true },
      });
      after(() =>
        withRequestContext(
          { userId: teacher.userId, courseId, route: '/api/teacher/courses/source/process' },
          () =>
            runSourceProcessing({
              ownerId: teacher.userId,
              courseId,
              sourceId: source.id,
              notebookId,
              taskId,
            }),
        ),
      );
      return NextResponse.json({ ok: true, taskId, notebookId, ...task }, { status: 202 });
    });
  });
}

export const POST = withAiFailureAudit(auditedPOST);
