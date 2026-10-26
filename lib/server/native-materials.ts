import type { PrismaClient } from '@/lib/server/generated-prisma';
import { notebookProblemImportDraftSchema } from '@/lib/problem-bank/schema';
import { createManualCourseProblem } from '@/lib/server/notebook-problems/service';
import { findCourseAccessRole } from '@/lib/server/repositories/course-enrollment-repository';
import { refreshCourseSummaryFields } from '@/lib/server/repositories/notebook-repository';
import { createHash } from 'node:crypto';
import { toPrismaJson } from '@/lib/server/prisma-json';
import {
  resolveCourseProblemImportAdmin,
  courseProblemImportAdminAudit,
} from '@/lib/server/course-problem-import-admin';
import {
  resolveCourseProblemImportGrant,
  assertCourseProblemImportGrant,
  courseProblemImportGrantAudit,
} from '@/lib/server/course-problem-import-grant';

export type NativeMaterialUpload = {
  courseId: string;
  kind: 'notes' | 'problems';
  /** App 本机生成的 id；笔记直接用它做服务器上的 id，重复上传不会多出一本。 */
  clientId: string;
  name: string;
  text: string;
  /** Explicit backend append workflow; authority is resolved from the real principal separately. */
  scope?: 'shared';
  mode?: 'preview' | 'commit';
  expectedHash?: string;
  language?: 'zh-CN' | 'en-US';
};

export type SharedNativeNotesReceipt = {
  status: 'preview' | 'saved';
  kind: 'notes';
  scope: 'shared';
  notebookId: string;
  courseId: string;
  name: string;
  text: string;
  payloadHash: string;
  actor: Record<string, unknown>;
  replayed: boolean;
  language: string;
};

export type NativeMaterialResult =
  | SharedNativeNotesReceipt
  | { status: 'saved'; kind: 'notes'; notebookId: string }
  | { status: 'saved'; kind: 'problems'; problemId: string }
  | { status: 'not_found' | 'forbidden' | 'conflict'; message: string };

const MAX_PROBLEM_STEM = 12_000;

