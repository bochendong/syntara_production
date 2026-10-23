import type { PrismaClient } from '@/lib/server/generated-prisma';
import { notebookProblemImportDraftSchema } from '@/lib/problem-bank/schema';
import { createManualCourseProblem } from '@/lib/server/notebook-problems/service';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { refreshCourseSummaryFields } from '@/lib/server/repositories/notebook-repository';

export type NativeMaterialUpload = {
  courseId: string;
  kind: 'notes' | 'problems';
  /** App 本机生成的 id；笔记直接用它做服务器上的 id，重复上传不会多出一本。 */
  clientId: string;
  name: string;
  text: string;
};

export type NativeMaterialResult =
  | { status: 'saved'; kind: 'notes'; notebookId: string }
  | { status: 'saved'; kind: 'problems'; problemId: string }
  | { status: 'not_found' | 'forbidden' | 'conflict'; message: string };

const MAX_PROBLEM_STEM = 12_000;

/**
 * App 资料页上传：笔记写成一本 markdown 笔记（在加入的机构课程里是自己的私有层），
 * 题目写进自己课程的题库（草稿，网页上补答案后发布）。
 */
export async function uploadNativeMaterial(
  prisma: PrismaClient,
  userId: string,
  input: NativeMaterialUpload,
): Promise<NativeMaterialResult> {
  const role = await findCourseAccessRole(prisma, userId, input.courseId);
  if (!role) return { status: 'not_found', message: 'Course not found.' };
  const name = input.name.trim().slice(0, 200) || '未命名资料';

  if (input.kind === 'notes') {
    const existing = await prisma.notebook.findUnique({
      where: { id: input.clientId },
      select: { ownerId: true, courseId: true },
    });
    if (existing) {
      return existing.ownerId === userId && existing.courseId === input.courseId
        ? { status: 'saved', kind: 'notes', notebookId: input.clientId }
        : { status: 'conflict', message: 'Notebook id is taken.' };
    }
    await prisma.$transaction(async (tx) => {
      await tx.notebook.create({
        data: {
          id: input.clientId,
          ownerId: userId,
          courseId: input.courseId,
          name,
          description: '上传的笔记',
          tags: ['上传笔记'],
          notebookKind: 'markdown',
          sectionCount: 1,
        },
      });
      await tx.markdownNotebookSection.create({
        data: {
          notebookId: input.clientId,
          courseId: input.courseId,
          title: name,
          order: 0,
          markdown: input.text,
          summary: input.text.slice(0, 240),
          sourceMeta: { source: 'native-upload' },
        },
      });
    });
    // 机构课程的汇总数字只算机构自己的内容。
    if (role === 'owner') await refreshCourseSummaryFields(prisma, input.courseId).catch(() => {});
    return { status: 'saved', kind: 'notes', notebookId: input.clientId };
  }

  if (role !== 'owner') {
    return { status: 'forbidden', message: '加入的课程里不能上传题目。' };
  }
  const stem = input.text.trim().slice(0, MAX_PROBLEM_STEM);
  if (!stem) return { status: 'conflict', message: '题目是空的。' };
  const draft = notebookProblemImportDraftSchema.parse({
    draftId: input.clientId,
    notebookId: null,
    title: name.replace(/\.[^.]+$/, '').trim() || name,
    type: 'short_answer',
    status: 'draft',
    source: 'manual',
    tags: ['App 上传'],
    publicContent: { type: 'short_answer', stem },
    grading: { type: 'short_answer' },
    sourceMeta: { source: 'native-upload', clientId: input.clientId },
  });
  try {
    const created = await createManualCourseProblem({ userId, courseId: input.courseId, draft });
    return { status: 'saved', kind: 'problems', problemId: created.id };
  } catch (cause) {
    return {
      status: 'conflict',
      message: cause instanceof Error ? cause.message : '没能保存题目。',
    };
  }
}
