import { z } from 'zod';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { resolveReadableStudyMemoryTarget } from '@/lib/server/study-memory-store';
import { calendarEventKindSchema } from '@/features/learning-calendar/server/contracts';

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  });
export const nativeCalendarMutationSchema = z.object({
  courseId: z.string().min(1).max(200),
  cursor: z.string().max(200).optional(),
  changes: z
    .array(
      z
        .object({
          id: z.string().min(1).max(200),
          deleted: z.boolean().default(false),
          updatedAt: z.number().int().nonnegative(),
          event: z
            .object({
              createdAt: z.number().int().nonnegative().optional(),
              title: z.string().trim().min(1).max(500),
              date,
              note: z.string().max(3000),
              kind: calendarEventKindSchema,
              source: z.enum([
                'manual',
                'syllabus',
                'review-plan',
                'ai-proposal',
                'imported',
                'bundled',
              ]),
              status: z.enum(['active', 'completed', 'cancelled']),
            })
            .optional(),
        })
        .refine((change) => change.deleted || change.event !== undefined),
    )
    .max(50)
    .default([]),
});
export type NativeCalendarMutation = z.infer<typeof nativeCalendarMutationSchema>;

/** Same account/course rows used by the web calendar. A tombstone rejects all
 * edits from its old generation, including retries by an offline device. */
export async function syncNativeCalendar(
  prisma: PrismaClient,
  userId: string,
  input: NativeCalendarMutation,
) {
  if (!(await resolveReadableStudyMemoryTarget(prisma, userId, 'course', input.courseId)))
    return null;
  if (input.changes.length)
    await prisma.$transaction(
      async (tx) => {
        // Serialize app writes, including the first create. CAS below also protects
        // against changes from the existing web calendar, which doesn't take this lock.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`native-calendar:${userId}:${input.courseId}`}, 0))`;
        for (const change of input.changes) {
          const existing = await tx.learningCalendarEvent.findUnique({ where: { id: change.id } });
          if (existing && (existing.ownerId !== userId || existing.courseId !== input.courseId))
            throw new Error('Calendar event does not belong to this course.');
          const generationAt = Math.min(change.event?.createdAt ?? 0, Date.now());
          // A deliberate new generation (e.g. re-adding a review-plan task) may
          // reuse its stable ID. Edits/retries from the deleted generation cannot.
          if (
            existing?.deletedAt &&
            (change.deleted || generationAt <= existing.deletedAt.getTime())
          )
            continue;
          if (change.deleted && existing && change.updatedAt < existing.createdAt.getTime())
            continue;
          const at = new Date(Math.min(change.updatedAt, Date.now()));
          // Last edit wins; retrying an acknowledged write cannot move its timestamp.
          if (existing && existing.updatedAt.getTime() > at.getTime() && !change.deleted) continue;
          const event = change.event;
          const data = change.deleted
            ? {
                deletedAt: new Date(),
                status: 'skipped',
                updatedAt: new Date(),
              }
            : {
                title: event!.title,
                eventDate: new Date(`${event!.date}T00:00:00Z`),
                rawText: event!.note,
                kind: event!.kind,
                origin: event!.source === 'manual' ? 'manual' : 'ai_plan',
                sourceName: 'Syntara',
                status:
                  event!.status === 'completed'
                    ? 'done'
                    : event!.status === 'cancelled'
                      ? 'skipped'
                      : 'planned',
                updatedAt: at,
                ...(existing?.deletedAt
                  ? { deletedAt: null, createdAt: new Date(generationAt) }
                  : {}),
              };
          if (existing) {
            const result = await tx.learningCalendarEvent.updateMany({
              where: {
                id: existing.id,
                ownerId: userId,
                courseId: input.courseId,
                version: existing.version,
                deletedAt: existing.deletedAt,
              },
              data: { ...data, version: { increment: 1 } },
            });
            if (!result.count) throw new Error('日历刚刚被其他设备修改，请重试。');
          } else {
            await tx.learningCalendarEvent.create({
              data: {
                id: change.id,
                ownerId: userId,
                courseId: input.courseId,
                clientEventId: change.id,
                title: event?.title ?? '已删除日程',
                kind: event?.kind ?? 'other',
                eventDate: new Date(`${event?.date ?? '1970-01-01'}T00:00:00Z`),
                sourceName: 'Syntara',
                createdAt: new Date(generationAt || at.getTime()),
                ...data,
              },
            });
          }
        }
      },
      { maxWait: 10_000, timeout: 20_000 },
    );
  const rows = await prisma.learningCalendarEvent.findMany({
    where: { ownerId: userId, courseId: input.courseId },
    orderBy: { id: 'asc' },
    take: 501,
    ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
  });
  const page = rows.slice(0, 500);
  return {
    events: page
      .filter((row) => !row.deletedAt)
      .map((row) => ({
        id: row.id,
        courseId: input.courseId,
        title: row.title,
        date: row.eventDate.toISOString().slice(0, 10),
        note: row.rawText ?? [row.startTime, row.week, row.sourceName].filter(Boolean).join(' · '),
        kind: row.kind,
        source: row.origin === 'manual' ? 'manual' : 'imported',
        status:
          row.status === 'done' ? 'completed' : row.status === 'skipped' ? 'cancelled' : 'active',
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      })),
    deletedIds: page.filter((row) => row.deletedAt).map((row) => row.id),
    nextCursor: rows.length > 500 ? page.at(-1)!.id : null,
  };
}
