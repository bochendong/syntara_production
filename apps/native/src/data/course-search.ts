import type { LocalCourseSearchResult } from '../domain/models';

function normalizedText(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase();
}

export function courseSearchTerms(query: string): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

  for (const segment of segmenter.segment(normalizedText(query))) {
    if (!segment.isWordLike) continue;
    const term = segment.segment
      .replace(/[^\p{Letter}\p{Number}_+-]/gu, '')
      .replace(/["*]/g, '')
      .trim();
    const codePointLength = [...term].length;
    if (codePointLength < 3 || codePointLength > 48 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= 10) break;
  }

  return terms;
}

export function rankCourseSearchResults(
  candidates: LocalCourseSearchResult[],
  query: string,
  limit = 20,
): LocalCourseSearchResult[] {
  const terms = courseSearchTerms(query);
  const normalizedQuery = normalizedText(query).trim();
  return candidates
    .map((result) => {
      const title = normalizedText(result.title);
      const excerpt = normalizedText(result.excerpt);
      const relevance = terms.reduce(
        (score, term) => {
          if (title.includes(term)) return score + 12 + [...term].length;
          if (excerpt.includes(term)) return score + 4 + [...term].length;
          return score;
        },
        title.includes(normalizedQuery) || excerpt.includes(normalizedQuery) ? 20 : 0,
      );
      return { result, relevance };
    })
    .filter(({ relevance }) => relevance > 0)
    .sort(
      (left, right) =>
        right.relevance - left.relevance || right.result.updatedAt - left.result.updatedAt,
    )
    .slice(0, limit)
    .map(({ result }) => result);
}
