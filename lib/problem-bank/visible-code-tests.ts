import type { NotebookProblemPublicCode } from './schema';

type CodeTest = NonNullable<NotebookProblemPublicCode['publicTests']>[number];
type CodeSample = NonNullable<NotebookProblemPublicCode['sampleIO']>[number];

/** Prefer the published tests; examples are only a fallback for older content. */
export function visibleCodeTests(content: {
  publicTests?: CodeTest[];
  sampleIO?: CodeSample[];
}): CodeTest[] {
  if (content.publicTests?.length) return content.publicTests;
  return (content.sampleIO ?? []).map((sample, index) => ({
    id: `sample-${index + 1}`,
    expression: sample.input,
    expected: sample.output,
    description: sample.explanation,
  }));
}
