import type { LanguageModel } from 'ai';
import {
  notebookProblemImportDraftSchema,
  problemStatementText,
  type NotebookProblemImportDraft,
  type NotebookProblemPublicMultipart,
} from '@/lib/problem-bank';
import { prisma } from '@/lib/server/prisma';
import { mergeSplitPartDrafts, splitCrammedPartDraft } from './import.multipart';
import { draftHasCompleteAnswer, ensureImportedDraftAnswers } from './import.core.llm';
import {
  createCourseProblemsFromDraftsWithSummary,
  requireCourseOwnership,
  touchOwnersAfterProblemWrite,
  updateCourseProblem,
} from './service';

/**
 * 小问体检：找出旧题里被拆开的小问（几道题其实是同一大题）和挤在一起的小问，
 * 给老师看建议，老师确认后才改。
 * - 合并：新建一道分小问大题放在原位置，原来几道题归档（作答记录留在旧题上）；
 * - 切开：原题原地升级成分小问大题，进度保留；每问的答案由 AI 补。
 * 机构课程的公有层改了题面后，下次发布会自动标成「题目已更新」。
 */

const PART_TYPES = ['short_answer', 'choice', 'proof', 'calculation', 'fill_blank'] as const;
const DISMISSED = 'dismissed';

type CheckupProblem = {
  id: string;
  title: string;
  type: string;
  stem: string;
};

export type MultipartCheckupSuggestion = {
  id: string;
  kind: 'merge' | 'split';
  notebookId: string | null;
  chapterId: string | null;
  problems: CheckupProblem[];
  preview: NotebookProblemPublicMultipart;
  title: string;
};

