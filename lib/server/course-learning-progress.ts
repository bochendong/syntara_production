import type { PrismaClient } from '@/lib/server/generated-prisma';
import { isLearnerCourseState, type LearnerCourseState } from '@/lib/learning/course-learner-state';
import type { CourseChatContext } from '@/lib/types/chat';

const LEARNER_STATE_NAMESPACE = 'openmaic.learn.state';

type ProgressNotebook = {
  id: string;
  name: string;
  createdAt: Date;
};

export type TrustedCourseLearningProgress = {
  learner: NonNullable<CourseChatContext['learner']>;
  allowedNotebookIds: string[] | null;
  futureNotebookIds: string[];
};

function notebookCourseOrder(notebook: Pick<ProgressNotebook, 'id' | 'name'>): number {
  for (const candidate of [notebook.name, notebook.id]) {
    const match = candidate.match(/(?:^|[-_\s])0?(\d{1,2})(?:\s*[-–—_:]|[-_\s]|$)/);
    if (match) return Number(match[1]);
  }
  return Number.MAX_SAFE_INTEGER;
}

function orderNotebooks(notebooks: ProgressNotebook[]): ProgressNotebook[] {
  return notebooks.slice().sort((a, b) => {
    const orderA = notebookCourseOrder(a);
    const orderB = notebookCourseOrder(b);
    if (orderA !== orderB) return orderA - orderB;
    return a.createdAt.getTime() - b.createdAt.getTime() || a.name.localeCompare(b.name);
  });
}

function emptyLearner(): NonNullable<CourseChatContext['learner']> {
  return {
    progressKnown: false,
    progressPercent: 0,
    attemptedProblemCount: 0,
    totalProblemCount: 0,
    dueReviewCount: 0,
    weakConcepts: [],
    nextConcepts: [],
    recentQuestions: [],
    recentAttempts: [],
    activePlans: [],
  };
}

function progressBoundary(state: LearnerCourseState, notebooks: ProgressNotebook[]): number | null {
  const checkpoint = state.progressCheckpoint;
  if (!checkpoint || checkpoint.source !== 'student') return null;
  if (checkpoint.kind === 'not_started') return 0;
  if (checkpoint.kind === 'completed_all') return notebooks.length;
  const checkpointId = checkpoint.notebookId || state.currentNotebookId;
  const index = notebooks.findIndex((notebook) => notebook.id === checkpointId);
  if (index >= 0) return index + 1;
  const completed = new Set(state.completedNotebookIds);
  return notebooks.filter((notebook) => completed.has(notebook.id)).length;
}

export async function loadTrustedCourseLearningProgress(args: {
  prisma: PrismaClient;
  userId: string;
  courseId: string;
  totalProblemCount?: number;
}): Promise<TrustedCourseLearningProgress> {
  const [fact, rawNotebooks] = await Promise.all([
    args.prisma.memoryFact.findFirst({
      where: {
        ownerId: args.userId,
        scopeType: 'user',
        scopeId: null,
        namespace: LEARNER_STATE_NAMESPACE,
        key: `course:${args.courseId}:state`,
        status: 'active',
      },
      orderBy: { updatedAt: 'desc' },
      select: { valueJson: true },
    }),
    args.prisma.notebook.findMany({
      where: { courseId: args.courseId },
      select: { id: true, name: true, createdAt: true },
    }),
  ]);
  const notebooks = orderNotebooks(rawNotebooks);
  if (!fact || !isLearnerCourseState(fact.valueJson, args.courseId)) {
    return { learner: emptyLearner(), allowedNotebookIds: null, futureNotebookIds: [] };
  }

  const state = fact.valueJson;
  const boundary = progressBoundary(state, notebooks);
  if (boundary === null) {
    return { learner: emptyLearner(), allowedNotebookIds: null, futureNotebookIds: [] };
  }
  const allowed = notebooks.slice(0, boundary);
  const future = notebooks.slice(boundary);
  const currentNotebook = allowed.at(-1);
  const checkpoint = state.progressCheckpoint;
  return {
    allowedNotebookIds: allowed.map((notebook) => notebook.id),
    futureNotebookIds: future.map((notebook) => notebook.id),
    learner: {
      progressKnown: true,
      progressLabel: checkpoint?.label,
      progressPercent:
        notebooks.length > 0 ? Math.round((allowed.length / notebooks.length) * 100) : 0,
      currentNotebookId: currentNotebook?.id,
      currentNotebookName: currentNotebook?.name,
      completedNotebookIds: allowed.map((notebook) => notebook.id),
      futureNotebookIds: future.map((notebook) => notebook.id),
      futureNotebookNames: future.map((notebook) => notebook.name),
      attemptedProblemCount: state.recentProblemAttempts.length,
      totalProblemCount: Math.max(0, args.totalProblemCount || 0),
      dueReviewCount: state.reviewQueue.length,
      weakConcepts: state.activeWeakPoints
        .filter((item) => item.status !== 'resolved')
        .map((item) => item.concept)
        .slice(0, 8),
      nextConcepts: future.flatMap((notebook) => [notebook.name]).slice(0, 5),
      recentQuestions: [],
      recentAttempts: state.recentProblemAttempts.slice(0, 8).map((attempt) => ({
        title: attempt.problemTitle,
        status: attempt.status,
        concepts: attempt.concepts,
      })),
      activePlans: [],
    },
  };
}
