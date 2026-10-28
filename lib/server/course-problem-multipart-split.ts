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
import { MultipartRepairConflict } from './course-problem-multipart';

const groupSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    localizedTitles: z
      .object({
        'en-US': z.string().trim().min(1).max(200).optional(),
        'zh-CN': z.string().trim().min(1).max(200).optional(),
      })
      .strict()
      .optional(),
    publicContent: notebookProblemPublicMultipartSchema,
    grading: notebookProblemGradingMultipartSchema,
  })
  .strict();
export const multipartGroupSplitSchema = z
  .object({
    apply: z.boolean().default(false),
    reviewHash: z.string().regex(/^[a-f0-9]{64}$/),
    changes: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(200),
            expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
            sourceLabels: z.array(z.string().trim().min(1).max(40)).min(4).max(36),
            groups: z.array(groupSchema).min(2).max(3),
          })
          .strict(),
      )
      .min(1)
      .max(20),
  })
  .strict();
const canonical = (v: unknown): string =>
  v && typeof v === 'object'
    ? Array.isArray(v)
      ? `[${v.map(canonical).join(',')}]`
      : `{${Object.entries(v)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
          .join(',')}}`
    : (JSON.stringify(v) ?? 'null');
const digest = (v: unknown) => createHash('sha256').update(canonical(v)).digest('hex');
const record = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const json = (v: unknown) => JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
export const splitGroupId = (courseId: string, sourceId: string, index: number) =>
  `mpg_${digest([courseId, sourceId]).slice(0, 28)}_${index + 1}`;

