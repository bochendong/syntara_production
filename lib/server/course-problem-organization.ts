import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '@/lib/server/generated-prisma';

const id = z.string().trim().min(1).max(200);
const version = z.string().datetime({ precision: 3 });
export const courseProblemOrganizationSchema = z
  .object({
    courseId: id,
    expectedContentVersion: z.number().int().min(1),
    chapters: z
      .array(
        z
          .object({
            id,
            name: z.string().trim().min(1).max(160),
            description: z.string().trim().max(2000),
            position: z.number().int().min(0),
            expectedUpdatedAt: version,
          })
          .strict(),
      )
      .min(1)
      .max(200),
    retiredChapters: z.array(z.object({ id, expectedUpdatedAt: version }).strict()).max(200),
    questions: z
      .array(
        z
          .object({
            id,
            chapterId: id.nullable(),
            order: z.number().int().min(0),
            problemNumber: z.number().int().min(1),
            status: z.enum(['draft', 'published', 'archived']),
            expectedUpdatedAt: version,
          })
          .strict(),
      )
      .min(1)
      .max(3000),
  })
  .strict();

type Organization = z.infer<typeof courseProblemOrganizationSchema>;
type Tx = Prisma.TransactionClient;
export class CourseProblemOrganizationError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}
function requireValue(value: unknown, status: 400 | 404 | 409, message: string): asserts value {
  if (!value) throw new CourseProblemOrganizationError(status, message);
}
function sameIds(left: string[], right: string[]) {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}
function validatePlan(data: Organization) {
  const chapterIds = data.chapters.map((c) => c.id);
  const allChapterIds = [...chapterIds, ...data.retiredChapters.map((c) => c.id)];
  requireValue(
    new Set(allChapterIds).size === allChapterIds.length,
    400,
    'Chapter IDs must be unique.',
  );
  requireValue(
    new Set(data.chapters.map((c) => c.name)).size === data.chapters.length,
    400,
    'Chapter names must be unique.',
  );
  requireValue(
    sameIds(
      data.chapters.map((c) => String(c.position)),
      data.chapters.map((_, i) => String(i)),
    ),
    400,
    'Chapter positions must be consecutive.',
  );
  requireValue(
    new Set(data.questions.map((q) => q.id)).size === data.questions.length,
    400,
    'Question IDs must be unique.',
  );
  requireValue(
    sameIds(
      data.questions.map((q) => String(q.order)),
      data.questions.map((_, i) => String(i)),
    ),
    400,
    'Question order must be consecutive.',
  );
  requireValue(
    sameIds(
      data.questions.map((q) => String(q.problemNumber)),
      data.questions.map((_, i) => String(i + 1)),
    ),
    400,
    'Question numbers must be consecutive.',
  );
  requireValue(
    data.questions.every((q) => q.chapterId === null || chapterIds.includes(q.chapterId)),
    400,
    'Questions must use a retained chapter.',
  );
}
async function readState(tx: Tx, userId: string, courseId: string) {
  const course = await tx.course.findUnique({
    where: { id: courseId },
    select: { id: true, ownerId: true, contentVersion: true, updatedAt: true },
  });
  requireValue(course?.ownerId === userId, 404, 'Course not found.');
  const chapters = await tx.courseProblemChapter.findMany({
    where: { courseId },
    orderBy: { id: 'asc' },
    select: { id: true, name: true, description: true, position: true, updatedAt: true },
  });
  const questions = await tx.notebookProblem.findMany({
    where: { courseId, ownerId: null },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      chapterId: true,
      status: true,
      order: true,
      problemNumber: true,
      updatedAt: true,
    },
  });
  const drafts = await tx.courseContentDraft.count({ where: { courseId } });
  return { course, chapters, questions, drafts };
}
type State = Awaited<ReturnType<typeof readState>>;
function matches(state: State, data: Organization) {
  return (
    state.chapters.length === data.chapters.length &&
    state.questions.length === data.questions.length &&
    data.chapters.every((c) =>
      state.chapters.some(
        (s) =>
          s.id === c.id &&
          s.name === c.name &&
          (s.description ?? '') === c.description &&
          s.position === c.position,
      ),
    ) &&
    data.questions.every((q) =>
      state.questions.some(
        (s) =>
          s.id === q.id &&
          s.status === q.status &&
          s.chapterId === q.chapterId &&
          s.order === q.order &&
          s.problemNumber === q.problemNumber,
      ),
    )
  );
}
async function preservationHashes(tx: Tx, courseId: string) {
  const [row] = await tx.$queryRaw<Array<{ questions: string; secrets: string; tags: string }>>`
    SELECT
      md5(COALESCE(jsonb_agg(to_jsonb(p) - ARRAY['chapterId','order','problemNumber','updatedAt','releaseUpdatedIn']::text[] ORDER BY p."id")::text, '[]')) AS questions,
      (SELECT md5(COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s."problemId")::text, '[]'))
        FROM "NotebookProblemSecret" s JOIN "NotebookProblem" q ON q."id" = s."problemId"
        WHERE q."courseId" = ${courseId} AND q."ownerId" IS NULL) AS secrets,
      (SELECT md5(COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t."problemId", t."tagId")::text, '[]'))
        FROM "NotebookProblemTagAssignment" t JOIN "NotebookProblem" q ON q."id" = t."problemId"
        WHERE q."courseId" = ${courseId} AND q."ownerId" IS NULL) AS tags
    FROM "NotebookProblem" p WHERE p."courseId" = ${courseId} AND p."ownerId" IS NULL
  `;
  return row;
}

