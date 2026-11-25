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

/**
 * 套题题号标签：「UTM 2023 Final · Q12」「UTSG 2024F TT2 V1 · Q3b」。
 * 套题只引用题目：同一道 Final 题可以再带一个「TT2 模考 A · Q4」，两套里各有自己的题号，
 * 题目本身只存一份。带这种标签就算属于这套题，不需要另存卷名标签。
 */
const PAPER_SET_POSITION = /^(\S.{1,23}\S) · Q(\d{1,2})([a-z]?)$/;
export const PAPER_SET_TAG_MAX = 30;

export type PaperSetPosition = { set: string; number: number; part: string; label: string };

export function paperSetPositionTag(set: string, label: string): string {
  const tag = `${set.trim()} · Q${label}`;
  if (!PAPER_SET_POSITION.test(tag) || tag.length > PAPER_SET_TAG_MAX) {
    throw new Error(`Invalid paper set position tag: ${tag}`);
  }
  return tag;
}

export function paperSetPositions(tags: readonly string[] = []): PaperSetPosition[] {
  const positions: PaperSetPosition[] = [];
  for (const tag of tags) {
    const match = PAPER_SET_POSITION.exec(tag);
    if (match && !positions.some((position) => position.set === match[1])) {
      positions.push({
        set: match[1],
        number: Number(match[2]),
        part: match[3],
        label: `Q${match[2]}${match[3]}`,
      });
    }
  }
  return positions;
}

export function paperSetPosition(
  tags: readonly string[] = [],
  set: string,
): PaperSetPosition | undefined {
  return paperSetPositions(tags).find((position) => position.set === set);
}

/** Only explicit paper tags (including the legacy midterm + set-NN pair) are series. */
export function paperLabels(tags: readonly string[] = [], useCsc108Names = false): string[] {
  const labels = new Set<string>(paperSetPositions(tags).map((position) => position.set));
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

export type PaperSetKind = 'final' | 'test' | 'practice';

/** 套题墙分三组：期末、期中与小测、练习卷。 */
export function paperSetKind(name: string): PaperSetKind {
  if (/\bFinal\b|期末/i.test(name)) return 'final';
  if (/Midterm|\bTT\d|Term Test|Quiz|Timed|Examlet|期中|测验|模考|模拟/i.test(name)) return 'test';
  return 'practice';
}

function paperSetYear(name: string): number {
  const match = /20(\d{2})|(\d{2})[FWS]\b/.exec(name);
  return match ? Number(match[1] ?? match[2]) : 0;
}

export type PaperSet<P> = { name: string; kind: PaperSetKind; problems: P[] };

/**
 * 把题目按套题分好。一道题可以出现在好几套里；每套内部先按「· Q」题号，
 * 没有题号的旧系列按原来的课程题号，最后按 fallback（章节顺序）。
 */
export function problemPaperSets<P extends { id: string; tags?: readonly string[] }>(
  problems: readonly P[],
  useCsc108Names = false,
  fallback: (a: P, b: P) => number = () => 0,
): PaperSet<P>[] {
  const bySet = new Map<string, P[]>();
  for (const problem of problems) {
    for (const label of paperLabels(problem.tags, useCsc108Names)) {
      const list = bySet.get(label);
      if (list) list.push(problem);
      else bySet.set(label, [problem]);
    }
  }
  const kindOrder: Record<PaperSetKind, number> = { final: 0, test: 1, practice: 2 };
  return [...bySet]
    .map(([name, members]) => ({
      name,
      kind: paperSetKind(name),
      problems: [...members].sort((a, b) => {
        const pa = paperSetPosition(a.tags, name);
        const pb = paperSetPosition(b.tags, name);
        if (pa && pb) return pa.number - pb.number || pa.part.localeCompare(pb.part);
        if (pa || pb) return pa ? -1 : 1;
        return (
          courseQuestionNumber(a.tags).localeCompare(courseQuestionNumber(b.tags), 'en', {
            numeric: true,
          }) || fallback(a, b)
        );
      }),
    }))
    .sort(
      (a, b) =>
        kindOrder[a.kind] - kindOrder[b.kind] ||
        paperSetYear(b.name) - paperSetYear(a.name) ||
        a.name.localeCompare(b.name, 'zh-CN', { numeric: true }),
    );
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
