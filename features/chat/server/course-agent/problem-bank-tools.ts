import type {
  LearnProblemBankExcludedCandidate,
  LearnProblemBankMatch,
  LearnProblemBankSearchResult,
} from '@/features/learn-core/domain/types';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { searchLearnProblemBankForPractice } from '@/lib/server/problem-bank-practice-search';

/**
 * Teacher-side problem-bank tools for the course chat agent.
 *
 * Problems are presented as platform problems filed under a chapter. Provenance
 * (source file names, upload ids, original exam numbering, source quotes) lives in
 * NotebookProblem.sourceMeta and must never reach the model or the user, so
 * everything returned here is rebuilt from curated columns only.
 */

export type TeacherProblemMatch = {
  problemId: string;
  title: string;
  chapterId: string | null;
  chapterName: string | null;
  /** Course-visible problem number, never a source-file question number. */
  problemNumber: number | null;
  problemType: string;
  difficulty: string;
  tags: string[];
  /** Stem excerpt from the curated public content, at most 600 chars. */
  stemExcerpt: string;
  /** Short reference-answer summary for the course owner; omitted when unavailable. */
  answerSummary?: string;
  reason: string;
  href: string;
};

export type TeacherProblemBankSearchResult = {
  query: string;
  requestedCount: number;
  chapterId: string | null;
  matches: TeacherProblemMatch[];
  gaps: string[];
  hasMore?: boolean;
  nextOffset?: number | null;
};

export type ProblemChapterSummary = {
  id: string | null;
  name: string;
  order: number;
  problemCount: number;
};

const STEM_EXCERPT_LIMIT = 600;
const ANSWER_SUMMARY_LIMIT = 300;

/** Metadata keys that can carry upload provenance or original exam numbering. */
const PROVENANCE_KEY_RE =
  /source|file|quote|toplevellabel|anchor|page|scaffold|structure|import|upload|origin|year|exam|label|hash/i;

/** Phrases that reveal past-exam provenance in otherwise curated text. */
const PROVENANCE_TEXT_RES: RegExp[] = [
  // Whole parentheticals that cite an exam ("（2022年期末考试第3题）", "(Final 2021, Q4)").
  // Requires a year next to an exam word, 真题, or an exam question number, so ordinary
  // parentheses such as "(final answer)" are left alone.
  /[（(][^（）()]*(?:真题|(?:考试|试卷)\s*第\s*\d+\s*题|(?:19|20)\d{2}[^（）()]*(?:期末|期中|考试|试卷|final|midterm|exam)|(?:期末|期中|final|midterm|exam)[^（）()]*(?:19|20)\d{2})[^（）()]*[)）]/gi,
  /(往年|历年|期末|期中)?真题/g,
  /\bpast\s+(exam|paper|final|midterm)s?\b/gi,
  /\b(19|20)\d{2}\s*(年)?\s*(春|夏|秋|冬|fall|winter|spring|summer)?\s*(学期)?\s*(期末|期中|考试|final|midterm|exam)(\s*(考试|试卷|exam|paper))?(\s*第\s*\d+\s*题)?/gi,
  /\b(final|midterm)\s+(exam\s+)?(19|20)\d{2}\b/gi,
];
const LEADING_QUESTION_NUMBER_RE =
  /^\s*(?:(?:question|q|problem)\s*\d+[a-z]?(?:\s*\([a-z0-9]+\))?|第\s*\d+\s*题(?:\s*[（(][a-z0-9]+[)）])?)\s*[:：.、\-–—]?\s*/i;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clip(value: string, limit: number): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  return compact.length <= limit ? compact : `${compact.slice(0, limit - 1)}…`;
}

/** Remove past-exam wording from model/user-facing problem text. */
export function scrubProvenanceText(value: string): string {
  let text = value;
  for (const pattern of PROVENANCE_TEXT_RES) text = text.replace(pattern, '');
  return text
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Problem titles additionally lose a leading original question number ("Q3:", "第3题"). */
export function scrubProblemTitle(title: string): string {
  const cleaned = scrubProvenanceText(title).replace(LEADING_QUESTION_NUMBER_RE, '').trim();
  return cleaned || '题目';
}

/** Drop metadata keys that can expose upload provenance. Safe for the student path too. */
export function stripProblemProvenance(
  metadata: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (PROVENANCE_KEY_RE.test(key)) continue;
    out[key] = value;
  }
  return out;
}