/** Metadata only: this path never normalizes questions, runs a grader, or replaces learner records. */
export async function organizeCourseProblems(
  db: PrismaClient,
  userId: string,
  input: unknown,
  mode: 'preview' | 'commit',
  expectedHash?: string,
) {
  const data = courseProblemOrganizationSchema.parse(input);
  validatePlan(data);
  return db.$transaction(
    async (tx) => {
      if (mode === 'preview') await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      else {
        // The same course lock used by content drafts serializes author edits and releases.
        await tx.$queryRaw`SELECT "id" FROM "Course" WHERE "id" = ${data.courseId} FOR UPDATE`;
      }
      const state = await readState(tx, userId, data.courseId);
      requireValue(state.drafts === 0, 409, 'Reconcile pending course drafts before reorganizing.');
      if (state.course.contentVersion === data.expectedContentVersion + 1 && matches(state, data))
        return {
          status: 'unchanged' as const,
          version: state.course.contentVersion,
          questionCount: data.questions.length,
          chapterCount: data.chapters.length,
        };
      requireValue(
        state.course.contentVersion === data.expectedContentVersion,
        409,
        'Course version changed.',
      );
      requireValue(
        sameIds(
          state.chapters.map((c) => c.id),
          [...data.chapters, ...data.retiredChapters].map((c) => c.id),
        ),
        409,
        'Include every current chapter exactly once.',
      );
      requireValue(
        sameIds(
          state.questions.map((q) => q.id),
          data.questions.map((q) => q.id),
        ),
        409,
        'Include every public question exactly once.',
      );
      for (const chapter of [...data.chapters, ...data.retiredChapters])
        requireValue(
          state.chapters.find((c) => c.id === chapter.id)?.updatedAt.toISOString() ===
            chapter.expectedUpdatedAt,
          409,
          'A chapter changed.',
        );
      for (const question of data.questions) {
        const current = state.questions.find((q) => q.id === question.id);
        requireValue(
          current?.updatedAt.toISOString() === question.expectedUpdatedAt &&
            current.status === question.status,
          409,
          'A question changed.',
        );
      }
      const hash = createHash('sha256').update(JSON.stringify({ data, state })).digest('hex');
      const summary = {
        questionCount: data.questions.length,
        chapterCount: data.chapters.length,
        retiredChapterCount: data.retiredChapters.length,
      };
      if (mode === 'preview') return { status: 'preview' as const, expectedHash: hash, ...summary };
      requireValue(
        expectedHash === hash,
        409,
        'Preview changed; review a fresh preview before saving.',
      );
      const before = await preservationHashes(tx, data.courseId);
      const now = new Date();
      const nextVersion = state.course.contentVersion + 1;
      // Temporary names allow an owner to swap chapter names without transient unique conflicts.
      for (const chapter of [...data.chapters, ...data.retiredChapters]) {
        const current = state.chapters.find((c) => c.id === chapter.id)!;
        if (!('name' in chapter) || current.name !== chapter.name)
          await tx.courseProblemChapter.update({
            where: { id: chapter.id },
            data: { name: `__organization_${hash.slice(0, 16)}_${chapter.id}`.slice(0, 160) },
          });
      }
      for (const chapter of data.chapters)
        await tx.courseProblemChapter.update({
          where: { id: chapter.id },
          data: {
            name: chapter.name,
            description: chapter.description || null,
            position: chapter.position,
            updatedAt: now,
          },
        });
      for (const question of data.questions) {
        const saved = await tx.notebookProblem.updateMany({
          where: {
            id: question.id,
            courseId: data.courseId,
            ownerId: null,
            status: question.status,
            updatedAt: new Date(question.expectedUpdatedAt),
          },
          data: {
            chapterId: question.chapterId,
            order: question.order,
            problemNumber: question.problemNumber,
            updatedAt: now,
            ...(question.status === 'published' ? { releaseUpdatedIn: nextVersion } : {}),
          },
        });
        requireValue(saved.count === 1, 409, 'A question changed while saving.');
      }
      for (const chapter of data.retiredChapters) {
        requireValue(
          (await tx.notebookProblem.count({ where: { chapterId: chapter.id } })) === 0,
          409,
          'A retired chapter is still referenced.',
        );
        await tx.courseProblemChapter.delete({ where: { id: chapter.id } });
      }
      await tx.course.update({
        where: { id: data.courseId },
        data: { contentVersion: nextVersion, lastReleasedAt: now },
      });
      const after = await readState(tx, userId, data.courseId);
      requireValue(matches(after, data), 409, 'Organization readback failed.');
      requireValue(
        JSON.stringify(await preservationHashes(tx, data.courseId)) === JSON.stringify(before),
        409,
        'Question content preservation check failed.',
      );
      return {
        status: 'committed' as const,
        version: nextVersion,
        preservedQuestionContentsAndSecrets: true,
        ...summary,
      };
    },
    { isolationLevel: 'Serializable', timeout: 60000, maxWait: 15000 },
  );
}
