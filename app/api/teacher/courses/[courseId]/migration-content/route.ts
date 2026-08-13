import { NextResponse } from 'next/server';

import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { requireTeacher } from '@/lib/server/teacher-auth';
import { teacherCourseAccessWhere } from '@/lib/server/external-course-access';

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const teacher = await requireTeacher();
    if ('response' in teacher) return teacher.response;
    const { courseId } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id: courseId, ...teacherCourseAccessWhere(teacher.userId) },
      select: { id: true },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    const [sources, notebooks] = await Promise.all([
      prisma.courseSource.findMany({
        where: { courseId, ownerId: teacher.userId, removedAt: null },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          title: true,
          fileMime: true,
          fileSize: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.notebook.findMany({
        where: { courseId, ownerId: teacher.userId, removedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, description: true, createdAt: true, updatedAt: true },
      }),
    ]);
    return NextResponse.json({
      storage: 'postgresql',
      items: [
        ...sources.map((source) => ({
          id: source.id,
          type: 'source' as const,
          title: source.title,
          description: `${source.fileMime || 'application/octet-stream'} · ${source.fileSize} bytes`,
          createdAt: source.createdAt.getTime(),
          updatedAt: source.updatedAt.getTime(),
          reference: { id: `source:${source.id}`, courseId, assetId: source.id },
        })),
        ...notebooks.map((notebook) => ({
          id: notebook.id,
          type: 'notebook' as const,
          title: notebook.name,
          description: notebook.description || '',
          createdAt: notebook.createdAt.getTime(),
          updatedAt: notebook.updatedAt.getTime(),
          reference: { id: `notebook:${notebook.id}`, courseId, assetId: notebook.id },
        })),
      ],
    });
  });
}
