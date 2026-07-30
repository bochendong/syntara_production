import type { LanguageModel } from 'ai';
import type { TrustedCourseAccess } from '@/features/chat/server/trusted-course-turn';
import {
  retrieveBoundedCourseSourceSnippets,
  type BoundedCourseSourceSnippet,
} from '@/features/memory/server/bounded-course-source-retrieval';
import {
  buildLayeredMemoryRecallContext,
  type LayeredMemoryRecallContext,
} from '@/features/memory/server/layered-memory-context';
import {
  listCourseSourceUploads,
  type CourseSourceUploadRecord,
} from '@/features/memory/server/source-upload-library';
import { COURSE_ORCHESTRATOR_ID, COURSE_ORCHESTRATOR_NAME } from '@/lib/constants/course-chat';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { planMemorySearchIntent, type MemorySearchIntent } from '@/lib/server/memory-search-intent';
import { prisma as defaultPrisma } from '@/lib/server/prisma';
import {
  findCourseAccessRole,
  type CourseAccessRole,
} from '@/lib/server/repositories/course-enrollment-repository';
import type {
  CourseChatAnswererHandoff,
  CourseChatContext,
  CourseChatContextNotebook,
  CourseChatContextPage,
  CourseChatEvidenceSummary,
  CourseChatLayeredMemoryContext,
  CourseChatResourceLoadState,
} from '@/lib/types/chat';

export const TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS = Object.freeze({
  maxSources: 4,
  maxSectionsPerSource: 3,
  maxSectionChars: 1_600,
  maxSourceTextChars: 9_000,
  maxEvidenceItems: 12,
  maxEvidenceExcerptChars: 650,
});

const MIN_USEFUL_SECTION_CHARS = 220;
const MAX_RETRIEVAL_QUERY_CHARS = 2_000;

export type TrustedCourseQuestionEvidenceOrigin =
  | 'course_source'
  | 'layered_memory'
  | 'problem_bank';

/**
 * A deliberately small, transport-safe evidence summary. API routes can return
 * this object without exposing full source records, ingestion artifacts, or
 * private memory rows.
 */
export type TrustedCourseQuestionEvidenceSummary = CourseChatEvidenceSummary & {
  origin: TrustedCourseQuestionEvidenceOrigin;
};

export type TrustedCourseQuestionContextResult = {
  courseContext: CourseChatContext;
  evidence: TrustedCourseQuestionEvidenceSummary[];
  accessRole: CourseAccessRole;
  searchIntent: MemorySearchIntent;
};

export class TrustedCourseQuestionContextError extends Error {
  readonly code: 'INVALID_QUESTION' | 'COURSE_NOT_FOUND';

  constructor(code: TrustedCourseQuestionContextError['code'], message: string) {
    super(message);
    this.name = 'TrustedCourseQuestionContextError';
    this.code = code;
  }
}

type SourcePageCandidate = {
  page: CourseChatContextPage;
  notebookId: string | null;
  sourceHash: string;
  sourceTitle: string;
  sourceType: 'course_source' | 'markdown_section';
  sourceId: string;
  sourceOrder: number;
};

type SourceCandidate = {
  source: CourseSourceUploadRecord;
  rankedPages: SourcePageCandidate[];
  score: number;
  updatedAt: number;
};

type SelectedSourceContext = {
  notebooks: CourseChatContextNotebook[];
  evidence: TrustedCourseQuestionEvidenceSummary[];
};

