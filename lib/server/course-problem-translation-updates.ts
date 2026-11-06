import { z } from 'zod';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { notebookProblemLocalizedContentSchema } from '@/lib/problem-bank/schema';
import { courseProblemRevision } from './admin-course-problem-upload';

const translations = z
  .object({
    'zh-CN': notebookProblemLocalizedContentSchema.strict().optional(),
    'en-US': notebookProblemLocalizedContentSchema.strict().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'A translation is required.');
const part = z.object({ label: z.string().min(1).max(64), translations }).strict();
export const courseProblemTranslationUpdateSchema = z
  .object({
    changes: z
      .array(
        z
          .object({
            id: z.string().min(1).max(200),
            expectedRevision: z.string().regex(/^[a-f0-9]{64}$/),
            translations: translations.optional(),
            parts: z.array(part).min(1).max(12).optional(),
          })
          .strict()
          .refine((value) => value.translations || value.parts, 'No translations supplied.'),
      )
      .min(1)
      .max(100),
    apply: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) => new Set(value.changes.map((change) => change.id)).size === value.changes.length,
    'Duplicate problem IDs.',
  );

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
} as const;
type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as RecordValue) : {};
const rows = (value: unknown): RecordValue[] => (Array.isArray(value) ? value.map(record) : []);
const stable = (value: unknown): string =>
  value && typeof value === 'object'
    ? Array.isArray(value)
      ? `[${value.map(stable).join(',')}]`
      : `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${stable(record(value)[key])}`)
          .join(',')}}`
    : (JSON.stringify(value) ?? 'null');

export class ProblemTranslationConflict extends Error {}
const requireMatch = (condition: unknown, message: string) => {
  if (!condition) throw new ProblemTranslationConflict(message);
};

/** Translation payloads can address existing presentation fields, never code or grading. */
function mergeTranslations(content: RecordValue, input: z.infer<typeof translations>) {
  const next = { ...record(content.translations) };
  for (const [locale, text] of Object.entries(input)) {
    if (!text) continue;
    if (text.options) {
      const options = rows(content.options);
      requireMatch(
        content.type === 'choice' &&
          options.length === text.options.length &&
          options.every((option, index) => option.id === text.options?.[index]?.id),
        'Translated options must retain all option IDs and their order.',
      );
    }
    for (const [field, base, key] of [
      ['statementSections', rows(content.statementSections), 'id'],
      ['assetTexts', rows(record(content.assets).images), 'id'],
      ['tableColumns', rows(content.columns), 'id'],
    ] as const) {
      const items = text[field];
      if (!items) continue;
      requireMatch(
        new Set(items.map((item) => item[key])).size === items.length &&
          items.every((item) => base.some((original) => original[key] === item[key])),
        `Translated ${field} must refer to unique existing IDs.`,
      );
    }
    if (text.statementSections || text.starterCodeDescription)
      requireMatch(content.type === 'code', 'Code descriptions require a code question.');
    if (text.sampleExplanations) {
      const samples = rows(content.sampleIO);
      requireMatch(
        new Set(text.sampleExplanations.map((item) => item.index)).size ===
          text.sampleExplanations.length &&
          text.sampleExplanations.every((item) => item.index < samples.length),
        'Translated sample explanations must address existing samples.',
      );
    }
    if (text.tableCells) {
      const given = new Set(
        rows(content.columns)
          .filter((column) => column.role === 'given' && column.cellKind === 'text')
          .map((column) => column.id),
      );
      requireMatch(
        new Set(text.tableCells.map((cell) => `${cell.rowId}:${cell.colId}`)).size ===
          text.tableCells.length &&
          text.tableCells.every(
            (cell) =>
              given.has(cell.colId) &&
              rows(content.rows).some(
                (row) => row.id === cell.rowId && Object.hasOwn(record(row.cells), cell.colId),
              ),
          ),
        'Only existing teacher-supplied text cells can be translated.',
      );
    }
    next[locale] = { ...record(next[locale]), ...text };
  }
  return { ...content, translations: next };
}

export function applyProblemTranslationPatch(
  original: unknown,
  patch: z.infer<typeof courseProblemTranslationUpdateSchema>['changes'][number],
) {
  const content = record(original);
  let next = patch.translations ? mergeTranslations(content, patch.translations) : { ...content };
  if (patch.parts) {
    const sourceParts = rows(content.parts);
    requireMatch(
      content.type === 'multipart' &&
        new Set(patch.parts.map((item) => item.label)).size === patch.parts.length &&
        patch.parts.every((item) => sourceParts.some((source) => source.label === item.label)),
      'Translated parts must address unique existing multipart labels.',
    );
    const translatedParts = new Map(patch.parts.map((item) => [item.label, item.translations]));
    next = {
      ...next,
      parts: sourceParts.map((source) => ({
        ...source,
        ...(translatedParts.has(String(source.label))
          ? {
              content: mergeTranslations(
                record(source.content),
                translatedParts.get(String(source.label))!,
              ),
            }
          : {}),
      })),
    };
  }
  return next;
}

export async function readCourseProblemTranslations(db: PrismaClient, courseId: string) {
  const problems = await db.notebookProblem.findMany({
    where: { courseId, status: { not: 'archived' }, ownerId: null },
    select,
    orderBy: [{ order: 'asc' }, { id: 'asc' }],
  });
  return {
    courseId,
    problems: problems.map((problem) => ({
      id: problem.id,
      revision: courseProblemRevision(problem),
      publicContent: problem.publicContentJson,
    })),
  };
}

/** Preview first; commit only presentation changes with optimistic concurrency protection. */
export async function updateCourseProblemTranslations(
  db: PrismaClient,
  courseId: string,
  input: unknown,
) {
  const data = courseProblemTranslationUpdateSchema.parse(input);
  return db.$transaction(
    async (tx) => {
      const problems = await tx.notebookProblem.findMany({
        where: {
          courseId,
          id: { in: data.changes.map((change) => change.id) },
          status: { not: 'archived' },
          ownerId: null,
        },
        select,
      });
      const byId = new Map(problems.map((problem) => [problem.id, problem]));
      const changes = data.changes.map((change) => {
        const problem = byId.get(change.id);
        requireMatch(problem, 'A problem no longer belongs to this shared course bank.');
        const content = applyProblemTranslationPatch(problem!.publicContentJson, change);
        const unchanged = stable(content) === stable(problem!.publicContentJson);
        requireMatch(
          unchanged || courseProblemRevision(problem!) === change.expectedRevision,
          'A problem changed after review; download and review again.',
        );
        return { problem: problem!, content, unchanged };
      });
      let updated = 0;
      if (data.apply) {
        for (const { problem, content, unchanged } of changes) {
          if (unchanged) continue;
          const result = await tx.notebookProblem.updateMany({
            where: { id: problem.id, courseId, updatedAt: problem.updatedAt },
            data: {
              publicContentJson: JSON.parse(JSON.stringify(content)),
              contentUpdatedAt: new Date(),
            },
          });
          requireMatch(result.count === 1, 'Concurrent question edit; no changes applied.');
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
        count: changes.length,
        updated,
        unchanged: changes.filter((change) => change.unchanged).length,
      };
    },
    { timeout: 60_000 },
  );
}