function sanitizeMatch(match: LearnProblemBankMatch): LearnProblemBankMatch {
  return {
    ...match,
    title: scrubProblemTitle(match.title),
    excerpt: match.excerpt ? scrubProvenanceText(match.excerpt) : match.excerpt,
    metadata: stripProblemProvenance(match.metadata),
  };
}

function sanitizeExcluded(
  candidate: LearnProblemBankExcludedCandidate,
): LearnProblemBankExcludedCandidate {
  return {
    ...candidate,
    title: scrubProblemTitle(candidate.title),
    excerpt: candidate.excerpt ? scrubProvenanceText(candidate.excerpt) : candidate.excerpt,
    metadata: stripProblemProvenance(candidate.metadata),
  };
}

/**
 * Provenance-free copy of a student search result. Problem ids, scores, tags and the
 * metadata href survive, so practiceCardFromSearch keeps working on the output.
 */
export function sanitizeProblemBankSearchResult(
  result: LearnProblemBankSearchResult,
): LearnProblemBankSearchResult {
  return {
    ...result,
    matches: result.matches.map(sanitizeMatch),
    excluded: result.excluded.map(sanitizeExcluded),
  };
}

function stemFromPublicContent(publicContentJson: unknown): string {
  const content = record(publicContentJson);
  const stem =
    typeof content.stem === 'string'
      ? content.stem
      : typeof content.stemTemplate === 'string'
        ? content.stemTemplate
        : '';
  const options = Array.isArray(content.options)
    ? content.options
        .map((option, index) => {
          const item = record(option);
          const label = typeof item.label === 'string' ? item.label : '';
          return label ? `${String.fromCharCode(65 + index)}. ${label}` : '';
        })
        .filter(Boolean)
    : [];
  return clip(scrubProvenanceText([stem, ...options].join('\n')), STEM_EXCERPT_LIMIT);
}

function answerSummaryFromGrading(
  type: string,
  gradingJson: unknown,
  publicContentJson: unknown,
): string | undefined {
  const grading = record(gradingJson);
  const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
  let summary = '';
  if (type === 'choice') {
    const correct = Array.isArray(grading.correctOptionIds)
      ? grading.correctOptionIds.filter((id): id is string => typeof id === 'string')
      : [];
    const options = Array.isArray(record(publicContentJson).options)
      ? (record(publicContentJson).options as unknown[]).map(record)
      : [];
    const labels = correct.map((id) => {
      const index = options.findIndex((option) => option.id === id);
      if (index < 0) return id;
      const label = text(options[index].label);
      return `${String.fromCharCode(65 + index)}${label ? `（${clip(label, 80)}）` : ''}`;
    });
    summary = labels.length ? `正确选项：${labels.join('、')}` : '';
  } else if (type === 'fill_blank') {
    const blanks = Array.isArray(grading.blanks) ? grading.blanks.map(record) : [];
    summary = blanks
      .map((blank, index) => {
        const accepted = Array.isArray(blank.acceptedAnswers)
          ? blank.acceptedAnswers.filter((a): a is string => typeof a === 'string')
          : [];
        return accepted.length ? `空${index + 1}：${accepted.slice(0, 4).join(' / ')}` : '';
      })
      .filter(Boolean)
      .join('；');
  } else if (type === 'calculation') {
    summary = text(grading.referenceAnswer);
  } else if (type === 'short_answer') {
    summary = text(grading.referenceAnswer);
  } else if (type === 'proof') {
    summary = text(grading.referenceProof) || text(grading.referenceAnswer);
  }
  const cleaned = clip(scrubProvenanceText(summary), ANSWER_SUMMARY_LIMIT);
  return cleaned || undefined;
}

function problemHref(courseId: string, problemId: string): string {
  return `/course/${encodeURIComponent(courseId)}/problem-bank/${encodeURIComponent(problemId)}`;
}

const PROBLEM_SELECT = {
  id: true,
  title: true,
  chapterId: true,
  problemNumber: true,
  type: true,
  difficulty: true,
  tags: true,
  publicContentJson: true,
  gradingJson: true,
  chapter: { select: { name: true } },
} as const;

type ProblemRow = {
  id: string;
  title: string;
  chapterId: string | null;
  problemNumber: number | null;
  type: string;
  difficulty: string;
  tags: string[];
  publicContentJson: unknown;
  gradingJson: unknown;
  chapter: { name: string } | null;
};

