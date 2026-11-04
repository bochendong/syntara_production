import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { courseProblemDedupeKey } from '@/features/problems/domain/problem-dedupe';
import { problemContentReadinessErrors } from '@/lib/problem-bank/content-readiness';
import { notebookProblemImportDraftSchema } from '@/lib/problem-bank/schema';
import { courseProblemRevision } from './admin-course-problem-upload';
import { codeDraftFingerprint, verifyCodePreflight } from './course-code-preflight';
import { MultipartRepairConflict } from './course-problem-multipart';
import type { Prisma, PrismaClient } from './generated-prisma';
import { toPrismaJson } from './prisma-json';
import { refreshCourseSummaryFields } from './repositories/notebook-repository';
import { problemFingerprintSql } from './store-course-layers';

const id = z.string().trim().min(1).max(200);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export function codeMultipartOriginalRevision(
  row: Parameters<typeof courseProblemRevision>[0] & {
    secret?: { secretJudgeJson: Prisma.JsonValue } | null;
  },
) {
  return courseProblemRevision({
    ...row,
    gradingJson: [row.gradingJson, row.secret?.secretJudgeJson ?? null],
  });
}

const inputSchema = z
  .object({
    apply: z.boolean().default(false),
    reviewHash: digest.optional(),
    preflightActor: z.object({ userId: id, keyId: id }).strict(),
    changes: z
      .array(
        z
          .object({
            id,
            expectedRevision: digest,
            draft: notebookProblemImportDraftSchema,
            codePreflight: z.string().min(1).max(4096),
            absorbed: z
              .array(z.object({ id, expectedRevision: digest }).strict())
              .max(8)
              .default([]),
          })
          .strict(),
      )
      .min(1)
      .max(30),
  })
  .strict();