/** Reviewed regrouping: retain the complete source and learner history on an archived original. */
export async function splitCourseMultipartGroups(
  db: PrismaClient,
  courseId: string,
  input: unknown,
) {
  const data = multipartGroupSplitSchema.parse(input);
  if (new Set(data.changes.map((c) => c.id)).size !== data.changes.length)
    throw new MultipartRepairConflict('Duplicate original question IDs.');
  return db.$transaction(
    async (tx) => {
      const course = await tx.course.findUnique({ where: { id: courseId }, select: { id: true } });
      if (!course) throw new MultipartRepairConflict('Course not found.');
      const originals = await tx.notebookProblem.findMany({
        where: { courseId, id: { in: data.changes.map((c) => c.id) } },
      });
      const byId = new Map(originals.map((p) => [p.id, p]));
      const planned = [];
      for (const change of data.changes) {
        const old = byId.get(change.id);
        if (
          !old ||
          old.ownerId !== null ||
          !['proof', 'short_answer', 'calculation', 'multipart'].includes(old.type)
        )
          throw new MultipartRepairConflict(
            'Original public open-response question is unavailable.',
          );
        const labels = change.groups.flatMap((g) => g.publicContent.parts.map((p) => p.label));
        if (
          new Set(labels).size !== labels.length ||
          new Set(change.sourceLabels).size !== change.sourceLabels.length ||
          canonical(labels) !== canonical(change.sourceLabels)
        )
          throw new MultipartRepairConflict(
            'Every source part must occur exactly once and in source order.',
          );
        const planHash = digest({
          reviewHash: data.reviewHash,
          groups: change.groups,
          sourceLabels: change.sourceLabels,
        });
        const ids = change.groups.map((_, index) => splitGroupId(courseId, old.id, index));
        const existing = await tx.notebookProblem.findMany({
          where: { courseId, id: { in: ids } },
        });
        const previous = record(record(old.sourceMeta).multipartSplit);
        const unchanged =
          old.status === 'archived' &&
          previous.planHash === planHash &&
          existing.length === ids.length &&
          existing.every((p) => {
            const i = ids.indexOf(p.id),
              g = change.groups[i];
            return (
              p.ownerId === null &&
              p.status !== 'archived' &&
              p.title === g.title &&
              p.type === 'multipart' &&
              Object.entries(g.localizedTitles ?? {}).every(
                ([locale, title]) =>
                  record(record(record(p.sourceMeta).translations)[locale]).title === title,
              ) &&
              canonical(p.publicContentJson) === canonical(g.publicContent) &&
              canonical(p.gradingJson) === canonical(g.grading)
            );
          });
        if (
          !unchanged &&
          (old.status === 'archived' ||
            courseProblemRevision(old) !== change.expectedRevision ||
            existing.length)
        )
          throw new MultipartRepairConflict('Original or replacement group changed after review.');
        for (const g of change.groups) {
          const partLabels = g.publicContent.parts.map((p) => p.label),
            grades = new Map(g.grading.parts.map((p) => [p.label, p.grading]));
          if (partLabels.length < 2 || g.grading.parts.length !== partLabels.length)
            throw new MultipartRepairConflict('Every group needs complete part grading.');
          for (const [index, p] of g.publicContent.parts.entries()) {
            const grading = grades.get(p.label);
            if (
              !grading ||
              grading.type !== p.content.type ||
              p.points <= 0 ||
              p.dependsOn?.some((label) => !partLabels.slice(0, index).includes(label))
            )
              throw new MultipartRepairConflict('Invalid points, reference or dependency.');
            const answer =
              grading.type === 'proof'
                ? grading.referenceProof
                : grading.type === 'short_answer'
                  ? grading.referenceAnswer
                  : grading.type === 'calculation'
                    ? grading.referenceAnswer || grading.acceptedForms.length
                    : grading.type === 'choice'
                      ? grading.correctOptionIds.length
                      : grading.type === 'table'
                        ? grading.cells.length > 0 &&
                          grading.cells.every((cell) => cell.acceptedAnswers.length || cell.check)
                        : grading.type === 'code'
                          ? Boolean(
                              grading.solutionCode ||
                              grading.referenceAnswer ||
                              grading.solutionSlots,
                            )
                          : grading.blanks.every((b) => b.acceptedAnswers.length);
            if (!answer) throw new MultipartRepairConflict('Every part needs a reference answer.');
          }
          const draft = notebookProblemImportDraftSchema.parse({
            draftId: old.id,
            title: g.title,
            type: 'multipart',
            status: old.status === 'archived' ? 'published' : old.status,
            source: old.source,
            points: old.points,
            tags: old.tags,
            difficulty: old.difficulty,
            publicContent: g.publicContent,
            grading: g.grading,
            validationErrors: [],
          });
          const errors = problemContentReadinessErrors(draft);
          if (errors.length) throw new MultipartRepairConflict(errors.join('; '));
        }
        planned.push({ old, change, ids, planHash, unchanged });
      }
      const keys = planned.flatMap((p) =>
        p.change.groups.map((g) =>
          courseProblemDedupeKey({
            title: g.title,
            type: 'multipart',
            publicContent: g.publicContent,
          }),
        ),
      );
      if (new Set(keys).size !== keys.length)
        throw new MultipartRepairConflict('Duplicate replacement groups.');
      const collisions = await tx.notebookProblem.findMany({
        where: {
          courseId,
          ownerId: null,
          dedupeKey: { in: keys },
          id: { notIn: planned.flatMap((p) => p.ids) },
        },
        select: { id: true },
      });
      if (collisions.length)
        throw new MultipartRepairConflict('A replacement group already exists under another ID.');
      let created = 0,
        archived = 0;
      if (data.apply && planned.some((p) => !p.unchanged)) {
        // Serialize course numbering with this content write. The transaction rolls back on any failure.
        await tx.course.update({
          where: { id: courseId },
          data: { contentVersion: { increment: 1 } },
        });
        const max = await tx.notebookProblem.aggregate({
          where: { courseId, ownerId: null },
          _max: { problemNumber: true },
        });
        let number = max._max.problemNumber ?? 0;
        for (const p of planned) {
          if (p.unchanged) continue;
          for (const [index, g] of p.change.groups.entries()) {
            await tx.notebookProblem.create({
              data: {
                id: p.ids[index],
                courseId,
                notebookId: p.old.notebookId,
                chapterId: p.old.chapterId,
                ownerId: null,
                title: g.title,
                type: 'multipart',
                status: p.old.status,
                source: p.old.source,
                order: p.old.order,
                problemNumber: ++number,
                points: p.old.points,
                tags: p.old.tags,
                difficulty: p.old.difficulty,
                publicContentJson: json(g.publicContent),
                gradingJson: json(g.grading),
                dedupeKey: courseProblemDedupeKey({
                  title: g.title,
                  type: 'multipart',
                  publicContent: g.publicContent,
                }),
                sourceMeta: json({
                  ...record(p.old.sourceMeta),
                  translations: {
                    ...record(record(p.old.sourceMeta).translations),
                    ...Object.fromEntries(
                      Object.entries(g.localizedTitles ?? { 'en-US': g.title }).map(
                        ([locale, title]) => [
                          locale,
                          {
                            ...record(record(record(p.old.sourceMeta).translations)[locale]),
                            title,
                          },
                        ],
                      ),
                    ),
                  },
                  multipartSplitFrom: {
                    originalId: p.old.id,
                    originalProblemNumber: p.old.problemNumber,
                    reviewHash: data.reviewHash,
                    planHash: p.planHash,
                    group: index + 1,
                    groups: p.change.groups.length,
                    sourceLabels: g.publicContent.parts.map((v) => v.label),
                  },
                }),
                contentUpdatedAt: new Date(),
                createdAt: new Date(Date.now() + index),
              },
            });
            created++;
          }
          const result = await tx.notebookProblem.updateMany({
            where: {
              id: p.old.id,
              courseId,
              ownerId: null,
              status: p.old.status,
              updatedAt: p.old.updatedAt,
            },
            data: {
              status: 'archived',
              sourceMeta: json({
                ...record(p.old.sourceMeta),
                multipartSplit: {
                  version: 1,
                  planHash: p.planHash,
                  reviewHash: data.reviewHash,
                  replacementIds: p.ids,
                  sourceLabels: p.change.sourceLabels,
                },
              }),
            },
          });
          if (result.count !== 1)
            throw new MultipartRepairConflict('Concurrent original update; no split applied.');
          archived++;
        }
      }
      return {
        courseId,
        mode: data.apply ? 'applied' : 'preview',
        originals: planned.length,
        groups: planned.reduce((n, p) => n + p.ids.length, 0),
        parts: planned.reduce((n, p) => n + p.change.sourceLabels.length, 0),
        created,
        archived,
        unchanged: planned.filter((p) => p.unchanged).length,
        replacements: planned.map((p) => ({
          originalId: p.old.id,
          ids: p.ids,
          labels: p.change.sourceLabels,
        })),
      };
    },
    { timeout: 60000, isolationLevel: 'Serializable' },
  );
}
