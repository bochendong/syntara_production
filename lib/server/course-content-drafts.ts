import { randomUUID } from 'node:crypto';
import type { DbClient } from './repositories/types';
import {
  canEditCourseProfile,
  CourseAdmissionError,
  lockAdmissionCourse,
  requireCourseManagement,
} from './course-admissions';
import { notebookProblemImportDraftSchema } from '@/lib/problem-bank/schema';
import {
  normalizeDraftForPersistence,
  withCodeReferenceVerification,
} from './notebook-problems/service';
import { courseProblemDedupeKey } from '@/features/problems/domain/problem-dedupe';
import { toPrismaJson } from './prisma-json';
import { refreshCourseSummaryFields } from './repositories/notebook-repository';

type Section = { id: string; title: string; order: number; markdown: string };
type DraftPayload = {
  name: string;
  title: string;
  markdownSections: Section[];
  publicContentJson: Record<string, unknown>;
  gradingJson: Record<string, unknown>;
  chapterId?: string | null;
  notebookId?: string | null;
  type: import('@/lib/server/generated-prisma').NotebookProblemType;
  status: import('@/lib/server/generated-prisma').NotebookProblemStatus;
  difficulty: import('@/lib/server/generated-prisma').NotebookProblemDifficulty;
  points: number;
  tags: string[];
  order: number;
  source?: string;
  sourceMeta?: unknown;
  dedupeKey: string;
};
type Kind = 'notes' | 'problems';
export type ContentDraft = {
  courseId: string;
  kind: Kind;
  targetId: string;
  operation: 'save' | 'delete';
  payload: DraftPayload;
  baseUpdatedAt: Date | null;
  updatedAt: Date;
};
export async function draftAuthority(db: DbClient, userId: string, courseId: string) {
  const course = await requireCourseManagement(db, userId, courseId);
  if (!(await canEditCourseProfile(db, userId, course)))
    throw new CourseAdmissionError(403, '没有课程内容管理权限。');
  return course;
}
export async function contentDrafts(db: DbClient, courseId: string) {
  return db.$queryRaw<
    ContentDraft[]
  >`SELECT * FROM "CourseContentDraft" WHERE "courseId" = ${courseId} ORDER BY "updatedAt", "targetId"`;
}
async function put(db: DbClient, draft: Omit<ContentDraft, 'updatedAt'>) {
  await db.$executeRaw`INSERT INTO "CourseContentDraft" ("courseId", "kind", "targetId", "operation", "payload", "baseUpdatedAt") VALUES (${draft.courseId}, ${draft.kind}, ${draft.targetId}, ${draft.operation}, ${JSON.stringify(draft.payload)}::jsonb, ${draft.baseUpdatedAt?.toISOString() ?? null}::timestamp) ON CONFLICT ("courseId", "kind", "targetId") DO UPDATE SET "operation" = EXCLUDED."operation", "payload" = EXCLUDED."payload", "updatedAt" = timezone('UTC', CURRENT_TIMESTAMP)`;
}
export async function stageContent(
  db: DbClient,
  userId: string,
  courseId: string,
  kind: Kind,
  id: string | null,
  patch: Record<string, unknown>,
  deleting = false,
) {
  await lockAdmissionCourse(db, courseId);
  const course = await draftAuthority(db, userId, courseId);
  const previous = id
    ? (await contentDrafts(db, courseId)).find((row) => row.kind === kind && row.targetId === id)
    : undefined;
  const live = id
    ? kind === 'notes'
      ? await db.notebook.findFirst({
          where: { id, courseId, ownerId: course.ownerId, removedAt: null },
          include: { markdownSections: true },
        })
      : await db.notebookProblem.findFirst({
          where: { id, courseId, ownerId: null, status: { not: 'archived' } },
          include: { secret: true },
        })
    : null;
  if (id && !live && !previous) throw new CourseAdmissionError(404, '内容不存在。');
  if (previous?.operation === 'delete' && !deleting)
    throw new CourseAdmissionError(409, '请先撤销待删除操作。');
  const targetId = id || randomUUID();
  if (deleting && !live) {
    await db.$executeRaw`DELETE FROM "CourseContentDraft" WHERE "courseId"=${courseId} AND "kind"=${kind} AND "targetId"=${targetId}`;
    return;
  }
  let payload = { ...(previous?.payload ?? live ?? {}), ...patch } as unknown as DraftPayload;
  if (kind === 'notes') {
    payload.name = typeof patch.title === 'string' ? patch.title : payload.name;
    payload.markdownSections = previous?.payload.markdownSections ??
      (live && 'markdownSections' in live ? live.markdownSections : undefined) ?? [
        {
          id: randomUUID(),
          title: payload.name,
          order: 0,
          markdown: typeof patch.text === 'string' ? patch.text : '',
        },
      ];
    for (const section of (patch.sections as Section[] | undefined) ?? []) {
      const found = payload.markdownSections.find((row: Section) => row.id === section.id);
      if (!found) throw new CourseAdmissionError(400, '笔记小节不存在。');
      found.markdown = section.markdown;
    }
  } else if (!deleting) {
    const publicContent = patch.publicContent ??
      payload.publicContentJson ?? { type: 'short_answer', stem: patch.text };
    const grading = patch.grading ?? payload.gradingJson ?? { type: 'short_answer' };
    const parsed = notebookProblemImportDraftSchema.parse({
      draftId: targetId,
      notebookId: payload.notebookId ?? null,
      title: payload.title,
      type: payload.type ?? (publicContent as { type: string }).type,
      status: payload.status ?? 'draft',
      source: payload.source ?? 'manual',
      difficulty: payload.difficulty ?? 'medium',
      tags: payload.tags ?? [],
      publicContent,
      grading,
      secretJudge: live && 'secret' in live ? live.secret?.secretJudgeJson : undefined,
      sourceMeta: payload.sourceMeta ?? {},
      validationErrors: [],
    });
    const normalized = normalizeDraftForPersistence(
      await withCodeReferenceVerification(parsed),
      payload.order ?? 0,
    );
    if (parsed.status === 'published' && normalized.status !== 'published')
      throw new CourseAdmissionError(
        400,
        `题目还不能发布：${normalized.validationErrors.join('；')}`,
      );
    payload = {
      ...payload,
      title: normalized.title,
      type: normalized.type,
      status: normalized.status,
      difficulty: normalized.difficulty,
      publicContentJson: normalized.publicContent,
      gradingJson: normalized.grading,
      points: normalized.points,
      tags: normalized.tags,
      dedupeKey: courseProblemDedupeKey(normalized),
    };
    if (
      payload.chapterId &&
      !(await db.courseProblemChapter.findFirst({ where: { id: payload.chapterId, courseId } }))
    )
      throw new CourseAdmissionError(400, '章节不属于这门课程。');
    if (
      payload.notebookId &&
      !(await db.notebook.findFirst({
        where: { id: payload.notebookId, courseId, ownerId: course.ownerId, removedAt: null },
      })) &&
      !(await contentDrafts(db, courseId)).some(
        (row) =>
          row.kind === 'notes' && row.targetId === payload.notebookId && row.operation === 'save',
      )
    )
      throw new CourseAdmissionError(400, '笔记不属于这门课程。');
  }
  await put(db, {
    courseId,
    kind,
    targetId,
    operation: deleting ? 'delete' : 'save',
    payload,
    baseUpdatedAt: previous?.baseUpdatedAt ?? live?.updatedAt ?? null,
  });
}
export async function applyContentDrafts(db: DbClient, courseId: string) {
  const course = await db.course.findUniqueOrThrow({ where: { id: courseId } });
  const changes = (await contentDrafts(db, courseId)).sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === 'notes' ? -1 : 1,
  );
  for (const draft of changes) {
    if (draft.kind === 'notes')
      await db.$queryRaw`SELECT id FROM "Notebook" WHERE id = ${draft.targetId} FOR UPDATE`;
    else
      await db.$queryRaw`SELECT id FROM "NotebookProblem" WHERE id = ${draft.targetId} FOR UPDATE`;
    const live =
      draft.kind === 'notes'
        ? await db.notebook.findUnique({ where: { id: draft.targetId } })
        : await db.notebookProblem.findUnique({ where: { id: draft.targetId } });
    if (!draft.baseUpdatedAt && live)
      throw new CourseAdmissionError(409, '新增内容的标识已存在，请重新核对。');
    if (
      draft.baseUpdatedAt &&
      (!live || live.updatedAt.getTime() !== draft.baseUpdatedAt.getTime())
    )
      throw new CourseAdmissionError(409, '内容已在其他入口修改，请重新核对后再发布。');
    if (draft.kind === 'problems' && draft.operation === 'save' && draft.payload.status === 'draft')
      continue;
    const p = draft.payload;
    if (draft.operation === 'delete') {
      if (draft.kind === 'notes')
        await db.notebook.update({
          where: { id: draft.targetId },
          data: { removedAt: new Date() },
        });
      else
        await db.notebookProblem.update({
          where: { id: draft.targetId },
          data: { status: 'archived' },
        });
    } else if (draft.kind === 'notes') {
      await db.notebook.upsert({
        where: { id: draft.targetId },
        create: {
          id: draft.targetId,
          ownerId: course.ownerId,
          courseId,
          name: p.name,
          tags: [],
          notebookKind: 'markdown',
          sectionCount: p.markdownSections.length,
        },
        update: { name: p.name, contentVersion: { increment: 1 } },
      });
      for (const section of p.markdownSections)
        await db.markdownNotebookSection.upsert({
          where: { id: section.id },
          create: {
            id: section.id,
            notebookId: draft.targetId,
            courseId,
            title: section.title,
            order: section.order,
            markdown: section.markdown,
            summary: section.markdown.slice(0, 240),
          },
          update: { markdown: section.markdown, summary: section.markdown.slice(0, 240) },
        });
    } else {
      const data = {
        title: p.title,
        type: p.type,
        status: p.status,
        difficulty: p.difficulty,
        points: p.points,
        tags: p.tags,
        publicContentJson: toPrismaJson(p.publicContentJson),
        gradingJson: toPrismaJson(p.gradingJson),
        notebookId: p.notebookId ?? null,
        chapterId: p.chapterId ?? null,
        dedupeKey: p.dedupeKey,
      };
      await db.notebookProblem.upsert({
        where: { id: draft.targetId },
        create: { ...data, id: draft.targetId, courseId, ownerId: null, order: p.order ?? 0 },
        update: data,
      });
    }
    await db.$executeRaw`DELETE FROM "CourseContentDraft" WHERE "courseId"=${courseId} AND "kind"=${draft.kind} AND "targetId"=${draft.targetId}`;
  }
  const notebooks = await db.notebook.findMany({
    where: { courseId, ownerId: course.ownerId },
    select: { id: true },
  });
  for (const notebook of notebooks) {
    const problemCount = await db.notebookProblem.count({
      where: { notebookId: notebook.id, status: { not: 'archived' } },
    });
    const publishedProblemCount = await db.notebookProblem.count({
      where: { notebookId: notebook.id, status: 'published' },
    });
    await db.notebook.updateMany({
      where: { id: notebook.id },
      data: { problemCount, publishedProblemCount },
    });
  }
  await refreshCourseSummaryFields(db, courseId);
}

export async function undoContentDraft(
  db: DbClient,
  userId: string,
  courseId: string,
  kind: Kind,
  id: string,
) {
  await lockAdmissionCourse(db, courseId);
  await draftAuthority(db, userId, courseId);
  await db.$executeRaw`DELETE FROM "CourseContentDraft" WHERE "courseId"=${courseId} AND "kind"=${kind} AND "targetId"=${id}`;
}
