import type { LocalProblem } from '../domain/models';

/** Explicit paper labels; broad source and knowledge tags are not paper series. */
export function problemPaperSeries(problems: LocalProblem[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const problem of problems) {
    for (const tag of new Set(problem.tags)) {
      if (/^TT\d+(?:原版)?模拟[A-Z]卷$/.test(tag)) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

export function matchesProblemFilters(
  problem: LocalProblem,
  filters: { query: string; type: string; difficulty: string; chapter: string; series?: string },
): boolean {
  if (filters.series && !problem.tags.includes(filters.series)) return false;
  if (filters.type !== 'all' && problem.type !== filters.type) return false;
  if (filters.difficulty !== 'all' && problem.difficulty !== filters.difficulty) return false;
  if (filters.chapter === 'unassigned' && problem.chapterId) return false;
  if (
    filters.chapter !== 'all' &&
    filters.chapter !== 'unassigned' &&
    problem.chapterId !== filters.chapter
  ) {
    return false;
  }
  const haystack = [
    problem.title,
    problem.type,
    problem.chapterName ?? '',
    problem.tags.join(' '),
    JSON.stringify(problem.publicContent),
  ]
    .join('\n')
    .toLowerCase();
  return filters.query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}