function compactText(input: string | null | undefined, maxChars: number): string {
  const text = String(input || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 1)).trim()}…`;
}

function normalizeForSearch(input: string): string {
  return input.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

function queryTokens(input: string): string[] {
  const normalized = normalizeForSearch(input);
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
    const tokens = [chunk];
    for (const size of [2, 3, 4]) {
      for (let index = 0; index <= chunk.length - size; index += 1) {
        const token = chunk.slice(index, index + size);
        if (!stopTokens.has(token)) tokens.push(token);
      }
    }
    return tokens;
  });
  return Array.from(new Set([...latin, ...han])).slice(0, 80);
}

function scoreText(tokens: string[], input: string): number {
  if (tokens.length === 0 || !input.trim()) return 0;
  const normalized = normalizeForSearch(input);
  return tokens.reduce((score, token) => {
    if (!normalized.includes(token)) return score;
    return score + (token.length >= 6 ? 4 : token.length >= 4 ? 3 : 2);
  }, 0);
}

function focusedDigest(input: string, tokens: string[]): string {
  const text = compactText(input, Number.MAX_SAFE_INTEGER);
  const maxChars = TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxSectionChars;
  if (text.length <= maxChars) return text;

  const normalized = normalizeForSearch(text);
  const firstHit = tokens
    .map((token) => normalized.indexOf(token))
    .filter((index) => index >= 0)
    .sort((left, right) => left - right)[0];
  if (firstHit === undefined) return compactText(text, maxChars);

  const preferredStart = Math.max(0, firstHit - Math.floor(maxChars * 0.35));
  const start = Math.min(preferredStart, Math.max(0, text.length - maxChars));
  const end = Math.min(text.length, start + maxChars);
  return `${start > 0 ? '… ' : ''}${text.slice(start, end).trim()}${end < text.length ? ' …' : ''}`;
}

function sourceTextState(
  source: CourseSourceUploadRecord,
  retrievedSnippetCount = 0,
): CourseChatResourceLoadState {
  const count = Math.max(
    source.stats.sectionCount,
    source.textSections.filter((section) => section.markdown.trim()).length,
    retrievedSnippetCount,
  );
  if (count > 0) return { status: 'ready', itemCount: count };
  if (source.ingestStatus === 'processing') return { status: 'loading', itemCount: 0 };
  if (source.ingestStatus === 'error') {
    return {
      status: 'error',
      itemCount: 0,
      error: source.errorReason || '课程资料暂时无法读取。',
    };
  }
  return { status: 'empty', itemCount: 0 };
}

function overallSourceState(
  sources: CourseSourceUploadRecord[],
  loadFailed: boolean,
  retrievedSnippetCount = 0,
): CourseChatResourceLoadState {
  if (loadFailed) {
    return {
      status: 'error',
      itemCount: 0,
      error: '课程资料暂时无法读取。',
    };
  }
  const sectionCount = Math.max(
    retrievedSnippetCount,
    sources.reduce(
      (count, source) =>
        count +
        Math.max(
          source.stats.sectionCount,
          source.textSections.filter((section) => section.markdown.trim()).length,
        ),
      0,
    ),
  );
  if (sectionCount > 0) return { status: 'ready', itemCount: sectionCount };
  if (sources.some((source) => source.ingestStatus === 'processing')) {
    return { status: 'loading', itemCount: 0 };
  }
  const failed = sources.find((source) => source.ingestStatus === 'error');
  if (failed) {
    return {
      status: 'error',
      itemCount: 0,
      error: failed.errorReason || '课程资料暂时无法读取。',
    };
  }
  return { status: 'empty', itemCount: 0 };
}

function countState(count: number): CourseChatResourceLoadState {
  return {
    status: count > 0 ? 'ready' : 'empty',
    itemCount: Math.max(0, count),
  };
}

function courseLanguage(value: string): 'zh-CN' | 'en-US' | undefined {
  if (value === 'zh-CN' || value === 'en-US') return value;
  return undefined;
}

function coursePurpose(value: string): 'research' | 'university' | 'daily' | undefined {
  if (value === 'research' || value === 'university' || value === 'daily') return value;
  return undefined;
}

function buildSourceCandidates(
  sources: CourseSourceUploadRecord[],
  snippets: BoundedCourseSourceSnippet[],
  tokens: string[],
): SourceCandidate[] {
  const snippetsBySourceHash = new Map<string, BoundedCourseSourceSnippet[]>();
  for (const snippet of snippets) {
    const bucket = snippetsBySourceHash.get(snippet.sourceHash) || [];
    bucket.push(snippet);
    snippetsBySourceHash.set(snippet.sourceHash, bucket);
  }

  return sources.map((source) => {
    const sortedSections = (snippetsBySourceHash.get(source.sourceHash) || [])
      .slice()
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.order - right.order ||
          left.title.localeCompare(right.title, 'zh-CN'),
      );
    const pages = sortedSections.map<SourcePageCandidate>((section, index) => {
      const title = section.title.trim() || '未命名章节';
      const contentScore = scoreText(tokens, section.text);
      const titleScore = scoreText(tokens, title) * 2;
      return {
        page: {
          id: section.id,
          order: index + 1,
          title,
          digest: focusedDigest(section.text, tokens),
          sourceScore: section.score + titleScore + contentScore,
        },
        notebookId: section.notebookId,
        sourceHash: source.sourceHash,
        sourceTitle:
          section.sourceTitle.trim() || source.title.trim() || source.topic?.trim() || '未命名资料',
        sourceType: section.sourceType,
        sourceId: section.sourceId,
        sourceOrder: section.order,
      };
    });
    const rankedPages = pages
      .slice()
      .sort(
        (left, right) =>
          right.page.sourceScore - left.page.sourceScore || left.sourceOrder - right.sourceOrder,
      );
    const metadataScore =
      scoreText(
        tokens,
        [source.title, source.topic || '', source.kind, source.usageProfile || ''].join(' '),
      ) * 2;
    const pageScores = rankedPages.map((page) => page.page.sourceScore);
    const score =
      metadataScore +
      (pageScores[0] || 0) * 3 +
      pageScores
        .slice(1, TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxSectionsPerSource)
        .reduce((total, value) => total + value, 0);
    return {
      source,
      rankedPages,
      score,
      updatedAt: Date.parse(source.updatedAt) || 0,
    };
  });
}

function selectSourceContext(
  sources: CourseSourceUploadRecord[],
  snippets: BoundedCourseSourceSnippet[],
  tokens: string[],
  courseId: string,
): SelectedSourceContext {
  const selectedCandidates = buildSourceCandidates(sources, snippets, tokens)
    .filter((candidate) => candidate.score > 0 && candidate.rankedPages.length > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.updatedAt - left.updatedAt ||
        left.source.sourceHash.localeCompare(right.source.sourceHash),
    )
    .slice(0, TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxSources);
  const selectedPages = new Map<string, SourcePageCandidate[]>();
  let remainingChars = TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxSourceTextChars;

  // Round-robin allocation keeps a highly relevant page from each selected
  // source before spending the remaining prompt budget on secondary sections.
  for (
    let rank = 0;
    rank < TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxSectionsPerSource;
    rank += 1
  ) {
    for (const candidate of selectedCandidates) {
      const page = candidate.rankedPages[rank];
      if (!page || remainingChars < MIN_USEFUL_SECTION_CHARS) continue;
      const digest = compactText(page.page.digest, remainingChars);
      if (digest.length < MIN_USEFUL_SECTION_CHARS && page.page.digest.length > digest.length) {
        continue;
      }
      const selectedPage = {
        ...page,
        page: {
          ...page.page,
          digest,
        },
      };
      const bucket = selectedPages.get(candidate.source.sourceHash) || [];
      bucket.push(selectedPage);
      selectedPages.set(candidate.source.sourceHash, bucket);
      remainingChars -= digest.length;
    }
  }

  const notebooks = selectedCandidates.map<CourseChatContextNotebook>((candidate) => {
    const pages = (selectedPages.get(candidate.source.sourceHash) || [])
      .sort((left, right) => left.sourceOrder - right.sourceOrder)
      .map((selected) => selected.page);
    const tags = Array.from(
      new Set(
        [candidate.source.kind.trim(), candidate.source.usageProfile?.trim()].filter(
          (value): value is string => Boolean(value),
        ),
      ),
    );
    return {
      id: `source:${courseId}:${candidate.source.sourceHash}`,
      name: candidate.source.title.trim() || candidate.source.topic?.trim() || '未命名课程资料',
      description: candidate.source.topic?.trim() || undefined,
      tags,
      updatedAt: candidate.updatedAt || undefined,
      pages,
      pagesState: sourceTextState(candidate.source, candidate.rankedPages.length),
      sourceScore: candidate.score,
    };
  });

  const evidence = selectedCandidates
    .flatMap((candidate) => selectedPages.get(candidate.source.sourceHash) || [])
    .sort(
      (left, right) =>
        right.page.sourceScore - left.page.sourceScore || left.sourceOrder - right.sourceOrder,
    )
    .slice(0, Math.ceil(TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxEvidenceItems / 2))
    .map<TrustedCourseQuestionEvidenceSummary>((selected) => ({
      id: `course-source:${selected.sourceHash}:${selected.page.id}`,
      origin: 'course_source',
      sourceType: selected.sourceType,
      sourceId: selected.sourceId,
      title: `${selected.sourceTitle} · ${selected.page.title}`,
      excerpt: compactText(
        selected.page.digest,
        TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxEvidenceExcerptChars,
      ),
      score: selected.page.sourceScore,
      courseId,
      notebookId: selected.notebookId || undefined,
      sourceHash: selected.sourceHash,
    }));

  return {
    notebooks,
    evidence,
  };
}

function toCourseLayeredMemory(
  context: LayeredMemoryRecallContext,
): CourseChatLayeredMemoryContext {
  return {
    storage: context.storage,
    prompt: context.prompt,
    vectorUsed: context.vectorUsed,
    counts: {
      direct: context.directCount,
      semantic: context.semanticCount,
      knowledgeCache: context.knowledgeCacheCount,
      knowledge: context.knowledgeCount,
      sourceEvidence: context.sourceEvidenceCount,
      learnerAnalytics: context.learnerAnalyticsCount,
    },
    scope: {
      effectiveMode: context.scope.effectiveMode,
      expanded: context.scope.expanded,
      reason: context.scope.reason,
    },
    searchIntent: {
      kind: context.searchIntent.kind,
      rewrittenQuery: context.searchIntent.rewrittenQuery,
      progressFilter: context.searchIntent.progressFilter,
      knowledgeTypes: context.searchIntent.knowledgeTypes,
      sourceGrounding: context.searchIntent.sourceGrounding,
    },
    knowledgeMatches: context.knowledgeMatches,
    sourceEvidence: context.sourceEvidence,
    semanticMatches: context.semanticMatches,
    knowledgeCache: context.knowledgeCache,
  };
}

function memoryEvidence(
  context: LayeredMemoryRecallContext,
  courseId: string,
): TrustedCourseQuestionEvidenceSummary[] {
  const sourceEvidence = context.sourceEvidence
    .filter((item) => !item.courseId || item.courseId === courseId)
    .map<TrustedCourseQuestionEvidenceSummary>((item) => ({
      id: `layered-memory:${item.sourceType}:${item.sourceId}`,
      origin: 'layered_memory',
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      title: item.title,
      excerpt: compactText(
        item.renderedText || item.originalText,
        TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxEvidenceExcerptChars,
      ),
      score: item.score,
      courseId,
      notebookId: item.notebookId || undefined,
    }));
  const problemEvidence = context.knowledgeMatches
    .filter((item) => !item.metadata.courseId || item.metadata.courseId === courseId)
    .map<TrustedCourseQuestionEvidenceSummary>((item) => ({
      id: `problem-bank:${item.id}`,
      origin: 'problem_bank',
      sourceType: item.sourceType,
      sourceId: item.id,
      title: item.title,
      excerpt: compactText(
        item.text,
        TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxEvidenceExcerptChars,
      ),
      score: item.score,
      courseId,
      notebookId: item.metadata.notebookId || undefined,
    }));

  return [...sourceEvidence, ...problemEvidence]
    .filter((item) => item.excerpt)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, Math.floor(TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxEvidenceItems / 2));
}

function uniqueEvidence(
  items: TrustedCourseQuestionEvidenceSummary[],
): TrustedCourseQuestionEvidenceSummary[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.sourceType}:${item.sourceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueHandoffStrings(primary: string[], fallback: string[], maxItems = 16): string[] {
  return Array.from(
    new Set(
      [...primary, ...fallback]
        .map((item) => item.normalize('NFKC').replace(/\s+/g, ' ').trim())
        .filter(Boolean),
    ),
  ).slice(0, maxItems);
}

function mergeTrustedPlannerHandoff(
  serverHandoff: CourseChatAnswererHandoff,
  plannerHandoff: CourseChatAnswererHandoff | undefined,
): CourseChatAnswererHandoff {
  if (!plannerHandoff) return serverHandoff;

  return {
    runId: plannerHandoff.runId,
    intent: plannerHandoff.intent,
    reasonSummary: [plannerHandoff.reasonSummary, serverHandoff.reasonSummary]
      .filter(Boolean)
      .join(' ')
      .slice(0, 1_500),
    // Planner evidence can originate in the request/semantic classification.
    // Only authenticated database retrieval is evidence for the answerer.
    evidence: serverHandoff.evidence,
    requiredBehavior: uniqueHandoffStrings(
      plannerHandoff.requiredBehavior,
      serverHandoff.requiredBehavior,
    ),
    forbiddenBehavior: uniqueHandoffStrings(
      plannerHandoff.forbiddenBehavior,
      serverHandoff.forbiddenBehavior,
    ),
    missingEvidence: uniqueHandoffStrings(
      plannerHandoff.missingEvidence,
      serverHandoff.missingEvidence,
    ),
    // Live server reads are authoritative for resource availability.
    resourceStates: serverHandoff.resourceStates,
  };
}

async function loadCourseSources(args: {
  prisma: PrismaClient;
  userId: string;
  courseId: string;
  query: string;
  verifiedAccess: { ownerId: string; accessRole: CourseAccessRole };
}): Promise<{
  sources: CourseSourceUploadRecord[];
  snippets: BoundedCourseSourceSnippet[];
  failed: boolean;
}> {
  try {
    const [records, retrieval] = await Promise.all([
      listCourseSourceUploads({
        prisma: args.prisma,
        userId: args.userId,
        courseId: args.courseId,
        verifiedAccess: args.verifiedAccess,
        // The answer path starts with source metadata only. Prompt-sized text
        // comes from the bounded KnowledgeChunk/fallback query below.
        includeTextSections: false,
        includeArtifacts: false,
      }),
      retrieveBoundedCourseSourceSnippets({
        prisma: args.prisma,
        ownerId: args.verifiedAccess.ownerId,
        courseId: args.courseId,
        query: args.query,
      }).catch(() => null),
    ]);
    return {
      sources: records.filter(
        (source) => source.allQuestionUpload !== true && source.kind !== 'problem_bank',
      ),
      snippets: retrieval?.snippets || [],
      failed: retrieval === null,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'Course not found') {
      throw new TrustedCourseQuestionContextError('COURSE_NOT_FOUND', 'Course not found');
    }
    return { sources: [], snippets: [], failed: true };
  }
}

/**
 * Builds course-question context entirely from authenticated server state.
 *
 * The caller supplies only identity, stable IDs, the question, and a
 * server-resolved model. Course metadata, sources, learner memory, and resource
 * counts are all resolved here; no client-provided CourseChatContext is merged.
 */
export async function buildTrustedCourseQuestionContext(args: {
  userId: string;
  courseId: string;
  question: string;
  conversationId?: string | null;
  searchIntent?: MemorySearchIntent;
  trustedAccess?: TrustedCourseAccess;
  trustedPlannerHandoff?: CourseChatAnswererHandoff;
  model: LanguageModel;
  prisma?: PrismaClient;
}): Promise<TrustedCourseQuestionContextResult> {
  const userId = args.userId.trim();
  const courseId = args.courseId.trim();
  const question = compactText(args.question, MAX_RETRIEVAL_QUERY_CHARS);
  if (!question) {
    throw new TrustedCourseQuestionContextError('INVALID_QUESTION', 'Question is required');
  }
  if (!userId || !courseId) {
    throw new TrustedCourseQuestionContextError('COURSE_NOT_FOUND', 'Course not found');
  }

  const prisma = args.prisma || defaultPrisma;
  if (
    args.trustedAccess &&
    (args.trustedAccess.userId !== userId || args.trustedAccess.course.id !== courseId)
  ) {
    throw new TrustedCourseQuestionContextError('COURSE_NOT_FOUND', 'Course not found');
  }
  const [accessRole, course] = args.trustedAccess
    ? [args.trustedAccess.role, args.trustedAccess.course]
    : await Promise.all([
        findCourseAccessRole(prisma, userId, courseId),
        prisma.course.findUnique({
          where: { id: courseId },
          select: {
            id: true,
            ownerId: true,
            name: true,
            description: true,
            language: true,
            purpose: true,
            tags: true,
            university: true,
            courseCode: true,
            notebookCount: true,
            problemCount: true,
          },
        }),
      ]);
  if (!accessRole || !course) {
    throw new TrustedCourseQuestionContextError('COURSE_NOT_FOUND', 'Course not found');
  }

  const searchIntent =
    args.searchIntent ??
    (await planMemorySearchIntent({
      query: question,
      model: args.model,
      targetType: 'course',
    }));
  const sourceRetrievalQuery = compactText(
    [question, searchIntent.rewrittenQuery, ...searchIntent.plan.searchQueries.slice(0, 3)].join(
      ' ',
    ),
    MAX_RETRIEVAL_QUERY_CHARS,
  );
  const [sourceLoad, layeredMemory] = await Promise.all([
    loadCourseSources({
      prisma,
      userId,
      courseId,
      query: sourceRetrievalQuery,
      verifiedAccess: {
        ownerId: course.ownerId,
        accessRole,
      },
    }),
    buildLayeredMemoryRecallContext({
      targetType: 'course',
      targetId: courseId,
      userId,
      question: searchIntent.rewrittenQuery || question,
      conversationId: args.conversationId?.trim() || null,
      searchIntent,
      skipMarkdownSourceEvidence: true,
      // Course access and ownership were already resolved above. Reuse that
      // trusted server state instead of issuing a second course-access query
      // inside the memory layer.
      resolvedTarget: {
        targetType: 'course',
        targetId: courseId,
        courseId,
        notebookId: null,
        targetOwnerId: course.ownerId,
        accessRole,
      },
    }),
  ]);

  const tokens = queryTokens(sourceRetrievalQuery);
  const selectedSources = selectSourceContext(
    sourceLoad.sources,
    sourceLoad.snippets,
    tokens,
    courseId,
  );
  const evidence = uniqueEvidence([
    ...selectedSources.evidence,
    ...memoryEvidence(layeredMemory, courseId),
  ]).slice(0, TRUSTED_COURSE_QUESTION_CONTEXT_LIMITS.maxEvidenceItems);
  const resourceStates = {
    notebooks: countState(course.notebookCount),
    problems: countState(course.problemCount),
    sources: overallSourceState(sourceLoad.sources, sourceLoad.failed, sourceLoad.snippets.length),
  };
  const hasCourseSourceEvidence = evidence.some((item) => item.origin === 'course_source');
  const serverAnswererHandoff: CourseChatAnswererHandoff = {
    runId: `trusted-course-answer:${courseId}`,
    intent: `course_answer:${searchIntent.kind}`,
    reasonSummary:
      'The server rebuilt the answer context from authenticated course sources and learner memory.',
    evidence: evidence.slice(0, 8).map((item) => ({
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      title: item.title,
      quoteOrSummary: item.excerpt,
      supports: `Ground the answer in this ${item.origin.replaceAll('_', ' ')} evidence.`,
      confidence: item.score,
    })),
    requiredBehavior: [
      'Answer the learner question directly before offering optional next steps.',
      'Use the supplied trusted evidence for course-specific claims and clearly distinguish explanation from source-grounded facts.',
      'Explain the reasoning, include one useful example or check when relevant, and call out a likely misconception.',
    ],
    forbiddenBehavior: [
      'Do not invent course-source claims, learner history, or problem-bank items.',
      'Do not execute calendar, plan, practice, classroom, image, or memory mutations unless the learner explicitly requested that workflow and the application supplied a confirmation-gated action.',
    ],
    missingEvidence:
      searchIntent.sourceGrounding.required && !hasCourseSourceEvidence
        ? [
            'The question requires original-source grounding, but no matching course-source excerpt was retrieved. State that limitation instead of fabricating a citation.',
          ]
        : [],
    resourceStates: {
      notebooks: resourceStates.notebooks.status,
      problems: resourceStates.problems.status,
      sources: resourceStates.sources.status,
    },
  };

  return {
    accessRole,
    searchIntent,
    evidence,
    courseContext: {
      course: {
        id: course.id,
        name: course.name,
        description: course.description || undefined,
        language: courseLanguage(course.language),
        purpose: coursePurpose(course.purpose),
        tags: course.tags,
        university: course.university || undefined,
        courseCode: course.courseCode || undefined,
      },
      target: {
        kind: 'orchestrator',
        id: COURSE_ORCHESTRATOR_ID,
        name: COURSE_ORCHESTRATOR_NAME,
        role: 'teacher',
      },
      notebooks: selectedSources.notebooks,
      resourceStates,
      answererHandoff: mergeTrustedPlannerHandoff(
        serverAnswererHandoff,
        args.trustedPlannerHandoff,
      ),
      layeredMemory: toCourseLayeredMemory(layeredMemory),
    },
  };
}
