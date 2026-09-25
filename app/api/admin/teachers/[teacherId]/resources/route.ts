import { prisma } from '@/lib/server/prisma';
import { requireAdmin } from '@/lib/server/admin-auth';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import { safeRoute } from '@/lib/server/json-error-response';
import type { Prisma } from '@prisma/client';

export async function GET(request: Request, context: { params: Promise<{ teacherId: string }> }) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const { teacherId } = await context.params;
    const teacher = await prisma.user.findFirst({
      where: { id: teacherId, role: 'TEACHER' },
      select: { id: true, name: true, email: true },
    });
    if (!teacher) return apiError('INVALID_REQUEST', 404, '老师不存在');
    const query = new URL(request.url).searchParams;
    const kind = query.get('kind') || 'notebooks';
    const courseId = query.get('courseId') || '';
    const requestedPage = Number(query.get('page') || 1);
    if (
      !['notebooks', 'problems'].includes(kind) ||
      !Number.isSafeInteger(requestedPage) ||
      requestedPage < 1
    ) {
      return apiError('INVALID_REQUEST', 400, '无效的资料类型或页码');
    }
    const courses = await prisma.course.findMany({
      where: { ownerId: teacherId },
      select: { id: true, name: true, courseCode: true, university: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
    });
    // Course filters only narrow the selected teacher's resources.
    if (courseId && courseId !== 'unassigned' && !courses.some((c) => c.id === courseId)) {
      return apiError('INVALID_REQUEST', 404, '该老师没有此课程');
    }
    const filter = courseId ? { courseId: courseId === 'unassigned' ? null : courseId } : {};
    const notebooksWhere: Prisma.NotebookWhereInput = { ownerId: teacherId, ...filter };
    const problemsWhere: Prisma.NotebookProblemWhereInput = {
      OR: [{ course: { ownerId: teacherId } }, { notebook: { ownerId: teacherId } }],
      ...filter,
    };
    const [notebookCount, problemCount] = await Promise.all([
      prisma.notebook.count({ where: notebooksWhere }),
      prisma.notebookProblem.count({ where: problemsWhere }),
    ]);
    const total = kind === 'notebooks' ? notebookCount : problemCount;
    const pageSize = 20;
    const pages = Math.max(1, Math.ceil(total / pageSize));
    const page = Math.min(requestedPage, pages);
    const pagination = { skip: (page - 1) * pageSize, take: pageSize };
    const rows =
      kind === 'notebooks'
        ? await prisma.notebook.findMany({
            where: notebooksWhere,
            ...pagination,
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            select: {
              id: true,
              name: true,
              description: true,
              notebookKind: true,
              removedAt: true,
              updatedAt: true,
              course: { select: { name: true } },
              _count: {
                select: { pages: true, scenes: true, markdownSections: true, problems: true },
              },
            },
          })
        : await prisma.notebookProblem.findMany({
            where: problemsWhere,
            ...pagination,
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            select: {
              id: true,
              title: true,
              type: true,
              status: true,
              problemNumber: true,
              updatedAt: true,
              course: { select: { name: true } },
              notebook: { select: { name: true } },
              chapter: { select: { name: true } },
            },
          });
    const response = apiSuccess({
      teacher,
      courses,
      rows,
      notebookCount,
      problemCount,
      page,
      pages,
      total,
    });
    response.headers.set('Cache-Control', 'private, no-store');
    return response;
  });
}
