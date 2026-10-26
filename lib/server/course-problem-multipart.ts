import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { Prisma, PrismaClient } from '@/lib/server/generated-prisma';
import {
  notebookProblemPublicMultipartSchema,
  notebookProblemGradingMultipartSchema,
  notebookProblemImportDraftSchema,
} from '@/lib/problem-bank/schema';
import { problemContentReadinessErrors } from '@/lib/problem-bank/content-readiness';
import { courseProblemDedupeKey } from '@/features/problems/domain/problem-dedupe';
import { courseProblemRevision } from './admin-course-problem-upload';

export const courseProblemMultipartSchema = z
  .object({
    apply: z.boolean().default(false),
    reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    changes: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(200),
            expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
            publicContent: notebookProblemPublicMultipartSchema,
            grading: notebookProblemGradingMultipartSchema,
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.changes.map((c) => c.id)).size !== value.changes.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate problem IDs.' });
  });
export class MultipartRepairConflict extends Error {}
const canonical = (value: unknown): string =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? `[${value.map(canonical).join(',')}]`
      : `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(',')}}`
    : (JSON.stringify(value) ?? 'null');
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/** Explicitly reviewed, in-place structural repair. No attempt/progress or notebook writes. */
export async function repairCourseMultipart(db: PrismaClient, courseId: string, input: unknown) {
  const data = courseProblemMultipartSchema.parse(input);
  return db.$transaction(
    async (tx) => {
      const rows = await tx.notebookProblem.findMany({
        where: { courseId, id: { in: data.changes.map((c) => c.id) } },
        select: {
          id: true,
          courseId: true,
          title: true,
          type: true,
          status: true,
          difficulty: true,
          ownerId: true,
          publicContentJson: true,
          gradingJson: true,
          sourceMeta: true,
          updatedAt: true,
          points: true,
        },
      });
      const byId = new Map(rows.map((r) => [r.id, r]));
      const planned = data.changes.map((change) => {
        const row = byId.get(change.id);
        if (!row || row.ownerId !== null || row.status === 'archived')
          throw new MultipartRepairConflict(
            'A selected public problem is no longer available in this course.',
          );
        const unchanged =
          row.type === 'multipart' &&
          canonical(row.publicContentJson) === canonical(change.publicContent) &&
          canonical(row.gradingJson) === canonical(change.grading);
        if (!unchanged && courseProblemRevision(row) !== change.expectedRevision)
          throw new MultipartRepairConflict('A selected problem changed after review.');
        if (!['proof', 'short_answer', 'calculation', 'multipart'].includes(row.type))
          throw new MultipartRepairConflict(
            'Only open-response questions can be structurally repaired.',
          );
        const labels = change.publicContent.parts.map((p) => p.label);
        if (
          labels.length < 2 ||
          new Set(labels).size !== labels.length ||
          change.grading.parts.length !== labels.length
        )
          throw new MultipartRepairConflict('Every distinct part must have matching grading.');
        const gradingByLabel = new Map(change.grading.parts.map((p) => [p.label, p.grading]));
        for (const [index, part] of change.publicContent.parts.entries()) {
          const g = gradingByLabel.get(part.label);
          if (
            !g ||
            g.type !== part.content.type ||
            !part.points ||
            part.dependsOn?.some((d) => !labels.slice(0, index).includes(d))
          )
            throw new MultipartRepairConflict('Invalid part grading, points or dependency.');
          const complete =
            g.type === 'proof'
              ? g.referenceProof
              : g.type === 'short_answer'
                ? g.referenceAnswer
                : g.type === 'calculation'
                  ? g.referenceAnswer || g.acceptedForms.length
                  : g.type === 'choice'
                    ? g.correctOptionIds.length
                    : g.blanks.every((b) => b.acceptedAnswers.length);
          if (!complete) throw new MultipartRepairConflict('Every part needs a reference answer.');
        }
        const draft = notebookProblemImportDraftSchema.parse({
          draftId: row.id,
          title: row.title,
          type: 'multipart',
          status: row.status,
          source: 'manual',
          points: row.points,
          difficulty: row.difficulty,
          publicContent: change.publicContent,
          grading: change.grading,
          validationErrors: [],
        });
        const errors = problemContentReadinessErrors(draft);
        if (errors.length) throw new MultipartRepairConflict(errors.join('; '));
        return {
          row,
          change,
          unchanged,
          dedupeKey: courseProblemDedupeKey({
            title: row.title,
            type: 'multipart',
            publicContent: change.publicContent,
          }),
        };
      });
      if (new Set(planned.map((p) => p.dedupeKey)).size !== planned.length)
        throw new MultipartRepairConflict('Repair would introduce duplicate questions.');
      let updated = 0;
      if (data.apply) {
        for (const p of planned) {
          if (p.unchanged) continue;
          const old =
            p.row.sourceMeta &&
            typeof p.row.sourceMeta === 'object' &&
            !Array.isArray(p.row.sourceMeta)
              ? p.row.sourceMeta
              : {};
          const written = await tx.notebookProblem.updateMany({
            where: { id: p.row.id, courseId, ownerId: null, updatedAt: p.row.updatedAt },
            data: {
              type: 'multipart',
              publicContentJson: json(p.change.publicContent),
              gradingJson: json(p.change.grading),
              dedupeKey: p.dedupeKey,
              contentUpdatedAt: new Date(),
              sourceMeta: json({
                ...old,
                multipartRepair: {
                  version: 1,
                  reviewHash: data.reviewHash,
                  previousRevision: p.change.expectedRevision,
                  parts: p.change.publicContent.parts.map((v) => v.label),
                  sourceDigest: createHash('sha256')
                    .update(canonical(p.row.publicContentJson))
                    .digest('hex'),
                },
              }),
            },
          });
          if (written.count !== 1)
            throw new MultipartRepairConflict('Concurrent problem update; no changes applied.');
          updated++;
        }
        if (updated)
          await tx.course.update({
            where: { id: courseId },
            data: { contentVersion: { increment: 1 } },
          });
      }
      return {
        courseId,
        mode: data.apply ? 'applied' : 'preview',
        count: planned.length,
        parts: planned.reduce((n, p) => n + p.change.publicContent.parts.length, 0),
        updated,
        unchanged: planned.filter((p) => p.unchanged).length,
        ids: planned.map((p) => p.row.id),
      };
    },
    { timeout: 60000 },
  );
}
