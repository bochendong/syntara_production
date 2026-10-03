import type { PrismaClient } from '@/lib/server/generated-prisma';
import { loadTrustedCourseLearningProgress } from './course-learning-progress';
import { resolveCourseNotebookAccess } from './repositories/course-enrollment-repository';

/** Enrollment and student-confirmed learning progress must both permit a read. */
export async function resolveCourseAgentNotebookAccess(
  db: PrismaClient,
  userId: string,
  courseId: string,
) {
  const access = await resolveCourseNotebookAccess(db, userId, courseId);
  if (!access) return null;
  const progress = await loadTrustedCourseLearningProgress({ prisma: db, userId, courseId });
  const learned =
    progress.allowedNotebookIds === null ? null : new Set(progress.allowedNotebookIds);
  return {
    ...access,
    allowedNotebookIds: access.allowedNotebookIds.filter(
      (id) => learned === null || learned.has(id),
    ),
    progressKnown: progress.learner.progressKnown,
    progressLabel: progress.learner.progressLabel,
  };
}
