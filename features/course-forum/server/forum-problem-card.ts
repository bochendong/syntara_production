import type { PrismaClient } from '@/lib/server/generated-prisma';
import { notebookProblemPublicContentSchema } from '@/lib/problem-bank';

export type ForumProblemSnapshot = {
  id: string;
  title: string;
  type: string;
  difficulty: string;
  publicContent: unknown;
  chapterName: string | null;
  capturedAt: string;
};

export async function loadForumProblemCard(args: {
  prisma: PrismaClient;
  courseId: string;
  problemId: string;
}) {
  const problem = await args.prisma.notebookProblem.findFirst({
    where: {
      id: args.problemId,
      OR: [{ courseId: args.courseId }, { notebook: { courseId: args.courseId } }],
    },
    select: {
      id: true,
      title: true,
      type: true,
      difficulty: true,
      publicContentJson: true,
      chapter: { select: { name: true } },
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
    chapterName: problem.chapter?.name ?? null,
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
    chapterName: typeof item.chapterName === 'string' ? item.chapterName : null,
    capturedAt: item.capturedAt || '',
  };
}
