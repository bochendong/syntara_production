import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import {
  notebookProblemImportDraftSchema,
  type NotebookProblemImportDraft,
} from '@/lib/problem-bank/schema';
import { problemContentReadinessErrors } from '@/lib/problem-bank/content-readiness';
import { courseProblemDedupeKey } from '@/features/problems/domain/problem-dedupe';
import { createCourseProblemsFromDraftsWithSummary } from '@/lib/server/notebook-problems/service';
import * as batchStore from '@/lib/server/notebook-problems/import-batch-store';
import {
  assertStagingProblemImportOperator,
  problemImportOperatorAudit,
  type StagingProblemImportOperator,
} from '@/lib/server/course-problem-import-operator';
import {
  resolveCourseProblemImportAdmin,
  courseProblemImportAdminAudit,
  type CourseProblemImportAdmin,
} from '@/lib/server/course-problem-import-admin';
import {
  resolveCourseProblemImportGrant,
  courseProblemImportGrantAudit,
  type CourseProblemImportGrant,
} from '@/lib/server/course-problem-import-grant';

const ref = z.string().trim().min(1).max(120);
export const structuredCourseProblemImportSchema = z
  .object({
    version: z.literal(1),
    courseId: z.string().trim().min(1).max(200),
    idempotencyKey: z.string().trim().min(8).max(160),
    chapters: z
      .array(
        z
          .object({
            ref,
            id: ref.optional(),
            name: z.string().trim().min(1).max(160),
            description: z.string().trim().max(2000).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
    items: z
      .array(z.object({ chapterRef: ref, draft: notebookProblemImportDraftSchema }).strict())
      .min(1)
      .max(100),
  })
  .strict();

export type StructuredCourseProblemImport = z.infer<typeof structuredCourseProblemImportSchema>;
export type CourseProblemImportActor =
  | { userId: string; keyId?: string; operatorContext?: never }
  | { userId?: never; operatorContext: StagingProblemImportOperator };

export class CourseProblemImportError extends Error {
  constructor(
    readonly status: 400 | 403 | 404 | 409,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CourseProblemImportError';
  }
}

function requireImport(
  condition: unknown,
  status: 400 | 403 | 404 | 409,
  code: string,
  message: string,
): asserts condition {
  if (!condition) throw new CourseProblemImportError(status, code, message);
}

function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(',')}}`;
}
const hash = (value: unknown) => createHash('sha256').update(stable(value)).digest('hex');

function validateDraft(draft: NotebookProblemImportDraft) {
  requireImport(
    !draft.notebookId,
    400,
    'invalid_request',
    'Course imports must not attach or create notebooks.',
  );
  requireImport(
    draft.type === draft.publicContent.type && draft.type === draft.grading.type,
    400,
    'invalid_request',
    'Question, statement and grading types must agree.',
  );
  requireImport(
    draft.type !== 'code' && !draft.secretJudge,
    400,
    'invalid_request',
    'Executable questions require the separate runner validation workflow.',
  );
  requireImport(
    draft.points === 100 &&
      draft.validationErrors.length === 0 &&
      problemContentReadinessErrors(draft).length === 0,
    400,
    'invalid_request',
    'Only accepted 100-point drafts with valid statement structure can be imported.',
  );
  const grading = draft.grading;
  if (grading.type === 'choice' && draft.publicContent.type === 'choice') {
    const options = new Set(draft.publicContent.options.map((option) => option.id));
    requireImport(
      options.size === draft.publicContent.options.length &&
        grading.correctOptionIds.length > 0 &&
        new Set(grading.correctOptionIds).size === grading.correctOptionIds.length &&
        grading.correctOptionIds.every((id) => options.has(id)) &&
        (draft.publicContent.selectionMode !== 'single' || grading.correctOptionIds.length === 1),
      400,
      'invalid_request',
      'Choice answer IDs do not match the stated selection mode/options.',
    );
  }
  if (grading.type === 'proof' || grading.type === 'short_answer') {
    const answer = grading.type === 'proof' ? grading.referenceProof : grading.referenceAnswer;
    requireImport(
      answer?.trim() && (grading.rubric?.trim() || grading.rubricCriteria?.length),
      400,
      'invalid_request',
      'Written questions require a reference answer/proof and a task-specific rubric.',
    );
    if (grading.rubricCriteria?.length)
      requireImport(
        Math.abs(
          grading.rubricCriteria.reduce((sum, criterion) => sum + criterion.points, 0) - 100,
        ) < 1e-9,
        400,
        'invalid_request',
        'Rubric criteria must total 100 points.',
      );
  }
  if (grading.type === 'calculation')
    requireImport(
      grading.referenceAnswer?.trim(),
      400,
      'invalid_request',
      'Calculation questions require a reference answer.',
    );
  if (draft.publicContent.type === 'fill_blank')
    requireImport(
      !draft.publicContent.blanks.some((blank) => blank.answerKind === 'code_token'),
      400,
      'invalid_request',
      'Code-token blanks require executable validation.',
    );
}

export function parseStructuredCourseProblemImport(input: unknown) {
  const parsed = structuredCourseProblemImportSchema.parse(input);
  const refs = new Set(parsed.chapters.map((chapter) => chapter.ref));
  requireImport(
    refs.size === parsed.chapters.length &&
      new Set(parsed.chapters.map((chapter) => chapter.name)).size === parsed.chapters.length,
    400,
    'invalid_request',
    'Chapter references and names must be unique within a batch.',
  );
  const ids = new Set<string>();
  const keys = new Set<string>();
  const items = parsed.items.map((item) => {
    requireImport(
      refs.has(item.chapterRef) && !ids.has(item.draft.draftId),
      400,
      'invalid_request',
      'Each question needs a unique draftId and a declared chapterRef.',
    );
    ids.add(item.draft.draftId);
    // Reviewed structured content is canonical. AI extraction heuristics can
    // mistake construction tasks for missing context and damage valid tables.
    const draft = item.draft;
    validateDraft(draft);
    const key = courseProblemDedupeKey(draft);
    requireImport(
      !keys.has(key),
      409,
      'duplicate_question',
      'Duplicate question content within this batch must be reconciled before import.',
    );
    keys.add(key);
    return { chapterRef: item.chapterRef, draft: { ...draft, notebookId: null } };
  });
  return { ...parsed, items };
}

type Dependencies = {
  db: PrismaClient;
  writeDrafts: typeof createCourseProblemsFromDraftsWithSummary;
  store: Pick<
    typeof batchStore,
    | 'createProblemImportBatch'
    | 'getProblemImportBatchForTarget'
    | 'claimProblemImportBatchCommit'
    | 'markProblemImportBatchCommitted'
    | 'readProblemImportCommitResult'
  >;
};

function sourceMetadata(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = { ...(value as Record<string, unknown>) };
  delete result.importBatchId;
  delete result.normalizedOrder;
  delete result.structuredImport;
  return result;
}

type SavedQuestion = {
  ownerId: string | null;
  courseId: string | null;
  notebookId: string | null;
  chapterId: string | null;
  title: string;
  type: string;
  source: string;
  status: string;
  difficulty: string;
  points: number;
  tags: string[];
  publicContentJson: unknown;
  gradingJson: unknown;
  sourceMeta: unknown;
};
function requireExactSavedQuestion(
  row: SavedQuestion | undefined,
  draft: NotebookProblemImportDraft,
  courseId: string,
  chapterId: string | null | undefined,
) {
  requireImport(
    row &&
      row.ownerId === null &&
      row.courseId === courseId &&
      !row.notebookId &&
      row.chapterId === chapterId &&
      row.title === draft.title &&
      row.type === draft.type &&
      row.source === draft.source &&
      row.status === draft.status &&
      row.difficulty === draft.difficulty &&
      row.points === 100 &&
      stable(row.tags) === stable(draft.tags) &&
      stable(row.publicContentJson) === stable(draft.publicContent) &&
      stable(row.gradingJson) === stable(draft.grading) &&
      stable(sourceMetadata(row.sourceMeta)) === stable(sourceMetadata(draft.sourceMeta)),
    409,
    'readback_conflict',
    'Saved/reused question content, grading, provenance or chapter differs; no existing question was overwritten.',
  );
}

/** The same business command is used by owner HTTP requests and explicit audited maintenance. */
export function createStructuredCourseProblemImportService(
  deps: Dependencies = {
    db: prisma,
    writeDrafts: createCourseProblemsFromDraftsWithSummary,
    store: batchStore,
  },
) {
  const { db, store } = deps;
  async function plan(input: unknown, actor: CourseProblemImportActor) {
    const data = parseStructuredCourseProblemImport(input);
    const course = await db.course.findUnique({
      where: { id: data.courseId },
      select: { id: true, name: true, ownerId: true },
    });
    requireImport(course, 404, 'not_found', 'Course not found.');
    let adminContext: CourseProblemImportAdmin | null = null;
    let grantContext: CourseProblemImportGrant | null = null;
    if (actor.operatorContext)
      assertStagingProblemImportOperator(actor.operatorContext, course.id, course.ownerId);
    else if (actor.userId !== course.ownerId) {
      adminContext = await resolveCourseProblemImportAdmin({
        db,
        userId: actor.userId,
        courseId: course.id,
        dataOwnerId: course.ownerId,
      });
      if (!adminContext)
        grantContext = resolveCourseProblemImportGrant({
          userId: actor.userId,
          keyId: actor.keyId,
          courseId: course.id,
          dataOwnerId: course.ownerId,
        });
      requireImport(
        adminContext || grantContext,
        403,
        'forbidden',
        'Course question import requires the real course owner, an existing administrator, or an explicit unexpired grant for this course.',
      );
    }
    const audit = actor.operatorContext
      ? problemImportOperatorAudit(actor.operatorContext)
      : adminContext
        ? courseProblemImportAdminAudit(adminContext)
        : grantContext
          ? courseProblemImportGrantAudit(grantContext)
          : { kind: 'course-owner', userId: actor.userId, dataOwnerId: course.ownerId };
    const payloadHash = hash(data);
    const batchId = `structured_import_${hash([course.id, course.ownerId, data.idempotencyKey]).slice(0, 40)}`;
    const chapters = [];
    for (const chapter of data.chapters) {
      const existing = chapter.id
        ? await db.courseProblemChapter.findUnique({ where: { id: chapter.id } })
        : await db.courseProblemChapter.findFirst({
            where: { courseId: course.id, name: chapter.name },
          });
      requireImport(
        !chapter.id || existing,
        404,
        'not_found',
        'The explicitly selected chapter does not exist.',
      );
      requireImport(
        !existing || (existing.courseId === course.id && existing.name === chapter.name),
        409,
        'chapter_conflict',
        'A selected chapter belongs to another course or has a different name.',
      );
      chapters.push({
        ...chapter,
        id: existing?.id ?? null,
        state: existing ? ('reuse' as const) : ('create' as const),
      });
    }
    const previous = await db.problemImportBatch.findUnique({ where: { id: batchId } });
    requireImport(
      !previous ||
        (previous.courseId === course.id &&
          previous.ownerId === course.ownerId &&
          previous.targetType === 'course' &&
          hash(previous.draftSnapshotJson) === payloadHash),
      409,
      'idempotency_conflict',
      'This idempotency key is already bound to a different import payload.',
    );
    return { data, course, audit, payloadHash, batchId, chapters, adminContext, grantContext };
  }

  async function preview(input: unknown, actor: CourseProblemImportActor) {
    const planned = await plan(input, actor);
    return {
      mode: 'preview' as const,
      batchId: planned.batchId,
      payloadHash: planned.payloadHash,
      course: planned.course,
      actor: planned.audit,
      chapters: planned.chapters,
      itemCount: planned.data.items.length,
      difficultyCounts: planned.data.items.reduce(
        (counts, item) => {
          counts[item.draft.difficulty]++;
          return counts;
        },
        { easy: 0, medium: 0, hard: 0 },
      ),
      typeCounts: planned.data.items.reduce<Record<string, number>>((counts, item) => {
        counts[item.draft.type] = (counts[item.draft.type] || 0) + 1;
        return counts;
      }, {}),
      createsNotebooks: 0,
    };
  }

  async function readback(
    planned: Awaited<ReturnType<typeof plan>>,
    result: batchStore.ProblemImportCommitResult,
  ) {
    const ids = [...new Set([...result.insertedProblemIds, ...result.reusedProblemIds])];
    const rows = await db.notebookProblem.findMany({
      where: { courseId: planned.course.id, id: { in: ids } },
      include: { chapter: true },
    });
    const byKey = new Map(rows.map((row) => [row.dedupeKey, row]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const items = planned.data.items.map((item) => {
      const reusedId = result.reusedDrafts.find(
        (entry) => entry.draftId === item.draft.draftId,
      )?.existingProblemId;
      const row = reusedId ? byId.get(reusedId) : byKey.get(courseProblemDedupeKey(item.draft));
      const chapter = planned.chapters.find((entry) => entry.ref === item.chapterRef);
      requireExactSavedQuestion(row, item.draft, planned.course.id, chapter?.id);
      requireImport(row, 409, 'readback_conflict', 'A persisted question is missing.');
      return {
        draftId: item.draft.draftId,
        problem: {
          id: row.id,
          courseId: row.courseId,
          notebookId: row.notebookId,
          chapterId: row.chapterId,
          chapterName: row.chapter?.name ?? null,
          title: row.title,
          type: row.type,
          source: row.source,
          status: row.status,
          points: row.points,
          tags: row.tags,
          difficulty: row.difficulty,
          publicContent: row.publicContentJson,
          grading: row.gradingJson,
          sourceMeta: row.sourceMeta,
          contentUpdatedAt: row.updatedAt.toISOString(),
        },
      };
    });
    return items;
  }

  async function commit(input: unknown, actor: CourseProblemImportActor, expectedHash: string) {
    const planned = await plan(input, actor);
    requireImport(
      expectedHash === planned.payloadHash,
      409,
      'preview_conflict',
      'The accepted preview hash does not match this payload.',
    );
    const scope = { prisma: db, userId: planned.course.ownerId, batchId: planned.batchId };
    let batch = await store.createProblemImportBatch({
      ...scope,
      targetType: 'course',
      courseId: planned.course.id,
      source: 'structured-course-import',
      draftSnapshot: planned.data,
      draftCount: planned.data.items.length,
      usage: { actor: planned.audit, payloadHash: planned.payloadHash },
      batchId: planned.batchId,
    });
    requireImport(
      hash(batch.draftSnapshotJson) === planned.payloadHash,
      409,
      'idempotency_conflict',
      'The stored operation has a different payload.',
    );
    requireImport(
      batch.status !== 'cancelled',
      409,
      'cancelled',
      'This import batch was cancelled.',
    );
    let result = store.readProblemImportCommitResult(batch);
    let replayed = batch.status === 'committed' || Boolean(result);
    if (!result) {
      const claimed = await store.claimProblemImportBatchCommit({
        ...scope,
        commitCount: planned.data.items.length,
        payloadHash: planned.payloadHash,
      });
      requireImport(
        claimed,
        409,
        'request_in_progress',
        'The import is already running; inspect its receipt before retrying.',
      );
      batch = claimed;
      for (const chapter of planned.chapters) {
        if (chapter.id) continue;
        const existing = await db.courseProblemChapter.findFirst({
          where: { courseId: planned.course.id, name: chapter.name },
        });
        if (existing) chapter.id = existing.id;
        else {
          const last = await db.courseProblemChapter.aggregate({
            where: { courseId: planned.course.id },
            _max: { position: true },
          });
          try {
            chapter.id = (
              await db.courseProblemChapter.create({
                data: {
                  courseId: planned.course.id,
                  name: chapter.name,
                  description: chapter.description || null,
                  position: (last._max.position ?? -1) + 1,
                },
              })
            ).id;
          } catch (error) {
            const concurrent = await db.courseProblemChapter.findFirst({
              where: { courseId: planned.course.id, name: chapter.name },
            });
            if (!concurrent) throw error;
            chapter.id = concurrent.id;
          }
        }
      }
      const chapterIdByDraftId = Object.fromEntries(
        planned.data.items.map((item) => [
          item.draft.draftId,
          planned.chapters.find((chapter) => chapter.ref === item.chapterRef)!.id,
        ]),
      );
      const authority = actor.operatorContext
        ? { operatorContext: actor.operatorContext }
        : planned.adminContext
          ? { adminContext: planned.adminContext }
          : planned.grantContext
            ? { grantContext: planned.grantContext }
            : { userId: actor.userId! };
      const written = await deps.writeDrafts({
        ...authority,
        courseId: planned.course.id,
        drafts: planned.data.items.map((item) => ({
          ...item.draft,
          notebookId: null,
          sourceMeta: {
            ...item.draft.sourceMeta,
            structuredImport: {
              draftId: item.draft.draftId,
              batchId: planned.batchId,
              payloadHash: planned.payloadHash,
              actor: planned.audit,
            },
          },
        })),
        chapterIdByDraftId,
        importBatchId: planned.batchId,
        importBatchLeaseToken: batch.commitLeaseToken,
        dedupeReadStrategy: 'indexed_input_keys',
        returnProblems: false,
        publishCourseVersion: true,
        preservePreparedContent: true,
        validateReusedDraft: (draft, row) =>
          requireExactSavedQuestion(
            row,
            draft,
            planned.course.id,
            chapterIdByDraftId[draft.draftId],
          ),
      });
      result = written.writeSummary;
      replayed = false;
    }
    if (batch.status !== 'committed') {
      const marked = await store.markProblemImportBatchCommitted({
        ...scope,
        committedCount: result.insertedProblemIds.length,
        leaseToken: batch.commitLeaseToken,
        commitResult: result,
      });
      requireImport(
        marked,
        409,
        'receipt_conflict',
        'Persistence finished but the operation receipt needs reconciliation.',
      );
    }
    const items = await readback(planned, result);
    return {
      mode: 'committed' as const,
      batchId: planned.batchId,
      payloadHash: planned.payloadHash,
      course: planned.course,
      actor: planned.audit,
      replayed,
      chapters: planned.chapters,
      writeSummary: result,
      items,
      createsNotebooks: 0,
    };
  }
  return { preview, commit };
}
