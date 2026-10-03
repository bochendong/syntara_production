import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/server/admin-auth';
import { prisma } from '@/lib/server/prisma';
import { safeRoute } from '@/lib/server/json-error-response';
import type { NotebookProblemClientRecord } from '@/lib/utils/notebook-problem-api';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; problemId: string }> },
) {
  return safeRoute(async () => {
    const admin = await requireAdmin();
    if ('response' in admin) return admin.response;
    const { id: courseId, problemId } = await context.params;
    const [course, row] = await Promise.all([
      prisma.course.findUnique({
        where: { id: courseId },
        select: { name: true, courseCode: true, academicYear: true, academicTerm: true },
      }),
      prisma.notebookProblem.findFirst({
        where: {
          id: problemId,
          OR: [{ courseId }, { courseId: null, notebook: { courseId } }],
        },
        include: {
          notebook: { select: { name: true } },
          chapter: { select: { id: true, name: true, description: true, position: true } },
          secret: { select: { secretJudgeJson: true } },
        },
      }),
    ]);
    if (!course || !row) {
      return NextResponse.json({ error: '没有找到这道题' }, { status: 404 });
    }
    const problem: NotebookProblemClientRecord = {
      id: row.id,
      courseId: row.courseId,
      notebookId: row.notebookId,
      notebookName: row.notebook?.name || undefined,
      chapterId: row.chapterId,
      chapterName: row.chapter?.name || undefined,
      title: row.title,
      type: row.type,
      source: row.source,
      order: row.order,
      problemNumber: row.problemNumber,
      points: row.points,
      tags: row.tags,
      difficulty: row.difficulty,
      publicContent: row.publicContentJson as NotebookProblemClientRecord['publicContent'],
      grading: row.gradingJson as NotebookProblemClientRecord['grading'],
      sourceMeta: (row.sourceMeta || {}) as NotebookProblemClientRecord['sourceMeta'],
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
      ...(row.secret
        ? {
            secretJudge: row.secret.secretJudgeJson as NonNullable<
              NotebookProblemClientRecord['secretJudge']
            >,
          }
        : {}),
    };
    return NextResponse.json({
      snapshot: {
        courseName: course.name,
        courseCode: course.courseCode || undefined,
        courseAcademicYear: course.academicYear || undefined,
        courseAcademicTerm: course.academicTerm || undefined,
        chapters: row.chapter
          ? [
              {
                id: row.chapter.id,
                name: row.chapter.name,
                description: row.chapter.description || '',
                position: row.chapter.position,
                problemCount: 1,
              },
            ]
          : [],
        problems: [problem],
      },
    });
  });
}
