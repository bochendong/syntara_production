import type { PrismaClient } from '@/lib/server/generated-prisma';
import { notebookProblemPublicContentSchema } from '@/lib/problem-bank';

export type ForumProblemSnapshot = {
  id: string;
  title: string;
  type: string;
  difficulty: string;
  publicContent: unknown;
  tagAssignments: Array<{ area: string; concept: string }>;
  capturedAt: string;
};

export async function loadForumProblemCard(args: {
  prisma: PrismaClient;
  courseId: string;
  problemId: string;
  requirePublished: boolean;
}) {
  const problem = await args.prisma.notebookProblem.findFirst({
    where: {
      id: args.problemId,
      ...(args.requirePublished ? { status: 'published' } : {}),
      OR: [{ courseId: args.courseId }, { notebook: { courseId: args.courseId } }],
    },
    select: {
      id: true,
      title: true,
      type: true,
      difficulty: true,
      publicContentJson: true,
      tagAssignments: {
        where: { status: 'applied' },
        include: { tag: { include: { parent: true } } },
      },
    },
  });
  if (!problem) return null;
  const publicContent = notebookProblemPublicContentSchema.safeParse(problem.publicContentJson);
  if (!publicContent.success) return null;
  return {
    id: problem.id,
    title: problem.title,
    type: problem.type,
    difficulty: problem.difficulty,
    publicContent: publicContent.data,
    tagAssignments: problem.tagAssignments
      .filter((assignment) => assignment.tag.parent)
      .map((assignment) => ({
        area: assignment.tag.parent!.name,
        concept: assignment.tag.name,
      })),
    capturedAt: new Date().toISOString(),
  } satisfies ForumProblemSnapshot;
}

export function parseForumProblemSnapshot(value: unknown): ForumProblemSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<ForumProblemSnapshot>;
  if (!item.id || !item.title || !item.type || !item.difficulty) return null;
  const publicContent = notebookProblemPublicContentSchema.safeParse(item.publicContent);
  if (!publicContent.success) return null;
  return {
    id: item.id,
    title: item.title,
    type: item.type,
    difficulty: item.difficulty,
    publicContent: publicContent.data,
    tagAssignments: Array.isArray(item.tagAssignments) ? item.tagAssignments : [],
    capturedAt: item.capturedAt || '',
  };
}
