import type { LocalProblem } from '../domain/models';

export function namedMidtermYear(label: string): string | undefined {
  return /^UT(?:SG|M|SC) [A-Z]{3} \d{3} (\d{2})[FWS] Midterm$/.exec(label)?.[1];
}

/** Only explicit paper tags (including the legacy midterm + set-NN pair) are series. */
export function paperLabels(tags: readonly string[] = []): string[] {
  const labels = new Set<string>();
  const midterm = tags.includes('midterm');
  const namedYears = new Set<string>();
  for (const tag of tags) {
    const year = namedMidtermYear(tag);
    if (year) {
      namedYears.add(year);
      labels.add(tag);
    }
  }
  for (const tag of tags) {
    if (/^TT\d+(?:原版)?模拟[A-Z]卷$/.test(tag)) labels.add(tag);
    const set = midterm && /^set-(0[1-9]|[1-9]\d)$/.exec(tag);
    if (set && !namedYears.has(set[1])) labels.add(`Midterm Set ${set[1]}`);
  }
  return [...labels];
}

export function problemPaperSeries(
  problems: ReadonlyArray<{ tags?: readonly string[] }>,
): [string, number][] {
  const counts = new Map<string, number>();
  for (const problem of problems) {
    for (const label of paperLabels(problem.tags)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

export function matchesProblemFilters(
  problem: LocalProblem,
  filters: { query: string; type: string; difficulty: string; chapter: string; series?: string },
): boolean {
  if (filters.series && !paperLabels(problem.tags).includes(filters.series)) return false;
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
