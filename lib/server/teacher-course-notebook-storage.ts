import { prisma } from '@/lib/server/prisma';
import { toPrismaJson } from '@/lib/server/prisma-json';

export type TeacherNotebookSectionInput = {
  id: string;
  title: string;
  summary?: string;
  markdown: string;
  sourcePages?: number[];
};

export type TeacherNotebookGenerationMetadata = {
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  sourcePageCount: number;
  generatedAt: number;
};

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function persistTeacherCourseNotebook(args: {
  ownerId: string;
  courseId: string;
  notebookId: string;
  title: string;
  summary?: string;
  sourceId?: string;
  sections: TeacherNotebookSectionInput[];
  generation?: TeacherNotebookGenerationMetadata;
}) {
  const existing = await prisma.notebook.findUnique({
    where: { id: args.notebookId },
    select: { ownerId: true, courseId: true, coverSlideJson: true },
  });
  if (existing && (existing.ownerId !== args.ownerId || existing.courseId !== args.courseId)) {
    throw new Error('Notebook id already belongs to another course or user');
  }
  const savedAt = Date.now();
  const coverSlideJson = toPrismaJson({
    ...jsonRecord(existing?.coverSlideJson),
    sourceId: args.sourceId || null,
    persistence: { status: 'complete', storage: 'postgresql', savedAt },
    ...(args.generation ? { generation: args.generation } : {}),
  });
  await prisma.$transaction(async (tx) => {
    await tx.notebook.upsert({
      where: { id: args.notebookId },
      create: {
        id: args.notebookId,
        ownerId: args.ownerId,
        courseId: args.courseId,
        name: args.title,
        description: args.summary || null,
        tags: ['teacher-course'],
        language: 'zh-CN',
        notebookKind: 'markdown',
        sectionCount: args.sections.length,
        coverSlideJson,
      },
      update: {
        name: args.title,
        description: args.summary || null,
        tags: ['teacher-course'],
        language: 'zh-CN',
        notebookKind: 'markdown',
        sectionCount: args.sections.length,
        removedAt: null,
        coverSlideJson,
      },
    });
    await tx.markdownNotebookSection.deleteMany({ where: { notebookId: args.notebookId } });
    if (args.sections.length) {
      await tx.markdownNotebookSection.createMany({
        data: args.sections.map((section, order) => ({
          id: section.id,
          notebookId: args.notebookId,
          courseId: args.courseId,
          title: section.title,
          order,
          markdown: section.markdown,
          summary: section.summary || null,
          sourceMeta: toPrismaJson({ sourcePages: section.sourcePages || [] }),
        })),
      });
    }
    const notebookCount = await tx.notebook.count({
      where: { courseId: args.courseId, removedAt: null },
    });
    await tx.course.update({ where: { id: args.courseId }, data: { notebookCount } });
  });
}