function toTeacherMatch(args: {
  row: ProblemRow;
  courseId: string;
  reason: string;
  includeAnswers: boolean;
}): TeacherProblemMatch {
  const { row } = args;
  const answerSummary = args.includeAnswers
    ? answerSummaryFromGrading(row.type, row.gradingJson, row.publicContentJson)
    : undefined;
  return {
    problemId: row.id,
    title: scrubProblemTitle(row.title),
    chapterId: row.chapterId,
    chapterName: row.chapter?.name ?? null,
    problemNumber: row.problemNumber,
    problemType: row.type,
    difficulty: row.difficulty,
    tags: (row.tags || []).slice(0, 8),
    stemExcerpt: stemFromPublicContent(row.publicContentJson),
    ...(answerSummary ? { answerSummary } : {}),
    reason: scrubProvenanceText(args.reason),
    href: problemHref(args.courseId, row.id),
  };
}

/**
 * Search the course problem bank for a course owner. Recall reuses the student
 * search (hybrid index + direct persisted-column lookup); every hit is then re-read from
 * NotebookProblem, scoped to the course.
 */
export async function searchTeacherProblemBank(args: {
  db: PrismaClient;
  userId: string;
  courseId: string;
  query: string;
  requestedCount?: number;
  chapterId?: string | null;
  offset?: number;
  searchTerms?: string[];
  /** Include reference-answer summaries (teacher only). Defaults to true. */
  includeAnswers?: boolean;
}): Promise<TeacherProblemBankSearchResult> {
  const requestedCount = Math.max(1, Math.min(args.requestedCount ?? 5, 12));
  const chapterId = args.chapterId?.trim() || null;
  const includeAnswers = args.includeAnswers ?? true;
  const recall = await searchLearnProblemBankForPractice({
    prisma: args.db,
    userId: args.userId,
    courseId: args.courseId,
    query: args.query,
    requestedCount,
    chapterId,
    offset: args.offset,
    searchTerms: args.searchTerms,
  });
  const query = recall.query;
  const ids = [...new Set(recall.matches.map((match) => match.problemId).filter(Boolean))];
  const rows = ids.length
    ? ((await args.db.notebookProblem.findMany({
        where: {
          id: { in: ids },
          courseId: args.courseId,
          ...(chapterId ? { chapterId } : {}),
        },
        select: PROBLEM_SELECT,
      })) as unknown as ProblemRow[])
    : [];
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const matches: TeacherProblemMatch[] = [];
  for (const match of recall.matches) {
    const row = rowById.get(match.problemId);
    if (!row || matches.some((item) => item.problemId === row.id)) continue;
    matches.push(
      toTeacherMatch({ row, courseId: args.courseId, reason: match.reason, includeAnswers }),
    );
    if (matches.length >= requestedCount) break;
  }

  return {
    query,
    requestedCount,
    chapterId,
    matches,
    gaps: recall.gaps,
    hasMore: recall.hasMore,
    nextOffset: recall.nextOffset,
  };
}

/**
 * Problem-bank chapters with available question counts, ordered like the problem bank.
 * Problems without a chapter are reported as a final entry with id null.
 */
export async function listProblemChapters(args: {
  db: PrismaClient;
  courseId: string;
}): Promise<ProblemChapterSummary[]> {
  const [chapters, grouped] = await Promise.all([
    args.db.courseProblemChapter.findMany({
      where: { courseId: args.courseId },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, name: true, position: true },
    }),
    args.db.notebookProblem.groupBy({
      by: ['chapterId'],
      where: { courseId: args.courseId },
      _count: { _all: true },
    }),
  ]);
  const counts = new Map<string, number>();
  for (const group of grouped) {
    const key = group.chapterId ?? '';
    counts.set(key, (counts.get(key) ?? 0) + group._count._all);
  }
  const result: ProblemChapterSummary[] = chapters.map((chapter) => ({
    id: chapter.id,
    name: chapter.name,
    order: chapter.position,
    problemCount: counts.get(chapter.id) ?? 0,
  }));
  const knownIds = new Set(chapters.map((chapter) => chapter.id));
  // Problems whose chapter id no longer resolves are counted as uncategorized.
  let uncategorized = 0;
  for (const [key, value] of counts) {
    if (key && knownIds.has(key)) continue;
    uncategorized += value;
  }
  if (uncategorized > 0) {
    result.push({ id: null, name: '未分章节', order: result.length, problemCount: uncategorized });
  }
  return result;
}
