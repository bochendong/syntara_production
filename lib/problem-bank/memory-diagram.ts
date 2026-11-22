import { z } from 'zod';
import type { ProblemContentLanguage } from './i18n';

const cellSchema = z.union([
  z.string().min(1).max(160),
  z.object({ blankId: z.string().min(1).max(64) }),
]);

export const problemMemoryDiagramSchema = z.object({
  variables: z.array(z.object({ name: z.string().min(1).max(64), reference: cellSchema })).max(24),
  objects: z
    .array(
      z.object({
        id: cellSchema,
        pythonType: cellSchema,
        value: z.union([cellSchema, z.array(cellSchema).max(24)]),
      }),
    )
    .min(1)
    .max(32),
  listCount: cellSchema.optional(),
});

export type ProblemMemoryDiagram = z.infer<typeof problemMemoryDiagramSchema>;
export type MemoryDiagramCell = z.infer<typeof cellSchema>;

const diagramPrompt = z
  .object({
    stem: z.string().min(1).max(16000).optional(),
    stemTemplate: z.string().min(1).max(12000).optional(),
  })
  .strict();
const presentationId = z.string().trim().min(1).max(200);
export const problemMemoryDiagramViewSchema = diagramPrompt.extend({
  removeImages: z.array(presentationId).max(8).optional(),
  removeSections: z.array(presentationId).max(10).optional(),
  translations: z
    .object({
      'zh-CN': diagramPrompt.optional(),
      'en-US': diagramPrompt.optional(),
    })
    .strict()
    .optional(),
});

export function memoryDiagramBlankIds(diagram: ProblemMemoryDiagram): string[] {
  const cells = [
    ...diagram.variables.map(({ reference }) => reference),
    ...diagram.objects.flatMap(({ id, pythonType, value }) => [
      id,
      pythonType,
      ...(Array.isArray(value) ? value : [value]),
    ]),
    diagram.listCount,
  ];
  return cells.flatMap((cell) => (cell && typeof cell !== 'string' ? [cell.blankId] : []));
}

/** Keep the ordinary answer controls available when older or malformed data has no usable diagram. */
export function readProblemMemoryDiagram(content: Record<string, unknown>) {
  if (!content.memoryDiagram) return null;
  const parsed = problemMemoryDiagramSchema.safeParse(content.memoryDiagram);
  if (!parsed.success) return null;
  const blanks = memoryDiagramBlankIds(parsed.data);
  if (!blanks.length) return { diagram: parsed.data, editable: false };
  if (content.type !== 'fill_blank' || !Array.isArray(content.blanks)) return null;
  const ids = new Set(content.blanks.map((blank) => blank?.id));
  if (
    blanks.length !== content.blanks.length ||
    new Set(blanks).size !== blanks.length ||
    !blanks.every((id) => ids.has(id))
  )
    return null;
  return { diagram: parsed.data, editable: true };
}

/** The old image and prompt stay in the bank for clients without the interactive diagram. */
export function memoryDiagramQuestionView(
  content: Record<string, unknown>,
  locale: ProblemContentLanguage,
) {
  if (!content.memoryDiagramView || !readProblemMemoryDiagram(content)) return { content };
  const parsed = problemMemoryDiagramViewSchema.safeParse(content.memoryDiagramView);
  if (!parsed.success) return { content };
  const { removeImages, removeSections, translations, ...defaultPrompt } = parsed.data;
  const prompt = { ...defaultPrompt, ...translations?.[locale] };
  const shown: Record<string, unknown> = { ...content, ...prompt };
  if (shown.blankLayout === 'figure') delete shown.blankLayout;
  const assets = shown.assets as { images?: Array<{ id: string }> } | undefined;
  if (removeImages?.length && Array.isArray(assets?.images)) {
    shown.assets = {
      ...assets,
      images: assets.images.filter(({ id }) => !removeImages.includes(id)),
    };
  }
  if (removeSections?.length && Array.isArray(shown.statementSections)) {
    shown.statementSections = shown.statementSections.filter(
      ({ id }) => !removeSections.includes(id),
    );
  }
  return {
    content: shown,
    prompt: shown.type === 'fill_blank' ? prompt.stemTemplate : prompt.stem,
  };
}
