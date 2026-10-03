import type { TeacherProblemMatch } from './problem-bank-tools';

function escapeLabel(value: string): string {
  return value.replace(/([\\[\]*_`|])/g, '\\$1').replace(/\s+/g, ' ');
}

export function problemReferenceLabel(problem: TeacherProblemMatch): string {
  const chapter = problem.chapterName ? `《${problem.chapterName}》· ` : '';
  return `${chapter}${problem.problemNumber != null ? `题库第 ${problem.problemNumber} 题` : problem.title}`;
}

/** One ordered selection, derived from the references the reader actually sees.
 * Search candidates that the answer never cites must never become recommendation cards.
 * URLs and labels are rebuilt from trusted, course-scoped evidence.
 */
export function resolveProblemReferences(args: {
  text: string;
  courseId: string;
  candidates: TeacherProblemMatch[];
}): { text: string; selected: TeacherProblemMatch[] } {
  const byHref = new Map<string, TeacherProblemMatch>();
  const byNumber = new Map<number, TeacherProblemMatch[]>();
  for (const problem of new Map(args.candidates.map((p) => [p.problemId, p])).values()) {
    const href = `/course/${encodeURIComponent(args.courseId)}/problem-bank/${encodeURIComponent(problem.problemId)}`;
    byHref.set(href, problem);
    if (problem.problemNumber != null) {
      const matches = byNumber.get(problem.problemNumber) || [];
      matches.push(problem);
      byNumber.set(problem.problemNumber, matches);
    }
  }
  const selected = new Map<string, TeacherProblemMatch>();
  const reference = (problem: TeacherProblemMatch) => {
    selected.set(problem.problemId, problem);
    const href = `/course/${encodeURIComponent(args.courseId)}/problem-bank/${encodeURIComponent(problem.problemId)}`;
    return `[${escapeLabel(problemReferenceLabel(problem))}](${href})`;
  };
  // Consume existing links and code as whole tokens so their contents cannot be
  // mistaken for bare problem numbers or nested links. Ambiguous numbers stay text.
  const text = args.text.replace(
    /```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]+`|!?\[(?:\\.|[^\]\\])*\]\([^\s)]*\)|(?:《[^》\n]+》\s*[·・：:]?\s*)?(?:题库\s*)?第\s*\d+\s*题/g,
    (token) => {
      if (token.startsWith('`') || token.startsWith('~')) return token;
      const link = /^!?\[([\s\S]*)\]\(([^\s)]*)\)$/.exec(token);
      if (link) {
        if (token.startsWith('!')) return token;
        const problem = byHref.get(link[2]);
        if (problem) return reference(problem);
        // Never leave an invented or cross-course bank link clickable.
        return /\/course\/[^/]+\/problem-bank\//.test(link[2]) ? link[1] : token;
      }
      const number = /第\s*(\d+)\s*题/.exec(token);
      const chapter = /《([^》]+)》/.exec(token)?.[1];
      const matches = (byNumber.get(Number(number?.[1])) || []).filter(
        (problem) => !chapter || problem.chapterName === chapter,
      );
      return matches.length === 1 ? reference(matches[0]) : token;
    },
  );
  return { text, selected: [...selected.values()] };
}
