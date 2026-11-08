import { z } from 'zod';
import type { PrismaClient } from '@/lib/server/generated-prisma';

export const courseProblemTagUpdatesSchema = z
  .object({
    changes: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(200),
            expectedUpdatedAt: z.string().datetime({ precision: 3 }),
            tags: z
              .array(z.string().trim().min(1).max(30))
              .max(16)
              .refine((tags) => new Set(tags).size === tags.length, 'Duplicate tags.'),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .refine(
        (changes) => new Set(changes.map((change) => change.id)).size === changes.length,
        'Duplicate problem IDs.',
      ),
    apply: z.boolean().default(false),
  })
  .strict();

export class CourseProblemTagUpdateConflict extends Error {}

/** Administrator-only caller; paper metadata must not normalize or regrade existing content. */
export async function updateCourseProblemTags(db: PrismaClient, courseId: string, input: unknown) {
  const data = courseProblemTagUpdatesSchema.parse(input);
  return db.$transaction(async (tx) => {
    const rows = await tx.notebookProblem.findMany({
      where: {
        courseId,
        ownerId: null,
        status: { not: 'archived' },
        id: { in: data.changes.map((change) => change.id) },
      },
      select: { id: true, tags: true, updatedAt: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const planned = data.changes.map((change) => {
      const row = byId.get(change.id);
      if (!row) throw new CourseProblemTagUpdateConflict('Question is not in this shared bank.');
      const unchanged = JSON.stringify(row.tags) === JSON.stringify(change.tags);
      if (!unchanged && row.updatedAt.toISOString() !== change.expectedUpdatedAt)
        throw new CourseProblemTagUpdateConflict('Question changed after review.');
      return { change, row, unchanged };
    });
    let updated = 0;
    if (data.apply) {
      for (const { change, row, unchanged } of planned) {
        if (unchanged) continue;
        const result = await tx.notebookProblem.updateMany({
          where: { id: row.id, courseId, ownerId: null, updatedAt: row.updatedAt },
          data: { tags: change.tags, contentUpdatedAt: new Date() },
        });
        if (result.count !== 1)
          throw new CourseProblemTagUpdateConflict('Concurrent question edit; no changes applied.');
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
      unchanged: planned.filter((change) => change.unchanged).length,
    };
  });
}