export async function updateCourseCodeMultipart(
  db: PrismaClient,
  courseId: string,
  input: unknown,
) {
  const { apply, reviewHash, changes, preflightActor } = inputSchema.parse(input);
  const targets = changes.flatMap((change) => [change, ...change.absorbed]);
  if (new Set(targets.map((target) => target.id)).size !== targets.length)
    throw new MultipartRepairConflict('Every original ID must occur exactly once.');
  for (const { draft, codePreflight } of changes) {
    if (
      draft.publicContent.type !== 'multipart' ||
      draft.grading.type !== 'multipart' ||
      draft.type !== 'multipart' ||
      !draft.secretJudge?.parts
    )
      throw new MultipartRepairConflict('Expected a multipart draft with private code tests.');
    const labels = draft.publicContent.parts.map((part) => part.label);
    const codeLabels = draft.publicContent.parts
      .filter((part) => part.content.type === 'code')
      .map((part) => part.label);
    const gradingByLabel = new Map(draft.grading.parts.map((part) => [part.label, part.grading]));
    if (
      new Set(labels).size !== labels.length ||
      draft.grading.parts.length !== labels.length ||
      !codeLabels.length ||
      Object.keys(draft.secretJudge.parts).length !== codeLabels.length ||
      codeLabels.some((label) => !Object.hasOwn(draft.secretJudge!.parts!, label)) ||
      draft.publicContent.parts.some(
        (part, index) =>
          !part.points ||
          gradingByLabel.get(part.label)?.type !== part.content.type ||
          part.dependsOn?.some((label) => !labels.slice(0, index).includes(label)),
      )
    )
      throw new MultipartRepairConflict('Public parts, grading and hidden tests must agree.');
    const errors = problemContentReadinessErrors(draft);
    if (errors.length) throw new MultipartRepairConflict(errors.join('; '));
    if (!verifyCodePreflight(codePreflight, { courseId, ...preflightActor, draft }))
      throw new MultipartRepairConflict(
        'A current preflight proof for the complete draft is required.',
      );
  }

  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Course" WHERE "id" = ${courseId} FOR UPDATE`;
      const ids = targets.map((target) => target.id);
      await tx.$queryRaw`SELECT "id" FROM "NotebookProblem" WHERE "courseId" = ${courseId} AND "id" = ANY(${ids}::text[]) ORDER BY "id" FOR UPDATE`;
      const pending = await tx.$queryRaw<Array<{ targetId: string }>>`
      SELECT "targetId" FROM "CourseContentDraft"
      WHERE "courseId" = ${courseId} AND "kind" = 'problems' AND "targetId" = ANY(${ids}::text[])
    `;
      if (pending.length)
        throw new MultipartRepairConflict('An original has pending teacher edits.');
      const rows = await tx.notebookProblem.findMany({
        where: { courseId, ownerId: null, id: { in: ids } },
        include: {
          secret: true,
          _count: {
            select: { attempts: true, progress: true, classSessionItems: true, forumPosts: true },
          },
        },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      function original(target: (typeof targets)[number]) {
        const row = byId.get(target.id);
        if (!row || !['code', 'multipart'].includes(row.type))
          throw new MultipartRepairConflict('An original executable question was not found.');
        return row;
      }
      const plans = changes.map((change) => {
        const row = original(change);
        const absorbed = change.absorbed.map(original);
        const fingerprint = codeDraftFingerprint(change.draft);
        const dedupeKey = courseProblemDedupeKey(change.draft);
        const source = z.record(z.string(), z.unknown()).safeParse(row.sourceMeta);
        const previous = source.success ? source.data.codeMultipartUpdate : undefined;
        const revision = { fingerprint, absorbedIds: absorbed.map((item) => item.id) };
        const unchanged =
          row.status === 'published' &&
          isDeepStrictEqual(previous, revision) &&
          row.title === change.draft.title &&
          isDeepStrictEqual(row.publicContentJson, change.draft.publicContent) &&
          isDeepStrictEqual(row.gradingJson, change.draft.grading) &&
          isDeepStrictEqual(row.secret?.secretJudgeJson, change.draft.secretJudge) &&
          absorbed.every((item) => item.status === 'archived');
        if (!unchanged) {
          for (const target of [change, ...change.absorbed]) {
            const candidate = original(target);
            if (
              candidate.status !== 'published' ||
              codeMultipartOriginalRevision(candidate) !== target.expectedRevision
            )
              throw new MultipartRepairConflict('An original changed after review.');
            if (
              candidate._count.attempts ||
              candidate._count.progress ||
              candidate._count.classSessionItems ||
              (candidate.id !== row.id && candidate._count.forumPosts)
            )
              throw new MultipartRepairConflict(
                'An original has history that needs a separate migration.',
              );
          }
        }
        if (absorbed.some((item) => item.chapterId !== row.chapterId))
          throw new MultipartRepairConflict('Consolidated originals must be in the same chapter.');
        return {
          row,
          absorbed,
          change,
          dedupeKey,
          unchanged,
          revision,
          sourceMeta: source.success ? source.data : {},
        };
      });
      const keys = plans.map((plan) => plan.dedupeKey);
      const existing = await tx.notebookProblem.findMany({
        where: { courseId, dedupeKey: { in: keys } },
        select: { id: true, dedupeKey: true },
      });
      if (
        new Set(keys).size !== keys.length ||
        existing.some((row) =>
          plans.some((plan) => plan.dedupeKey === row.dedupeKey && plan.row.id !== row.id),
        )
      )
        throw new MultipartRepairConflict('The update would duplicate another question.');
      const snapshot = createHash('sha256')
        .update(
          JSON.stringify([
            courseId,
            preflightActor,
            changes.map(({ id, expectedRevision, absorbed }, index) => [
              id,
              expectedRevision,
              absorbed,
              plans[index].revision.fingerprint,
            ]),
          ]),
        )
        .digest('hex');
      const pendingPlans = plans.filter((plan) => !plan.unchanged);
      if (apply && reviewHash !== snapshot)
        throw new MultipartRepairConflict('Apply requires the matching preview hash.');
      if (apply && pendingPlans.length) {
        const now = new Date();
        for (const plan of pendingPlans) {
          const { draft } = plan.change;
          await tx.notebookProblem.update({
            where: { id: plan.row.id },
            data: {
              title: draft.title,
              type: 'multipart',
              publicContentJson: toPrismaJson(draft.publicContent),
              gradingJson: toPrismaJson(draft.grading),
              sourceMeta: toPrismaJson({ ...plan.sourceMeta, codeMultipartUpdate: plan.revision }),
              dedupeKey: plan.dedupeKey,
              contentUpdatedAt: now,
              secret: {
                upsert: {
                  create: { secretJudgeJson: toPrismaJson(draft.secretJudge) },
                  update: { secretJudgeJson: toPrismaJson(draft.secretJudge) },
                },
              },
            },
          });
          if (plan.absorbed.length)
            await tx.notebookProblem.updateMany({
              where: { id: { in: plan.absorbed.map((item) => item.id) } },
              data: { status: 'archived' },
            });
        }
        const { contentVersion } = await tx.course.update({
          where: { id: courseId },
          data: { contentVersion: { increment: 1 }, lastReleasedAt: now },
          select: { contentVersion: true },
        });
        const updatedIds = pendingPlans.map(({ row }) => row.id);
        await tx.$executeRaw`
          UPDATE "NotebookProblem"
          SET "releaseUpdatedIn" = ${contentVersion}, "releasedHash" = ${problemFingerprintSql}
          WHERE "courseId" = ${courseId} AND "id" = ANY(${updatedIds}::text[])
        `;
        await refreshCourseSummaryFields(tx, courseId);
      }
      return {
        mode: apply ? 'applied' : 'preview',
        courseId,
        reviewHash: snapshot,
        changes: plans.map(({ row, absorbed, revision, unchanged }) => ({
          id: row.id,
          originalTitle: row.title,
          chapterId: row.chapterId,
          order: row.order,
          fingerprint: revision.fingerprint,
          absorbedIds: absorbed.map((item) => item.id),
          unchanged,
        })),
      };
    },
    { timeout: 30000 },
  );
}
