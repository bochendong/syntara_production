/**
 * Coerces a model-written structure outline into the strict problemStructurePlanSchema
 * shape. The schema rejects the whole plan on any single violation (a 201-character
 * visualRef, a 2.5-point subpart, an unknown context kind), and a rejected plan used to
 * drop the import into the single-pass fallback that bundles questions together.
 * Values are truncated, clamped, or defaulted here so one odd field cannot do that.
 */

type Json = Record<string, unknown>;

const NON_PROBLEM_KINDS = [
  'cover',
  'instructions',
  'additional_work',
  'blank',
  'header_footer',
  'other',
];
const TYPE_HINTS = [
  'choice',
  'proof',
  'calculation',
  'short_answer',
  'code',
  'fill_blank',
  'unknown',
];
const CONTEXT_KINDS = [
  'definition',
  'conditions',
  'table',
  'diagram',
  'code',
  'data',
  'hint',
  'other',
];

function record(value: unknown): Json {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : {};
}

function text(value: unknown, max: number, fallback?: string): string | undefined {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : '';
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function positiveInt(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number)) return undefined;
  const rounded = Math.round(number);
  return rounded > 0 ? rounded : undefined;
}

function points(value: unknown): number | undefined {
  const number = typeof value === 'string' ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < 0) return undefined;
  return Math.min(1000, Math.round(number));
}

function pages(value: unknown): number[] {
  const list = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return list
    .map(positiveInt)
    .filter((page): page is number => page !== undefined)
    .slice(0, 80);
}

function oneOf(value: unknown, allowed: string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback;
}

export function sanitizeStructurePlanInput(input: Json): Json {
  const nonProblemRegions = (Array.isArray(input.nonProblemRegions) ? input.nonProblemRegions : [])
    .slice(0, 80)
    .map((item) => {
      const region = record(item);
      return {
        kind: oneOf(region.kind, NON_PROBLEM_KINDS, 'other'),
        pageNumbers: pages(region.pageNumbers),
        reason: text(region.reason, 1000, 'Detected as non-problem material.'),
      };
    });

  const sharedContexts = (Array.isArray(input.sharedContexts) ? input.sharedContexts : [])
    .slice(0, 40)
    .map((item, index) => {
      const context = record(item);
      return {
        id: text(context.id, 80, `ctx_${index + 1}`),
        title: text(context.title, 200, `Shared context ${index + 1}`),
        pageNumbers: pages(context.pageNumbers),
        summary: text(context.summary, 2000, 'Shared context.'),
      };
    });

  const topLevelProblems = (Array.isArray(input.topLevelProblems) ? input.topLevelProblems : [])
    .slice(0, 200)
    .map((item, position) => {
      const problem = record(item);
      const label = text(problem.topLevelLabel ?? problem.label, 80, String(position + 1))!;
      return {
        index: positiveInt(problem.index) ?? position + 1,
        topLevelLabel: label,
        title: text(problem.title, 200, /^\d/.test(label) ? `Question ${label}` : label),
        points: points(problem.points),
        problemTypeHint: oneOf(problem.problemTypeHint, TYPE_HINTS, 'unknown'),
        pageStart: positiveInt(problem.pageStart),
        pageEnd: positiveInt(problem.pageEnd),
        sourceAnchors: (Array.isArray(problem.sourceAnchors) ? problem.sourceAnchors : [])
          .slice(0, 24)
          .map((anchorItem) => {
            const anchor = record(anchorItem);
            return {
              pageNumber: positiveInt(anchor.pageNumber),
              sourcePageId: text(anchor.sourcePageId, 120),
              textQuote: text(anchor.textQuote, 800),
              role: text(anchor.role, 80),
            };
          }),
        subparts: (Array.isArray(problem.subparts) ? problem.subparts : [])
          .slice(0, 32)
          .flatMap((subpartItem, subIndex) => {
            const subpart = record(subpartItem);
            const subLabel = text(subpart.label, 40, String.fromCharCode(97 + (subIndex % 26)))!;
            const prompt = text(subpart.prompt ?? subpart.title, 2000);
            if (!prompt) return [];
            return [{ label: subLabel, prompt, points: points(subpart.points) }];
          }),
        contextBlocks: (Array.isArray(problem.contextBlocks) ? problem.contextBlocks : [])
          .slice(0, 32)
          .flatMap((blockItem) => {
            const block = record(blockItem);
            const summary = text(block.summary ?? block.content, 2000);
            if (!summary) return [];
            return [
              {
                kind: oneOf(block.kind, CONTEXT_KINDS, 'other'),
                title: text(block.title, 160, 'Context'),
                summary,
              },
            ];
          }),
        visualRefs: (Array.isArray(problem.visualRefs) ? problem.visualRefs : [])
          .map((ref) => text(typeof ref === 'string' ? ref : JSON.stringify(ref), 200))
          .filter((ref): ref is string => Boolean(ref))
          .slice(0, 24),
        confidence: (() => {
          const value = Number(problem.confidence);
          return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0.6;
        })(),
      };
    });

  return {
    sourceSummary: text(input.sourceSummary, 4000, 'Source package analyzed.'),
    nonProblemRegions,
    sharedContexts,
    topLevelProblems,
    warnings: (Array.isArray(input.warnings) ? input.warnings : [])
      .map((warning) => text(warning, 1000))
      .filter((warning): warning is string => Boolean(warning))
      .slice(0, 80),
    generatedBy: 'llm',
  };
}
