import type { PrismaClient } from '@/lib/server/generated-prisma';

export const BOUNDED_COURSE_SOURCE_RETRIEVAL_LIMITS = Object.freeze({
  maxQueryChars: 2_000,
  maxTerms: 32,
  maxSnippets: 12,
  maxSnippetChars: 1_600,
  maxTotalChars: 9_000,
  fallbackCandidatesPerBand: 8,
  fallbackMaxCandidates: 24,
  fallbackSummaryChars: 600,
});

export type BoundedCourseSourceSnippet = {
  id: string;
  sourceHash: string;
  sourceTitle: string;
  sourceType: 'course_source' | 'markdown_section';
  sourceId: string;
  notebookId: string | null;
  title: string;
  order: number;
  text: string;
  score: number;
  updatedAt: string;
};

export type BoundedCourseSourceRetrievalResult = {
  mode: 'knowledge_chunk' | 'markdown_fallback' | 'empty';
  snippets: BoundedCourseSourceSnippet[];
  databaseQueries: 0 | 1 | 2;
  totalChars: number;
};

type IndexedSnippetRow = {
  chunkId: string;
  sourceHash: string;
  sourceTitle: string;
  documentType: string;
  sourceEntityId: string;
  notebookId: string | null;
  title: string;
  chunkIndex: number;
  excerpt: string;
  score: number | string;
  updatedAt: Date | string;
};

type FallbackSnippetRow = {
  sectionId: string;
  sourceHash: string;
  sourceTitle: string;
  notebookId: string;
  title: string;
  sectionOrder: number;
  excerpt: string;
  excerptStart: number | string;
  originalLength: number | string;
  score: number | string;
  updatedAt: Date | string;
};

function normalizeQuery(input: string): string {
  return input
    .normalize('NFKC')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, BOUNDED_COURSE_SOURCE_RETRIEVAL_LIMITS.maxQueryChars);
}

function retrievalTerms(input: string): string[] {
  const normalized = input.normalize('NFKC').toLowerCase();
  const latin = normalized.match(/[a-z0-9][a-z0-9_+\-]{1,}/g) || [];
  const hanChunks = normalized.match(/[\u3400-\u9fff]{2,}/g) || [];
  const stopTokens = new Set([
    '一下',
    '一个',
    '这个',
    '那个',
    '我们',
    '你们',
    '他们',
    '为什么',
    '怎么',
    '如何',
    '说明',
    '解释',
  ]);
  const han = hanChunks.flatMap((chunk) => {
    const values = [chunk];
    for (const size of [2, 3, 4]) {
      for (let index = 0; index <= chunk.length - size; index += 1) {
        const token = chunk.slice(index, index + size);
        if (!stopTokens.has(token)) values.push(token);
      }
    }
    return values;
  });
  return Array.from(new Set([...latin, ...han]))
    .filter((term) => term.length >= 2)
    .slice(0, BOUNDED_COURSE_SOURCE_RETRIEVAL_LIMITS.maxTerms);
}

function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date(0).toISOString();
}

