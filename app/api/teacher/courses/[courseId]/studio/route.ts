import { NextResponse } from 'next/server';

import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';

const MIND_MAP_TASK_STALE_MS = 6 * 60 * 1000;
const STALE_MIND_MAP_ERROR = '任务超过服务器执行时限，已自动结束，请重新生成。';

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function sourceCategory(value: string | null, metadata: unknown) {
  const candidate = value || jsonRecord(metadata).sourceCategory;
  return candidate === 'crash_course_teacher_notes' || candidate === 'problem_bank'
    ? candidate
    : 'school_teacher_notes';
}

function notebookMetadata(
  value: unknown,
  courseId: string,
  notebookId: string,
  hasMindMapData: boolean,
) {
  const cover = jsonRecord(value);
  const mindMap = jsonRecord(cover.mindMap);
  return {
    learningOrder:
      typeof cover.learningOrder === 'number' && Number.isInteger(cover.learningOrder)
        ? cover.learningOrder
        : null,
    sourceId:
      typeof cover.sourceId === 'string'
        ? cover.sourceId
        : typeof cover.sourceFileId === 'string'
          ? cover.sourceFileId.replace(/^server-source-file:/, '')
          : notebookId.startsWith('teacher-notebook:')
            ? notebookId.slice('teacher-notebook:'.length)
            : null,
    generation: Object.keys(jsonRecord(cover.generation)).length
      ? jsonRecord(cover.generation)
      : null,
    mindMap:
      Object.keys(mindMap).length > 0 || hasMindMapData
        ? {
            ...mindMap,
            storage: typeof mindMap.storage === 'string' ? mindMap.storage : 'postgresql',
            imageUrl: `/api/teacher/courses/${encodeURIComponent(courseId)}/notebooks/${encodeURIComponent(notebookId)}/mind-map`,
          }
        : null,
  };
}

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
      select: {
        id: true,
        name: true,
        description: true,
        courseCode: true,
        academicYear: true,
        academicTerm: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });

    const [sources, notebooks, tasks] = await Promise.all([
      prisma.courseSource.findMany({
        where: { courseId, ownerId: teacher.userId, kind: 'teacher_upload' },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          title: true,
          fileMime: true,
          fileSize: true,
          sourceCategory: true,
          metadataJson: true,
          ingestStatus: true,
          removedAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.notebook.findMany({
        where: { courseId, ownerId: teacher.userId },
        include: { markdownSections: { orderBy: { order: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.agentTask.findMany({
        where: {
          courseId,
          ownerId: teacher.userId,
          taskType: {
            in: ['teacher_notebook_generation', 'teacher_mind_map_generation'],
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          notebookId: true,
          taskType: true,
          status: true,
          stage: true,
          progress: true,
          attemptCount: true,
          request: true,
          error: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const notebooksWithMindMaps = new Set(
      notebooks
        .filter((notebook) => Boolean(notebook.mindMapData?.byteLength))
        .map((notebook) => notebook.id),
    );
    const now = Date.now();
    const completedMindMapTaskIds = tasks
      .filter(
        (task) =>
          task.taskType === 'teacher_mind_map_generation' &&
          task.notebookId &&
          notebooksWithMindMaps.has(task.notebookId) &&
          task.status !== 'completed',
      )
      .map((task) => task.id);
    const completedMindMapTaskIdSet = new Set(completedMindMapTaskIds);
    const staleMindMapTaskIds = tasks
      .filter(
        (task) =>
          task.taskType === 'teacher_mind_map_generation' &&
          (task.status === 'queued' || task.status === 'running') &&
          !completedMindMapTaskIdSet.has(task.id) &&
          now - task.updatedAt.getTime() > MIND_MAP_TASK_STALE_MS,
      )
      .map((task) => task.id);

    await Promise.all([
      completedMindMapTaskIds.length
        ? prisma.agentTask.updateMany({
            where: { id: { in: completedMindMapTaskIds } },
            data: {
              status: 'completed',
              stage: 'completed',
              progress: 100,
              error: null,
            },
          })
        : Promise.resolve(),
      staleMindMapTaskIds.length
        ? prisma.agentTask.updateMany({
            where: { id: { in: staleMindMapTaskIds } },
            data: {
              status: 'failed',
              stage: 'failed',
              progress: 100,
              error: STALE_MIND_MAP_ERROR,
            },
          })
        : Promise.resolve(),
    ]);

    const staleMindMapTaskIdSet = new Set(staleMindMapTaskIds);

    return NextResponse.json({
      storage: 'postgresql',
      course: {
        ...course,
        createdAt: course.createdAt.getTime(),
        updatedAt: course.updatedAt.getTime(),
      },
      sources: sources.map((source) => ({
        id: source.id,
        title: source.title,
        mimeType: source.fileMime || 'application/octet-stream',
        size:
          source.fileSize ||
          (typeof jsonRecord(source.metadataJson).size === 'number'
            ? (jsonRecord(source.metadataJson).size as number)
            : 0),
        sourceCategory: sourceCategory(source.sourceCategory, source.metadataJson),
        ingestStatus: source.ingestStatus,
        removedAt: source.removedAt?.getTime() ?? null,
        fileUrl: `/api/teacher/courses/${encodeURIComponent(courseId)}/sources/${encodeURIComponent(source.id)}/file`,
        createdAt: source.createdAt.getTime(),
        updatedAt: source.updatedAt.getTime(),
      })),
      notebooks: notebooks.map((notebook) => ({
        id: notebook.id,
        title: notebook.name,
        summary: notebook.description || '',
        removedAt: notebook.removedAt?.getTime() ?? null,
        ...notebookMetadata(
          notebook.coverSlideJson,
          courseId,
          notebook.id,
          Boolean(notebook.mindMapData?.byteLength),
        ),
        sections: notebook.markdownSections.map((section) => ({
          id: section.id,
          title: section.title,
          summary: section.summary || '',
          markdown: section.markdown,
          sourcePages: Array.isArray(jsonRecord(section.sourceMeta).sourcePages)
            ? (jsonRecord(section.sourceMeta).sourcePages as unknown[]).filter(
                (page): page is number => typeof page === 'number' && Number.isInteger(page),
              )
            : [],
        })),
        createdAt: notebook.createdAt.getTime(),
        updatedAt: notebook.updatedAt.getTime(),
      })),
      tasks: tasks.map((task) => {
        const request = jsonRecord(task.request);
        const reconciledStatus = completedMindMapTaskIdSet.has(task.id)
          ? 'completed'
          : staleMindMapTaskIdSet.has(task.id)
            ? 'failed'
            : task.status;
        const reconciledStage = completedMindMapTaskIdSet.has(task.id)
          ? 'completed'
          : staleMindMapTaskIdSet.has(task.id)
            ? 'failed'
            : task.stage;
        const reconciledProgress =
          completedMindMapTaskIdSet.has(task.id) || staleMindMapTaskIdSet.has(task.id)
            ? 100
            : task.progress;
        return {
          id: task.id,
          notebookId: task.notebookId || undefined,
          kind: task.taskType === 'teacher_mind_map_generation' ? 'mind_map' : 'knowledge_notebook',
          sourceId:
            typeof request.sourceId === 'string'
              ? request.sourceId
              : typeof request.sourceFileId === 'string'
                ? request.sourceFileId.replace(/^server-source-file:/, '')
                : undefined,
          sourceTitle: typeof request.sourceTitle === 'string' ? request.sourceTitle : undefined,
          status: reconciledStatus,
          stage: reconciledStage,
          progress: reconciledProgress,
          attemptCount: task.attemptCount,
          persistenceStatus:
            reconciledStatus === 'completed'
              ? 'complete'
              : reconciledStatus === 'failed'
                ? 'failed'
                : 'pending',
          persistenceStorage: reconciledStatus === 'completed' ? 'postgresql' : undefined,
          errorReason: staleMindMapTaskIdSet.has(task.id)
            ? STALE_MIND_MAP_ERROR
            : task.error || undefined,
          createdAt: task.createdAt.getTime(),
          updatedAt: task.updatedAt.getTime(),
        };
      }),
    });
  });
}
