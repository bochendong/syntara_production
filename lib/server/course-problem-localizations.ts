import { z } from 'zod';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { courseProblemRevision } from './admin-course-problem-upload';
import { notebookProblemLocalizedContentSchema } from '@/lib/problem-bank/schema';

const translation = notebookProblemLocalizedContentSchema
  .extend({
    title: z.string().trim().min(1).max(200),
    chapterName: z.string().trim().min(1).max(200),
    stem: z.string().trim().min(1).max(16000),
  })
  .strict();
export const courseProblemLocalizationsSchema = z
  .object({
    changes: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(200),
            expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
            content: translation,
          })
          .strict(),
      )
      .min(1)
      .max(200),
    apply: z.boolean().default(false),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (new Set(value.changes.map((change) => change.id)).size !== value.changes.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate problem IDs.' });
  });

const select = {
  id: true,
  courseId: true,
  title: true,
  type: true,
  status: true,
  difficulty: true,
  publicContentJson: true,
  gradingJson: true,
  sourceMeta: true,
  updatedAt: true,
  chapter: { select: { name: true } },
} as const;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const stable = (value: unknown): string =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? `[${value.map(stable).join(',')}]`
      : `{${Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => JSON.stringify(key) + ':' + stable(item))
          .join(',')}}`
    : (JSON.stringify(value) ?? 'null');

export class ProblemLocalizationConflict extends Error {}

export async function readCourseProblemLocalizations(db: PrismaClient, courseId: string) {
  const rows = await db.notebookProblem.findMany({
    where: { courseId },
    select,
    orderBy: { id: 'asc' },
  });
  return {
    courseId,
    problems: rows.map((row) => ({
      id: row.id,
      title: row.title,
      chapterName: row.chapter?.name ?? null,
      revision: courseProblemRevision(row),
      publicContent: row.publicContentJson,
    })),
  };
}

/** Only zh-CN presentation may change; published questions and learner history stay intact. */
export async function updateCourseProblemLocalizations(
  db: PrismaClient,
  courseId: string,
  input: z.infer<typeof courseProblemLocalizationsSchema>,
) {
  const data = courseProblemLocalizationsSchema.parse(input);
  return db.$transaction(
    async (tx) => {
      const rows = await tx.notebookProblem.findMany({
        where: { courseId, id: { in: data.changes.map((c) => c.id) } },
        select,
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const planned = data.changes.map((change) => {
        const row = byId.get(change.id);
        if (!row)
          throw new ProblemLocalizationConflict('A problem no longer belongs to this course.');
        const content = record(row.publicContentJson);
        const translations = record(content.translations);
        const unchanged = stable(translations['zh-CN']) === stable(change.content);
        if (!unchanged && courseProblemRevision(row) !== change.expectedRevision)
          throw new ProblemLocalizationConflict(
            'A problem changed after review; download and review again.',
          );
        const baseOptions = Array.isArray(content.options) ? content.options.map(record) : [];
        if (
          row.type === 'choice' &&
          (change.content.options?.length !== baseOptions.length ||
            baseOptions.some((option, index) => change.content.options?.[index]?.id !== option.id))
        )
          throw new ProblemLocalizationConflict(
            'Translations must preserve every option ID and its order.',
          );
        if (row.type !== 'choice' && change.content.options?.length)
          throw new ProblemLocalizationConflict(
            'Only choice questions may have translated options.',
          );
        return {
          row,
          unchanged,
          publicContent: { ...content, translations: { ...translations, 'zh-CN': change.content } },
        };
      });
      let updated = 0;
      if (data.apply) {
        for (const item of planned) {
          if (item.unchanged) continue;
          const result = await tx.notebookProblem.updateMany({
            where: { id: item.row.id, courseId, updatedAt: item.row.updatedAt },
            data: {
              publicContentJson: JSON.parse(JSON.stringify(item.publicContent)),
              contentUpdatedAt: new Date(),
            },
          });
          if (result.count !== 1)
            throw new ProblemLocalizationConflict('Concurrent problem update; no changes applied.');
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
        updated,
        unchanged: planned.filter((item) => item.unchanged).length,
      };
    },
    { timeout: 60000 },
  );
}
