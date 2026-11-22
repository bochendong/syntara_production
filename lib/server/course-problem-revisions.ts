import { z } from 'zod';
import { courseProblemDedupeKey } from '../../features/problems/domain/problem-dedupe';
import {
  notebookProblemGradingChoiceSchema,
  notebookProblemPublicChoiceSchema,
} from '../problem-bank/schema';
import type { Prisma, PrismaClient } from './generated-prisma';
import { courseProblemRevision } from './admin-course-problem-upload';

const id = z.string().trim().min(1).max(200);
const identity = { id, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/) };
const display = z
  .object({
    ...identity,
    action: z.literal('display'),
    stem: z.string().min(1).max(16000).optional(),
    sections: z
      .array(
        z
          .object({
            id,
            body: z.string().min(1).max(16000).optional(),
            codeLanguage: z.literal('python').optional(),
          })
          .strict()
          .refine((section) => section.body !== undefined || section.codeLanguage !== undefined),
      )
      .min(1)
      .max(10)
      .optional(),
  })
  .strict();
const choice = z
  .object({
    ...identity,
    action: z.literal('convert-to-choice'),
    publicContent: notebookProblemPublicChoiceSchema,
    grading: notebookProblemGradingChoiceSchema,
  })
  .strict();
const archive = z.object({ ...identity, action: z.literal('archive') }).strict();
const schema = z
  .object({
    apply: z.boolean().default(false),
    changes: z
      .array(z.discriminatedUnion('action', [display, choice, archive]))
      .min(1)
      .max(100),
  })
  .strict()
  .refine(({ changes }) => new Set(changes.map((change) => change.id)).size === changes.length);

const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  const fields = record(value);
  return `{${Object.keys(fields)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable(fields[key])}`)
    .join(',')}}`;
};

export class CourseProblemRevisionConflict extends Error {}
function requireMatch(condition: unknown, message: string): asserts condition {
  if (!condition) throw new CourseProblemRevisionConflict(message);
}

function updateDisplay(content: Record<string, unknown>, change: z.infer<typeof display>) {
  requireMatch(
    change.stem !== undefined || change.sections !== undefined,
    'No display fields were supplied.',
  );
  let next = { ...content };
  if (change.stem !== undefined) {
    requireMatch(typeof content.stem === 'string', 'This question has no replaceable stem.');
    next.stem = change.stem;
  }
  if (change.sections) {
    requireMatch(
      content.type === 'code' && Array.isArray(content.statementSections),
      'Only existing code statement sections can be updated.',
    );
    const updates = new Map(change.sections.map(({ id, ...fields }) => [id, fields]));
    requireMatch(updates.size === change.sections.length, 'Section IDs must be unique.');
    const sections = content.statementSections.map(record).map((section) => {
      const fields = updates.get(String(section.id));
      if (!fields) return section;
      requireMatch(
        !fields.codeLanguage || typeof section.code === 'string',
        'The section has no code.',
      );
      updates.delete(String(section.id));
      return { ...section, ...fields };
    });
    requireMatch(updates.size === 0, 'A statement section was not found.');
    next = { ...next, statementSections: sections };
  }
  return next;
}

function validateChoice({ publicContent, grading }: z.infer<typeof choice>) {
  const ids = publicContent.options.map(({ id }) => id);
  const answers = grading.correctOptionIds;
  requireMatch(
    publicContent.selectionMode === 'single' &&
      answers.length === 1 &&
      ids.includes(answers[0]) &&
      new Set(ids).size === ids.length,
    'The replacement must have exactly one valid correct option.',
  );
  for (const locale of ['zh-CN', 'en-US'] as const) {
    const translated = publicContent.translations?.[locale];
    requireMatch(
      translated?.stem &&
        translated.options?.length === ids.length &&
        translated.options.every((option, index) => option.id === ids[index]),
      'Both locales must retain the same option IDs and order.',
    );
  }
}

/** Reviewed public-bank repairs leave question IDs, ownership, placement, and student rows intact. */
export async function reviseCourseProblems(db: PrismaClient, courseId: string, input: unknown) {
  const data = schema.parse(input);
  return db.$transaction(
    async (tx) => {
      const rows = await tx.notebookProblem.findMany({
        where: { courseId, ownerId: null, id: { in: data.changes.map(({ id }) => id) } },
        select: {
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
        },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      const planned = data.changes.map((change) => {
        const row = byId.get(change.id);
        requireMatch(row, 'A question is outside the shared course bank.');
        let patch: Prisma.NotebookProblemUpdateManyMutationInput;
        let unchanged = false;
        if (change.action === 'archive') {
          unchanged = row.status === 'archived';
          patch = { status: 'archived' };
        } else if (change.action === 'convert-to-choice') {
          validateChoice(change);
          unchanged =
            row.type === 'choice' &&
            stable(row.publicContentJson) === stable(change.publicContent) &&
            stable(row.gradingJson) === stable(change.grading);
          requireMatch(
            row.type === 'short_answer' || unchanged,
            'Only a short-answer question can be converted.',
          );
          patch = {
            type: 'choice',
            publicContentJson: change.publicContent as Prisma.InputJsonValue,
            gradingJson: change.grading as Prisma.InputJsonValue,
            dedupeKey: courseProblemDedupeKey({
              title: row.title,
              type: 'choice',
              publicContent: change.publicContent,
            }),
          };
        } else {
          const content = updateDisplay(record(row.publicContentJson), change);
          unchanged = stable(content) === stable(row.publicContentJson);
          patch = { publicContentJson: content as Prisma.InputJsonValue };
        }
        requireMatch(
          unchanged ||
            (row.status === 'published' && courseProblemRevision(row) === change.expectedRevision),
          'A published question changed after review.',
        );
        return { row, patch, unchanged };
      });
      let updated = 0;
      if (data.apply) {
        for (const { row, patch, unchanged } of planned) {
          if (unchanged) continue;
          const result = await tx.notebookProblem.updateMany({
            where: {
              id: row.id,
              courseId,
              ownerId: null,
              status: 'published',
              updatedAt: row.updatedAt,
            },
            data: { ...patch, contentUpdatedAt: new Date() },
          });
          requireMatch(result.count === 1, 'A question changed during the update.');
          updated++;
        }
        if (updated) {
          await tx.course.update({
            where: { id: courseId },
            data: { contentVersion: { increment: 1 } },
          });
        }
      }
      return {
        courseId,
        mode: data.apply ? 'applied' : 'preview',
        count: planned.length,
        updated,
        unchanged: planned.filter((item) => item.unchanged).length,
      };
    },
    { timeout: 60_000 },
  );
}
