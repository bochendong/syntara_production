import { NextResponse } from 'next/server';
import { requireUserId } from '@/lib/server/api-auth';
import { safeRoute } from '@/lib/server/json-error-response';
import { prisma } from '@/lib/server/prisma';
import { resolveCourseNotebookAccess } from '@/lib/server/repositories/course-enrollment-repository';

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function GET(_request: Request, context: { params: Promise<{ courseId: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId({ ensureFallbackUser: false });
    if ('response' in auth) return auth.response;
    const { courseId } = await context.params;
    const access = await resolveCourseNotebookAccess(prisma, auth.userId, courseId);
    if (!access || access.role !== 'enrolled') {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }
    // Keep remote PostgreSQL reads sequential: production intentionally runs a
    // small connection pool and this page should not consume every slot at once.
    const course = await prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        name: true,
        description: true,
        courseCode: true,
        academicYear: true,
        academicTerm: true,
        avatarUrl: true,
        updatedAt: true,
        owner: { select: { name: true, email: true } },
      },
    });
    if (!course) return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    const notebooks = await prisma.notebook.findMany({
      where: { courseId, removedAt: null },
      select: {
        id: true,
        name: true,
        description: true,
        notebookKind: true,
        tags: true,
        sectionCount: true,
        sceneCount: true,
        mindMapData: true,
        mindMapMime: true,
        coverSlideJson: true,
        updatedAt: true,
        _count: { select: { markdownSections: true, pages: true, scenes: true } },
      },
    });
    const student = await prisma.user.findUnique({
      where: { id: auth.userId },
      select: { id: true, name: true, email: true },
    });
    const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
    const allowed = new Set(access.allowedNotebookIds);
    const ordered = access.orderedNotebookIds.flatMap((id) => {
      const notebook = byId.get(id);
      return notebook ? [notebook] : [];
    });
    return NextResponse.json(
      {
        storage: 'postgresql',
        previewedByAdmin: 'previewedByAdmin' in auth && auth.previewedByAdmin === true,
        student,
        course: {
          id: course.id,
          name: course.name,
          description: course.description || '',
          code: course.courseCode?.trim() || course.name,
          academicYear: course.academicYear,
          term: course.academicTerm,
          avatarUrl: course.avatarUrl,
          teacherName: course.owner.name || course.owner.email || '课程老师',
          updatedAt: course.updatedAt.toISOString(),
        },
        progressLimit: {
          notebookAccessLimit: access.notebookAccessLimit,
          unlockedCount: access.allowedNotebookIds.length,
          totalCount: access.orderedNotebookIds.length,
        },
        notebooks: ordered.map((notebook, index) => {
          const cover = jsonRecord(notebook.coverSlideJson);
          const unlocked = allowed.has(notebook.id);
          return {
            id: notebook.id,
            title: notebook.name,
            summary: notebook.description || '',
            kind: notebook.notebookKind,
            tags: notebook.tags,
            order: index + 1,
            unlocked,
            contentCount: Math.max(
              notebook.sectionCount,
              notebook.sceneCount,
              notebook._count.markdownSections,
              notebook._count.pages,
              notebook._count.scenes,
            ),
            hasMindMap: unlocked && Boolean(notebook.mindMapData?.byteLength),
            mindMapMime: unlocked && notebook.mindMapData ? notebook.mindMapMime : null,
            coverImagePath:
              unlocked && typeof cover.coverImagePath === 'string' ? cover.coverImagePath : null,
            updatedAt: notebook.updatedAt.toISOString(),
          };
        }),
      },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  });
}
