import type { PrismaClient } from '@/lib/server/generated-prisma';
import { searchCourseKnowledge } from '@/lib/server/knowledge-document-index';
import type { MemorySearchProgressFilter } from '@/lib/server/memory-search-intent';

export type MemoryKnowledgeMatch = {
  id: string;
  sourceType: 'problem_bank';
  title: string;
  text: string;
  score: number;
  metadata: {
    courseId: string | null;
    notebookId: string | null;
    problemType: string;
    difficulty: string;
    tags: string[];
    status: string;
    notebookName: string | null;
    attemptStatus: string | null;
    attemptScore: number | null;
    attemptedCount: number;
    lastAttemptAt: string | null;
  };
};

type RawProblemKnowledgeRow = {
  id: string;
  courseId: string | null;
  notebookId: string | null;
  title: string;
  type: string;
  status: string;
  tags: string[];
  difficulty: string;
  publicText: string;
  notebookName: string | null;
  attemptStatus: string | null;
  attemptScore: number | null;
  attemptedCount: number | bigint | null;
  lastAttemptAt: Date | string | null;
  updatedAt: Date | string;
};

function normalize(input: string): string {
  return input.toLowerCase().replace(/\s+/g, ' ').trim();
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function queryTerms(query: string): string[] {
  const normalized = normalize(query);
  const latin = normalized.match(/[a-z0-9_+\-]{2,}/g) || [];
  const han = normalized.match(/[\u3400-\u9fff]{2,}/g) || [];
  const compactHan = han.flatMap((term) => {
    if (term.length <= 4) return [term];
    const windows: string[] = [];
    for (const size of [2, 3, 4]) {
      for (let i = 0; i <= term.length - size; i += 1) {
        windows.push(term.slice(i, i + size));
      }
    }
    return [term, ...windows];
  });
  return unique([...latin, ...compactHan]).slice(0, 24);
}

function publicProblemText(rawJson: string): string {
  try {
    const parsed = JSON.parse(rawJson) as {
      stem?: unknown;
      stemTemplate?: unknown;
      options?: Array<{ id?: unknown; label?: unknown }>;
    };
    const stem =
      typeof parsed.stem === 'string'
        ? parsed.stem
        : typeof parsed.stemTemplate === 'string'
          ? parsed.stemTemplate
          : '';
    const options = Array.isArray(parsed.options)
      ? parsed.options
          .map((option) => {
            const id = typeof option.id === 'string' ? option.id : '';
            const label = typeof option.label === 'string' ? option.label : '';
            return label ? `${id ? `${id}. ` : ''}${label}` : '';
          })
          .filter(Boolean)
          .join(' ')
      : '';
    return [stem, options].filter(Boolean).join(' ');
  } catch {
    return rawJson;
  }
}

function previewText(row: RawProblemKnowledgeRow): string {
  const body = publicProblemText(row.publicText).replace(/\s+/g, ' ').trim();
  return body.slice(0, 520) || row.title;
}

function attemptedCount(row: RawProblemKnowledgeRow): number {
  return Number(row.attemptedCount ?? 0);
}

function matchesProgressFilter(
  row: RawProblemKnowledgeRow,
  progressFilter?: MemorySearchProgressFilter | null,
): boolean {
  if (!progressFilter) return true;
  if (progressFilter === 'unattempted') return attemptedCount(row) === 0;
  if (progressFilter === 'attempted') return attemptedCount(row) > 0;
  return row.attemptStatus === 'failed' || row.attemptStatus === 'partial';
}

function scoreProblem(
  row: RawProblemKnowledgeRow,
  terms: string[],
  progressFilter?: MemorySearchProgressFilter | null,
): number {
  if (!matchesProgressFilter(row, progressFilter)) return 0;

  const title = normalize(row.title);
  const tags = row.tags.map(normalize);
  const publicText = normalize(publicProblemText(row.publicText));
  const notebookName = normalize(row.notebookName || '');
  const hasTerms = terms.length > 0;
  let score = 0;

  for (const term of terms) {
    if (tags.some((tag) => tag === term || tag.includes(term) || term.includes(tag))) score += 12;
    if (title.includes(term)) score += 8;
    if (notebookName.includes(term)) score += 5;
    if (publicText.includes(term)) score += 3;
  }

  if (hasTerms && score === 0) return 0;
  if (!hasTerms && progressFilter) score += 2;
  if (progressFilter === 'unattempted') score += 12;
  if (progressFilter === 'wrong_or_partial') score += row.attemptStatus === 'failed' ? 12 : 8;
  if (progressFilter === 'attempted') score += 6;
  if (row.status === 'published') score += 1;
  if (row.difficulty === 'hard') score += 0.5;
  return score;
}

function specificAnchorTerms(terms: string[]): string[] {
  return terms.filter((term) => {
    if (/[\u3400-\u9fff]/.test(term)) return term.length >= 3;
    return term.length >= 4;
  });
}

function containsSpecificAnchor(anchors: string[], row: RawProblemKnowledgeRow): boolean {
  if (anchors.length === 0) return false;
  const haystack = normalize(
    [row.title, row.notebookName, row.tags.join('\n'), publicProblemText(row.publicText)]
      .filter(Boolean)
      .join('\n'),
  );
  return anchors.some((anchor) => haystack.includes(anchor));
}

export async function searchProblemBankKnowledge(args: {
  prisma: PrismaClient;
  query: string;
  notebookId?: string | null;
  courseId?: string | null;
  viewerUserId?: string | null;
  progressFilter?: MemorySearchProgressFilter | null;
  limit?: number;
}): Promise<MemoryKnowledgeMatch[]> {
  const terms = queryTerms(args.query);
  if ((terms.length === 0 && !args.progressFilter) || (!args.notebookId && !args.courseId)) {
    return [];
  }

  const limit = Math.max(1, Math.min(args.limit ?? 6, 20));
  if (args.courseId && !args.progressFilter) {
    const indexed = await searchCourseKnowledge({
      prisma: args.prisma,
      query: args.query,
      courseId: args.courseId,
      notebookId: args.notebookId,
      documentTypes: ['problem'],
      limit,
    });
    if (indexed.available && indexed.matches.length > 0) {
      return indexed.matches.map((match) => {
        const metadata = match.metadata;
        const tags = Array.isArray(metadata.tags)
          ? metadata.tags.filter((tag): tag is string => typeof tag === 'string')
          : [];
        return {
          id: match.sourceEntityId,
          sourceType: 'problem_bank' as const,
          title: match.title,
          text: match.chunkText.slice(0, 520) || match.title,
          score: match.score * 100,
          metadata: {
            courseId: match.courseId,
            notebookId: match.notebookId,
            problemType:
              typeof metadata.problemType === 'string' ? metadata.problemType : 'unknown',
            difficulty: typeof metadata.difficulty === 'string' ? metadata.difficulty : 'medium',
            tags,
            status: typeof metadata.status === 'string' ? metadata.status : 'published',
            notebookName: typeof metadata.notebookName === 'string' ? metadata.notebookName : null,
            attemptStatus: null,
            attemptScore: null,
            attemptedCount: 0,
            lastAttemptAt: null,
          },
        };
      });
    }
  }

  const rows = await args.prisma.$queryRawUnsafe<RawProblemKnowledgeRow[]>(
    `
      SELECT
        p."id",
        COALESCE(p."courseId", n."courseId") AS "courseId",
        p."notebookId",
        p."title",
        p."type"::text AS "type",
        p."status"::text AS "status",
        p."tags",
        p."difficulty"::text AS "difficulty",
        p."publicContentJson"::text AS "publicText",
        n."name" AS "notebookName",
        progress."status"::text AS "attemptStatus",
        progress."score" AS "attemptScore",
        COALESCE(progress."attemptedCount", 0)::int AS "attemptedCount",
        progress."lastAttemptAt" AS "lastAttemptAt",
        p."updatedAt"
      FROM "NotebookProblem" p
      LEFT JOIN "Notebook" n ON n."id" = p."notebookId"
      LEFT JOIN "NotebookProblemProgress" progress
        ON progress."problemId" = p."id"
        AND ($3::text IS NOT NULL AND progress."userId" = $3)
      WHERE p."status" <> 'archived'
        AND ($1::text IS NULL OR p."notebookId" = $1)
        AND (
          $2::text IS NULL
          OR p."courseId" = $2
          OR (p."courseId" IS NULL AND n."courseId" = $2)
        )
        AND ($1::text IS NOT NULL OR $2::text IS NOT NULL)
        AND (
          $4::text IS NULL
          OR ($4::text = 'unattempted' AND COALESCE(progress."attemptedCount", 0) = 0)
          OR ($4::text = 'attempted' AND COALESCE(progress."attemptedCount", 0) > 0)
          OR ($4::text = 'wrong_or_partial' AND progress."status"::text IN ('failed', 'partial'))
        )
      ORDER BY COALESCE(progress."lastAttemptAt", p."updatedAt") DESC, p."updatedAt" DESC
      LIMIT 400
    `,
    args.notebookId || null,
    args.courseId || null,
    args.viewerUserId || null,
    args.progressFilter || null,
  );

  const anchors = specificAnchorTerms(terms);
  const scored = rows
    .map((row, index) => ({
      row,
      index,
      score: scoreProblem(row, terms, args.progressFilter),
    }))
    .filter((item) => item.score > 0);
  const anchored = scored.filter((item) => containsSpecificAnchor(anchors, item.row));
  return (anchored.length > 0 ? anchored : scored)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ row, score }) => ({
      id: row.id,
      sourceType: 'problem_bank',
      title: row.title,
      text: previewText(row),
      score,
      metadata: {
        courseId: row.courseId,
        notebookId: row.notebookId,
        problemType: row.type,
        difficulty: row.difficulty,
        tags: row.tags,
        status: row.status,
        notebookName: row.notebookName,
        attemptStatus: row.attemptStatus,
        attemptScore: row.attemptScore,
        attemptedCount: attemptedCount(row),
        lastAttemptAt: row.lastAttemptAt ? new Date(row.lastAttemptAt).toISOString() : null,
      },
    }));
}
