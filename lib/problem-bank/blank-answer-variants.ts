/** Score one coherent answer variant at a time, never a mixture of two memory diagrams. */
export function countCorrectBlankAnswers<T extends { id: string; acceptedAnswers: string[] }>(
  grading: { blanks: T[]; answerVariants?: Array<Record<string, string>> },
  filled: Record<string, string>,
  matches: (blank: T, actual: string, expected: string) => boolean,
): number {
  const variants = grading.answerVariants?.length ? grading.answerVariants : [null];
  return Math.max(
    0,
    ...variants.map(
      (variant) =>
        grading.blanks.filter((blank) => {
          const actual = filled[blank.id] ?? '';
          const accepted = variant
            ? [variant[blank.id]].filter((v): v is string => typeof v === 'string')
            : blank.acceptedAnswers;
          return (
            actual.trim().length > 0 &&
            accepted.some((candidate) => matches(blank, actual, candidate))
          );
        }).length,
    ),
  );
}
