import type { LocalProblem } from '../domain/models';

export function namedMidtermYear(label: string): string | undefined {
  return (
    /^UT(?:SG|M|SC) [A-Z]{3} \d{3} (\d{2})[FWS] Midterm$/.exec(label)?.[1] ??
    /^UT(?:SG|M|SC) (?:Fall|Winter|Summer) 20(\d{2}) Midterm$/.exec(label)?.[1] ??
    /^UT(?:SG|M|SC)-20(\d{2})-Midterm-[A-Z]$/.exec(label)?.[1]
  );
}

export const courseSeries =
  /^(?:Worksheet \d+|Tutorial \d+|Extra Practice \d+|Sample Test \d+-\d+|Practice Exam [ABC]|Examlet 3 模考 [A-D])$/;
export function courseQuestionNumber(tags: readonly string[] = []) {
  return tags.find((tag) => /^(?:(?:W|T|EP|PE)\d+\.\d+|(?:[ABC]-)?Q\d+[ab]?)$/.test(tag)) ?? '';
}

const reviewPaper = /^(?:UTM Term Test 2 Review [A-C]|UTSG Quiz 2 Review [A-E])$/;

const legacyPaperAliases = new Map([
  ['TT1原版模拟A卷', 'UTM Fall 2026 Term Test 1'],
  ['TT2原版模拟A卷', 'UTM Term Test 2 Original A'],
  ['TT2模拟A卷', 'UTM Term Test 2 Mock A'],
  ['TT2模拟B卷', 'UTM Term Test 2 Mock B'],
  ['TT2模拟C卷', 'UTM Term Test 2 Mock C'],
  ['UTSG CSC 108 26F Midterm', 'UTSG Fall 2026 Midterm'],
]);
const renamedPapers = new Set(legacyPaperAliases.values());
const csc108SeriesTag = /^UT(?:SG|M|SC)-20\d{2}-[A-Za-z][A-Za-z0-9 ]*-[A-Z]$/;

export function usesCsc108PaperNames(course: { name: string; courseCode: string | null }): boolean {
  const code = /\bCSC\s*108(?:Y|H[15][FSY]?)?\b/i;
  return code.test(course.courseCode ?? '') || code.test(course.name);
}

function csc108PaperName(label: string): string {
  const name = legacyPaperAliases.get(label) ?? label;
  if (name === 'UTM Fall 2026 Term Test 1') return 'UTM-2026-Term Test 1-A';
  if (name === 'UTM Term Test 2 Original A') return 'UTM-2024-Term Test 2 Adapted-A';
  if (name === 'UTSG Fall 2026 Midterm') return 'UTSG-2026-Midterm-A';

  const paper = /^(UTM|UTSG) (Term Test 2 (?:Mock|Review)|Quiz 2 Review) ([A-E])$/.exec(name);
  if (paper) return `${paper[1]}-2026-${paper[2]}-${paper[3]}`;

  const practice = /^(?:Midterm Set|UTSG Midterm Mock) (0[1-9]|10)$/.exec(name);
  if (practice) return `UTSG-2026-Midterm Mock-${'ABCDEFGHIJ'[Number(practice[1]) - 1]}`;

  return name;
}

/** Only explicit paper tags (including the legacy midterm + set-NN pair) are series. */
export function paperLabels(tags: readonly string[] = [], useCsc108Names = false): string[] {
  const labels = new Set<string>();
  const midterm = tags.includes('midterm');
  const namedYears = new Set<string>();
  for (const tag of tags) {
    const year = namedMidtermYear(tag);
    if (year) namedYears.add(year);
    const renamed = legacyPaperAliases.get(tag);
    if (renamed && tags.includes(renamed)) continue;
    if (
      courseSeries.test(tag) ||
      year ||
      reviewPaper.test(tag) ||
      renamedPapers.has(tag) ||
      (useCsc108Names && csc108SeriesTag.test(tag)) ||
      /^UTSG Midterm Mock (0[1-9]|10)$/.test(tag)
    )
      labels.add(tag);
  }
  for (const tag of tags) {
    const renamed = legacyPaperAliases.get(tag);
    if (/^TT\d+(?:原版)?模拟[A-Z]卷$/.test(tag) && (!renamed || !labels.has(renamed)))
      labels.add(tag);
    const set = midterm && /^set-(0[1-9]|[1-9]\d)$/.exec(tag);
    if (set && !namedYears.has(set[1]) && !labels.has(`UTSG Midterm Mock ${set[1]}`))
      labels.add(`Midterm Set ${set[1]}`);
  }
  return useCsc108Names ? [...new Set([...labels].map(csc108PaperName))] : [...labels];
}

export function problemPaperSeries(
  problems: ReadonlyArray<{ tags?: readonly string[] }>,
  useCsc108Names = false,
): [string, number][] {
  const counts = new Map<string, number>();
  for (const problem of problems) {
    for (const label of paperLabels(problem.tags, useCsc108Names)) {
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
  }
  return [...counts].sort(([a], [b]) => a.localeCompare(b, 'zh-CN', { numeric: true }));
}

export function matchesProblemFilters(
  problem: LocalProblem,
  filters: { query: string; type: string; difficulty: string; chapter: string; series?: string },
  useCsc108Names = false,
): boolean {
  const papers = paperLabels(problem.tags, useCsc108Names);
  if (filters.series && !papers.includes(filters.series)) return false;
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
    papers.join(' '),
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
