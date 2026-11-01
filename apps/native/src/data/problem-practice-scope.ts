import type { ProblemBankLaunch } from '../components/ProblemBankPage';

/** A recommendation opens its own captured set, never the rest of the message or course. */
export function recommendedPracticeIds(
  requested: readonly string[],
  selected: readonly string[],
  available: readonly { id: string }[],
) {
  const source = requested.length ? requested : selected;
  const allowed = new Set(available.map((problem) => problem.id));
  return [...new Set(source)].filter((id) => allowed.has(id));
}

/** Capture the complete visible result in its current order, independent of chapters. */
export function practiceLaunchForResults(
  problems: readonly { id: string }[],
  initialId: string | undefined,
  title: string,
): ProblemBankLaunch | null {
  const problemIds = [...new Set(problems.map((problem) => problem.id))];
  if (!problemIds.length) return null;
  return {
    language: 'zh-CN',
    problemIds,
    initialProblemId: initialId && problemIds.includes(initialId) ? initialId : problemIds[0],
    numbers: Object.fromEntries(problemIds.map((id, index) => [id, index + 1])),
    title,
  };
}

/** Previous/next never expands the captured scope or skips completed questions. */
export function adjacentPracticeProblem(
  problemIds: readonly string[],
  currentId: string,
  direction: -1 | 1,
): string | null {
  const index = problemIds.indexOf(currentId);
  return index < 0 ? null : (problemIds[index + direction] ?? null);
}