type Row = {
  id: string;
  notebookId: string | null;
  chapterId: string | null;
  title: string;
  type: string;
  status: string;
  source: string;
  order: number;
  problemNumber: number | null;
  points: number;
  difficulty: string;
  publicContentJson: unknown;
  gradingJson: unknown;
  sourceMeta: unknown;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function rowToDraft(row: Row): NotebookProblemImportDraft | null {
  const parsed = notebookProblemImportDraftSchema.safeParse({
    draftId: row.id,
    notebookId: row.notebookId,
    title: row.title,
    type: row.type,
    status: row.status,
    source: row.source,
    points: row.points,
    tags: [],
    difficulty: row.difficulty,
    publicContent: row.publicContentJson,
    grading: row.gradingJson,
    sourceMeta: record(row.sourceMeta),
    validationErrors: [],
  });
  return parsed.success ? parsed.data : null;
}

async function loadCandidates(courseId: string) {
  const rows = (await prisma.notebookProblem.findMany({
    where: {
      courseId,
      ownerId: null,
      status: { not: 'archived' },
      type: { in: [...PART_TYPES] },
    },
    orderBy: [{ notebookId: 'asc' }, { chapterId: 'asc' }, { order: 'asc' }],
    select: {
      id: true,
      notebookId: true,
      chapterId: true,
      title: true,
      type: true,
      status: true,
      source: true,
      order: true,
      problemNumber: true,
      points: true,
      difficulty: true,
      publicContentJson: true,
      gradingJson: true,
      sourceMeta: true,
    },
  })) as Row[];
  return rows.filter((row) => record(row.sourceMeta).multipartCheckup !== DISMISSED);
}

function describe(row: Row, draft: NotebookProblemImportDraft): CheckupProblem {
  return {
    id: row.id,
    title: row.title,
    type: row.type,
    stem: problemStatementText(draft.publicContent).slice(0, 600),
  };
}

function buildSuggestions(rows: Row[]): {
  suggestions: MultipartCheckupSuggestion[];
  drafts: Map<string, NotebookProblemImportDraft>;
} {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const groups = new Map<string, NotebookProblemImportDraft[]>();
  for (const row of rows) {
    const draft = rowToDraft(row);
    if (!draft) continue;
    const key = `${row.notebookId ?? ''}::${row.chapterId ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), draft]);
  }
  const suggestions: MultipartCheckupSuggestion[] = [];
  const drafts = new Map<string, NotebookProblemImportDraft>();
  for (const group of groups.values()) {
    const originals = new Map(group.map((draft) => [draft.draftId, draft]));
    for (const draft of mergeSplitPartDrafts(group).drafts) {
      const mergedIds = record(draft.sourceMeta).mergedDraftIds;
      if (draft.publicContent.type === 'multipart' && Array.isArray(mergedIds)) {
        const ids = mergedIds.filter((id): id is string => typeof id === 'string');
        const first = byId.get(ids[0])!;
        const id = `merge:${ids.join(',')}`;
        drafts.set(id, draft);
        suggestions.push({
          id,
          kind: 'merge',
          notebookId: first.notebookId,
          chapterId: first.chapterId,
          problems: ids.map((pid) => describe(byId.get(pid)!, originals.get(pid)!)),
          preview: draft.publicContent,
          title: draft.title,
        });
        continue;
      }
      const split = splitCrammedPartDraft(draft);
      if (split && split.publicContent.type === 'multipart') {
        const row = byId.get(draft.draftId)!;
        const id = `split:${draft.draftId}`;
        drafts.set(id, split);
        suggestions.push({
          id,
          kind: 'split',
          notebookId: row.notebookId,
          chapterId: row.chapterId,
          problems: [describe(row, draft)],
          preview: split.publicContent,
          title: split.title,
        });
      }
    }
  }
  return { suggestions, drafts };
}

export async function scanCourseMultipartCheckup(args: { userId: string; courseId: string }) {
  await requireCourseOwnership(args.userId, args.courseId);
  return buildSuggestions(await loadCandidates(args.courseId)).suggestions;
}

/** 老师点了「忽略」：这些题以后体检不再提。 */
export async function dismissCourseMultipartCheckup(args: {
  userId: string;
  courseId: string;
  suggestionIds: string[];
}) {
  await requireCourseOwnership(args.userId, args.courseId);
  const problemIds = args.suggestionIds.flatMap((id) =>
    id.replace(/^(merge|split):/, '').split(','),
  );
  const rows = await prisma.notebookProblem.findMany({
    where: { id: { in: problemIds }, courseId: args.courseId, ownerId: null },
    select: { id: true, sourceMeta: true },
  });
  for (const row of rows) {
    await prisma.notebookProblem.update({
      where: { id: row.id },
      data: { sourceMeta: { ...record(row.sourceMeta), multipartCheckup: DISMISSED } },
    });
  }
  return { dismissed: rows.length };
}

export type MultipartCheckupApplyResult = {
  applied: Array<{ suggestionId: string; problemId: string }>;
  failed: Array<{ suggestionId: string; error: string }>;
};

export async function applyCourseMultipartCheckup(args: {
  userId: string;
  courseId: string;
  suggestionIds: string[];
  model?: LanguageModel;
  language: 'zh-CN' | 'en-US';
}): Promise<MultipartCheckupApplyResult> {
  await requireCourseOwnership(args.userId, args.courseId);
  // 重新体检一遍，只改现在仍然成立的建议，避免老师打开弹窗后题目又被改过
  const rows = await loadCandidates(args.courseId);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const { drafts } = buildSuggestions(rows);
  const result: MultipartCheckupApplyResult = { applied: [], failed: [] };
  for (const suggestionId of args.suggestionIds) {
    const draft = drafts.get(suggestionId);
    if (!draft) {
      result.failed.push({ suggestionId, error: '题目已经变了，请重新体检。' });
      continue;
    }
    try {
      if (suggestionId.startsWith('merge:')) {
        result.applied.push({
          suggestionId,
          problemId: await applyMerge(args, draft, suggestionId, byId),
        });
      } else {
        result.applied.push({
          suggestionId,
          problemId: await applySplit(args, draft),
        });
      }
    } catch (error) {
      result.failed.push({
        suggestionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

async function applyMerge(
  args: { userId: string; courseId: string },
  draft: NotebookProblemImportDraft,
  suggestionId: string,
  byId: Map<string, Row>,
): Promise<string> {
  const ids = suggestionId.slice('merge:'.length).split(',');
  const originals = ids.map((id) => byId.get(id)!);
  const first = originals[0];
  const written = await createCourseProblemsFromDraftsWithSummary({
    userId: args.userId,
    courseId: args.courseId,
    drafts: [{ ...draft, draftId: `checkup-${first.id}`, status: first.status as 'draft' }],
    dedupeReadStrategy: 'indexed_input_keys',
    returnProblems: false,
  });
  const problemId =
    written.writeSummary.insertedProblemIds[0] ?? written.writeSummary.reusedProblemIds[0];
  if (!problemId) throw new Error('合并后的大题没有写进去。');
  await prisma.$transaction([
    prisma.notebookProblem.update({
      where: { id: problemId },
      data: {
        order: first.order,
        problemNumber: first.problemNumber,
        chapterId: first.chapterId,
      },
    }),
    prisma.notebookProblem.updateMany({
      where: { id: { in: ids }, courseId: args.courseId, ownerId: null },
      data: { status: 'archived' },
    }),
  ]);
  await touchOwnersAfterProblemWrite({ courseId: args.courseId, notebookIds: [first.notebookId] });
  return problemId;
}

async function applySplit(
  args: { userId: string; courseId: string; model?: LanguageModel; language: 'zh-CN' | 'en-US' },
  draft: NotebookProblemImportDraft,
): Promise<string> {
  const answered = await ensureImportedDraftAnswers({
    drafts: [draft],
    model: args.model,
    language: args.language,
  });
  const next = answered.drafts[0];
  if (!next || next.publicContent.type !== 'multipart' || !draftHasCompleteAnswer(next)) {
    throw new Error('AI 没能给每一问补齐答案，这道题先不改。');
  }
  await updateCourseProblem({
    userId: args.userId,
    courseId: args.courseId,
    problemId: draft.draftId,
    patch: {
      type: 'multipart',
      publicContent: next.publicContent,
      grading: next.grading,
      sourceMeta: { ...next.sourceMeta, multipartCheckup: 'split' },
    },
  });
  return draft.draftId;
}
