import { prisma } from '@/lib/server/prisma';

export type NotebookProblemCourseIdentity = {
  id: string;
  name: string;
  courseCode: string | null;
};

/**
 * Resolve the authoritative course row for grading. Problem/notebook labels are
 * useful hints, but they must not be used as a substitute for the real course
 * identity stored in the database.
 */
export async function resolveNotebookProblemCourseIdentity(args: {
  courseId?: string | null;
  notebookId?: string | null;
}): Promise<NotebookProblemCourseIdentity | undefined> {
  let courseId = args.courseId?.trim() || null;
  if (!courseId && args.notebookId) {
    const notebook = await prisma.notebook.findUnique({
      where: { id: args.notebookId },
      select: { courseId: true },
    });
    courseId = notebook?.courseId?.trim() || null;
  }
  if (!courseId) return undefined;

  const course = await prisma.course.findUnique({
    where: { id: courseId },
    select: {
      id: true,
      name: true,
      courseCode: true,
    },
  });
  return course ?? undefined;
}