async function uploadSharedNativeNotes(
  prisma: PrismaClient,
  userId: string,
  input: NativeMaterialUpload,
  keyId?: string,
): Promise<NativeMaterialResult> {
  if (input.kind !== 'notes')
    return {
      status: 'forbidden',
      message: 'Structured questions use the reviewed question import endpoint.',
    };
  const course = await prisma.course.findUnique({
    where: { id: input.courseId },
    select: { ownerId: true, language: true },
  });
  if (!course) return { status: 'not_found', message: 'Course not found.' };
  const admin =
    userId === course.ownerId
      ? null
      : await resolveCourseProblemImportAdmin({
          db: prisma,
          userId,
          courseId: input.courseId,
          dataOwnerId: course.ownerId,
        });
  const grant =
    userId === course.ownerId || admin
      ? null
      : resolveCourseProblemImportGrant({
          userId,
          keyId,
          courseId: input.courseId,
          dataOwnerId: course.ownerId,
          purpose: 'notes',
        });
  if (userId !== course.ownerId && !admin && !grant)
    return {
      status: 'forbidden',
      message:
        'Shared notes require the real course owner, existing administrator, or an unexpired materials import grant.',
    };
  const actor = grant
    ? courseProblemImportGrantAudit(grant)
    : admin
      ? { ...courseProblemImportAdminAudit(admin), keyId }
      : {
          kind: 'course-owner',
          userId,
          keyId,
          dataOwnerId: course.ownerId,
          courseId: input.courseId,
        };
  const name = input.name.trim();
  if (!name || name.length > 200 || !input.text.trim())
    return {
      status: 'conflict',
      message: 'Shared notes require a title (1–200 characters) and nonempty Markdown.',
    };
  const language = input.language || course.language || 'zh-CN';
  const payloadHash = createHash('sha256')
    .update(
      JSON.stringify({
        courseId: input.courseId,
        clientId: input.clientId,
        name,
        text: input.text,
        language,
      }),
    )
    .digest('hex');
  const receipt = {
    kind: 'notes' as const,
    scope: 'shared' as const,
    notebookId: input.clientId,
    courseId: input.courseId,
    name,
    text: input.text,
    language,
    payloadHash,
    actor,
  };
  const existing = await prisma.notebook.findUnique({
    where: { id: input.clientId },
    include: { markdownSections: { orderBy: { order: 'asc' } } },
  });
  const matches = (row: typeof existing) =>
    Boolean(
      row &&
      row.ownerId === course.ownerId &&
      row.courseId === input.courseId &&
      row.name === name &&
      row.language === language &&
      row.notebookKind === 'markdown' &&
      row.removedAt === null &&
      row.markdownSections.length === 1 &&
      row.markdownSections[0].courseId === input.courseId &&
      row.markdownSections[0].title === name &&
      row.markdownSections[0].markdown === input.text,
    );
  if (existing && !matches(existing))
    return {
      status: 'conflict',
      message:
        'Notebook ID already exists with different content or scope; nothing was overwritten.',
    };
  if (input.mode === 'preview')
    return { ...receipt, status: 'preview', replayed: Boolean(existing) };
  if (input.expectedHash !== payloadHash)
    return {
      status: 'conflict',
      message: 'The accepted shared-note preview hash does not match this payload.',
    };
  if (existing) return { ...receipt, status: 'saved', replayed: true };
  try {
    await prisma.$transaction(async (tx) => {
      if (grant) assertCourseProblemImportGrant(grant, input.courseId, course.ownerId);
      const current = await tx.course.findUnique({
        where: { id: input.courseId },
        select: { ownerId: true },
      });
      if (current?.ownerId !== course.ownerId)
        throw new Error('Course owner changed during import.');
      await tx.notebook.create({
        data: {
          id: input.clientId,
          ownerId: course.ownerId,
          courseId: input.courseId,
          name,
          language,
          description: 'Reviewed course notes',
          tags: ['reviewed-course-import'],
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
          sourceMeta: toPrismaJson({ source: 'reviewed-native-import', payloadHash, actor }),
        },
      });
      await refreshCourseSummaryFields(tx, input.courseId);
      await tx.course.update({
        where: { id: input.courseId },
        data: { contentVersion: { increment: 1 } },
      });
    });
  } catch {
    // A concurrent identical fixed-ID upload may already have committed. Never upsert/overwrite.
    const raced = await prisma.notebook.findUnique({
      where: { id: input.clientId },
      include: { markdownSections: { orderBy: { order: 'asc' } } },
    });
    if (matches(raced)) return { ...receipt, status: 'saved', replayed: true };
    return {
      status: 'conflict',
      message:
        'The shared-note transaction did not produce the accepted content; inspect before retrying.',
    };
  }
  const saved = await prisma.notebook.findUnique({
    where: { id: input.clientId },
    include: { markdownSections: { orderBy: { order: 'asc' } } },
  });
  if (!matches(saved))
    return {
      status: 'conflict',
      message: 'Shared-note readback differs from the accepted content.',
    };
  return { ...receipt, status: 'saved', replayed: false };
}

/**
 * App 资料页上传：笔记写成一本 markdown 笔记（在加入的机构课程里是自己的私有层），
 * 题目写进自己课程的题库（草稿，网页上补答案后发布）。
 */
export async function uploadNativeMaterial(
  prisma: PrismaClient,
  userId: string,
  input: NativeMaterialUpload,
  principal: { keyId?: string } = {},
): Promise<NativeMaterialResult> {
  if (input.scope === 'shared')
    return uploadSharedNativeNotes(prisma, userId, input, principal.keyId);
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

  // 加入的课程里上传的题放在自己的私有层（createManualCourseProblem 按身份分层）。
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