function numberValue(value: number | string): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function compactSnippet(input: string, maxChars: number): string {
  const text = String(input || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function enforceTotalBudget(snippets: BoundedCourseSourceSnippet[]): BoundedCourseSourceSnippet[] {
  const result: BoundedCourseSourceSnippet[] = [];
  let remaining = BOUNDED_COURSE_SOURCE_RETRIEVAL_LIMITS.maxTotalChars;
  for (const snippet of snippets.slice(0, BOUNDED_COURSE_SOURCE_RETRIEVAL_LIMITS.maxSnippets)) {
    if (remaining <= 0) break;
    const text = compactSnippet(
      snippet.text,
      Math.min(remaining, BOUNDED_COURSE_SOURCE_RETRIEVAL_LIMITS.maxSnippetChars),
    );
    if (!text) continue;
    result.push({ ...snippet, text });
    remaining -= text.length;
  }
  return result;
}

async function searchIndexedCourseSourceChunks(args: {
  prisma: PrismaClient;
  ownerId: string;
  courseId: string;
  query: string;
  terms: string[];
}): Promise<BoundedCourseSourceSnippet[]> {
  const limits = BOUNDED_COURSE_SOURCE_RETRIEVAL_LIMITS;
  const rows = await args.prisma.$queryRawUnsafe<IndexedSnippetRow[]>(
    `
      WITH scored_chunks AS (
        SELECT
          c."id" AS "chunkId",
          source."sourceHash",
          source."title" AS "sourceTitle",
          d."documentType",
          d."sourceEntityId",
          c."notebookId",
          d."title",
          c."chunkIndex",
          LEFT(c."chunkText", $5) AS "excerpt",
          (
            ts_rank_cd(
              to_tsvector('simple', c."chunkText"),
              plainto_tsquery('simple', $3)
            )
            + (
              SELECT COUNT(*)::float * 0.12
              FROM unnest($4::text[]) AS term
              WHERE c."chunkText" ILIKE ('%' || term || '%')
            )
          ) AS "score",
          d."updatedAt"
        FROM "KnowledgeChunk" c
        INNER JOIN "KnowledgeDocument" d
          ON d."id" = c."documentId"
        INNER JOIN "CourseSource" source
          ON source."id" = d."courseSourceId"
         AND source."courseId" = d."courseId"
         AND source."ownerId" = d."ownerId"
        WHERE c."courseId" = $1
          AND d."courseId" = $1
          AND source."courseId" = $1
          AND c."ownerId" = $2
          AND d."ownerId" = $2
          AND source."ownerId" = $2
          AND c."visibility" = 'course'
          AND d."visibility" = 'course'
          AND d."status" = 'ready'
          AND source."ingestStatus" = 'ready'
          AND source."indexStatus" = 'ready'
          AND source."kind" <> 'problem_bank'
          AND source."metadataJson"->>'allQuestionUpload' IS DISTINCT FROM 'true'
          AND c."documentType" = d."documentType"
          AND c."documentType" = ANY(ARRAY['course_source', 'markdown_section']::text[])
          AND c."courseSourceId" = d."courseSourceId"
          AND c."ownerId" = d."ownerId"
          AND (
            to_tsvector('simple', c."chunkText") @@ plainto_tsquery('simple', $3)
            OR EXISTS (
              SELECT 1
              FROM unnest($4::text[]) AS term
              WHERE c."chunkText" ILIKE ('%' || term || '%')
            )
          )
      ),
      one_chunk_per_document AS (
        SELECT
          scored_chunks.*,
          ROW_NUMBER() OVER (
            PARTITION BY scored_chunks."sourceEntityId"
            ORDER BY scored_chunks."score" DESC, scored_chunks."chunkIndex" ASC
          ) AS "documentRank"
        FROM scored_chunks
        WHERE scored_chunks."score" > 0
      ),
      clipped AS (
        SELECT *
        FROM one_chunk_per_document
        WHERE "documentRank" = 1
        ORDER BY "score" DESC, "updatedAt" DESC, "sourceEntityId" ASC
        LIMIT $6
      ),
      budgeted AS (
        SELECT
          clipped.*,
          SUM(length(clipped."excerpt")) OVER (
            ORDER BY clipped."score" DESC, clipped."updatedAt" DESC, clipped."sourceEntityId" ASC
          ) AS "cumulativeChars"
        FROM clipped
      )
      SELECT
        "chunkId",
        "sourceHash",
        "sourceTitle",
        "documentType",
        "sourceEntityId",
        "notebookId",
        "title",
        "chunkIndex",
        "excerpt",
        "score",
        "updatedAt"
      FROM budgeted
      WHERE "cumulativeChars" <= $7
      ORDER BY "score" DESC, "updatedAt" DESC, "sourceEntityId" ASC
    `,
    args.courseId,
    args.ownerId,
    args.query,
    args.terms,
    limits.maxSnippetChars,
    limits.maxSnippets,
    limits.maxTotalChars,
  );

  return enforceTotalBudget(
    rows.map((row) => ({
      id: `knowledge-chunk:${row.chunkId}`,
      sourceHash: row.sourceHash,
      sourceTitle: row.sourceTitle,
      sourceType: row.documentType === 'course_source' ? 'course_source' : 'markdown_section',
      sourceId: row.sourceEntityId,
      notebookId: row.notebookId,
      title: row.title,
      order: Math.max(0, Number(row.chunkIndex) || 0),
      text: row.excerpt,
      score: numberValue(row.score),
      updatedAt: isoDate(row.updatedAt),
    })),
  );
}

async function searchBoundedMarkdownFallback(args: {
  prisma: PrismaClient;
  ownerId: string;
  courseId: string;
  query: string;
  terms: string[];
}): Promise<BoundedCourseSourceSnippet[]> {
  const limits = BOUNDED_COURSE_SOURCE_RETRIEVAL_LIMITS;
  const rows = await args.prisma.$queryRawUnsafe<FallbackSnippetRow[]>(
    `
      WITH eligible_metadata AS MATERIALIZED (
        SELECT
          section."id",
          section."notebookId",
          section."title",
          section."order",
          LEFT(COALESCE(section."summary", ''), $9) AS "summary",
          section."sourceMeta"->>'sourceHash' AS "sourceHash",
          COALESCE(
            source."title",
            section."sourceMeta"->>'sourceTitle',
            notebook."name"
          ) AS "sourceTitle",
          section."updatedAt"
        FROM "MarkdownNotebookSection" section
        INNER JOIN "Notebook" notebook
          ON notebook."id" = section."notebookId"
        LEFT JOIN "CourseSource" source
          ON source."courseId" = $1
         AND source."ownerId" = $2
         AND source."sourceHash" = section."sourceMeta"->>'sourceHash'
        WHERE COALESCE(section."courseId", notebook."courseId") = $1
          AND notebook."ownerId" = $2
          AND section."sourceMeta"->>'sourceHash' IS NOT NULL
          AND (
            source."id" IS NULL
            OR (
              source."ingestStatus" = 'ready'
              AND source."kind" <> 'problem_bank'
              AND source."metadataJson"->>'allQuestionUpload' IS DISTINCT FROM 'true'
            )
          )
      ),
      metadata_hits AS (
        SELECT metadata."id"
        FROM eligible_metadata metadata
        WHERE EXISTS (
          SELECT 1
          FROM unnest($4::text[]) AS term
          WHERE metadata."title" ILIKE ('%' || term || '%')
             OR metadata."summary" ILIKE ('%' || term || '%')
             OR metadata."sourceTitle" ILIKE ('%' || term || '%')
        )
        ORDER BY metadata."updatedAt" DESC, metadata."order" ASC
        LIMIT $5
      ),
      ordered_head AS (
        SELECT metadata."id"
        FROM eligible_metadata metadata
        ORDER BY metadata."order" ASC, metadata."updatedAt" DESC
        LIMIT $5
      ),
      recent_head AS (
        SELECT metadata."id"
        FROM eligible_metadata metadata
        ORDER BY metadata."updatedAt" DESC, metadata."order" ASC
        LIMIT $5
      ),
      candidate_ids AS (
        SELECT "id" FROM metadata_hits
        UNION
        SELECT "id" FROM ordered_head
        UNION
        SELECT "id" FROM recent_head
        LIMIT $10
      ),
      scored_candidates AS (
        SELECT
          section."id" AS "sectionId",
          metadata."sourceHash",
          metadata."sourceTitle",
          section."notebookId",
          section."title",
          section."order" AS "sectionOrder",
          GREATEST(
            1,
            COALESCE(first_hit."position", 1) - FLOOR($6::float * 0.35)::int
          ) AS "excerptStart",
          length(section."markdown") AS "originalLength",
          substring(
            section."markdown"
            FROM GREATEST(
              1,
              COALESCE(first_hit."position", 1) - FLOOR($6::float * 0.35)::int
            )
            FOR $6
          ) AS "excerpt",
          (
            ts_rank_cd(
              to_tsvector('simple', section."markdown"),
              plainto_tsquery('simple', $3)
            )
            + (
              SELECT COUNT(*)::float * 0.12
              FROM unnest($4::text[]) AS term
              WHERE section."markdown" ILIKE ('%' || term || '%')
            )
            + (
              SELECT COUNT(*)::float * 0.24
              FROM unnest($4::text[]) AS term
              WHERE metadata."title" ILIKE ('%' || term || '%')
                 OR metadata."summary" ILIKE ('%' || term || '%')
                 OR metadata."sourceTitle" ILIKE ('%' || term || '%')
            )
          ) AS "score",
          section."updatedAt"
        FROM candidate_ids candidate
        INNER JOIN eligible_metadata metadata ON metadata."id" = candidate."id"
        INNER JOIN "MarkdownNotebookSection" section ON section."id" = candidate."id"
        LEFT JOIN LATERAL (
          SELECT MIN(NULLIF(strpos(lower(section."markdown"), lower(term)), 0)) AS "position"
          FROM unnest($4::text[]) AS term
        ) first_hit ON TRUE
      ),
      clipped AS (
        SELECT *
        FROM scored_candidates
        WHERE "score" > 0
        ORDER BY "score" DESC, "updatedAt" DESC, "sectionId" ASC
        LIMIT $7
      ),
      budgeted AS (
        SELECT
          clipped.*,
          SUM(length(clipped."excerpt")) OVER (
            ORDER BY clipped."score" DESC, clipped."updatedAt" DESC, clipped."sectionId" ASC
          ) AS "cumulativeChars"
        FROM clipped
      )
      SELECT
        "sectionId",
        "sourceHash",
        "sourceTitle",
        "notebookId",
        "title",
        "sectionOrder",
        "excerpt",
        "excerptStart",
        "originalLength",
        "score",
        "updatedAt"
      FROM budgeted
      WHERE "cumulativeChars" <= $8
      ORDER BY "score" DESC, "updatedAt" DESC, "sectionId" ASC
    `,
    args.courseId,
    args.ownerId,
    args.query,
    args.terms,
    limits.fallbackCandidatesPerBand,
    limits.maxSnippetChars,
    limits.maxSnippets,
    limits.maxTotalChars,
    limits.fallbackSummaryChars,
    limits.fallbackMaxCandidates,
  );

  return enforceTotalBudget(
    rows.map((row) => {
      const excerptStart = numberValue(row.excerptStart);
      const originalLength = numberValue(row.originalLength);
      const leading = excerptStart > 1 ? '… ' : '';
      const trailing = excerptStart - 1 + row.excerpt.length < originalLength ? ' …' : '';
      return {
        id: `markdown-fallback:${row.sectionId}`,
        sourceHash: row.sourceHash,
        sourceTitle: row.sourceTitle,
        sourceType: 'markdown_section' as const,
        sourceId: row.sectionId,
        notebookId: row.notebookId,
        title: row.title,
        order: Math.max(0, Number(row.sectionOrder) || 0),
        text: `${leading}${row.excerpt.trim()}${trailing}`,
        score: numberValue(row.score),
        updatedAt: isoDate(row.updatedAt),
      };
    }),
  );
}

/**
 * Retrieves prompt-sized course-source evidence without loading whole Markdown
 * sections into Node. A ready KnowledgeChunk projection is preferred. The
 * fallback first selects three small metadata bands, then reads Markdown only
 * for those IDs and returns a SQL-budgeted excerpt window. `ownerId` and
 * `courseId` must come from a server-verified course-access result.
 */
export async function retrieveBoundedCourseSourceSnippets(args: {
  prisma: PrismaClient;
  ownerId: string;
  courseId: string;
  query: string;
}): Promise<BoundedCourseSourceRetrievalResult> {
  const query = normalizeQuery(args.query);
  const terms = retrievalTerms(query);
  if (!query || terms.length === 0 || !args.ownerId.trim() || !args.courseId.trim()) {
    return { mode: 'empty', snippets: [], databaseQueries: 0, totalChars: 0 };
  }

  let databaseQueries: 1 | 2 = 1;
  try {
    const snippets = await searchIndexedCourseSourceChunks({
      ...args,
      query,
      terms,
    });
    if (snippets.length > 0) {
      return {
        mode: 'knowledge_chunk',
        snippets,
        databaseQueries,
        totalChars: snippets.reduce((total, snippet) => total + snippet.text.length, 0),
      };
    }
  } catch {
    // Missing/stale knowledge projections are allowed to use the bounded source fallback.
  }

  databaseQueries = 2;
  const snippets = await searchBoundedMarkdownFallback({
    ...args,
    query,
    terms,
  });
  return {
    mode: snippets.length > 0 ? 'markdown_fallback' : 'empty',
    snippets,
    databaseQueries,
    totalChars: snippets.reduce((total, snippet) => total + snippet.text.length, 0),
  };
}
