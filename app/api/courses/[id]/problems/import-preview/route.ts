import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/server/prisma';
import { requireUserId } from '@/lib/server/api-auth';
import { assertUserHasCredits, chargeCreditsForWebSearch } from '@/lib/server/credits';
import { safeRoute } from '@/lib/server/json-error-response';
import { resolveWebSearchApiKey } from '@/lib/server/provider-config';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';
import {
  createProblemImportBatch,
  markProblemImportBatchCommitted,
} from '@/lib/server/notebook-problems/import-batch-store';
import { extractProblemDraftsFromText } from '@/features/problems/server/import';
import {
  ensureLegacyProblemsBackfilledForCourse,
  previewCourseProblemDraftDedupe,
} from '@/features/problems/server/service';
import { estimateWebSearchRetailCostCredits } from '@/lib/utils/openai-pricing';
import { formatSearchResultsAsContext, searchWithTavily } from '@/lib/web-search/tavily';

const previewSchema = z
  .object({
    source: z.enum(['chat', 'pdf', 'manual', 'web']).default('manual'),
    text: z.string().trim().max(120000).default(''),
    searchQuery: z.string().trim().max(400).optional(),
    webSearchApiKey: z.string().trim().max(200).optional(),
    sourceFileName: z.string().trim().max(240).optional(),
    sourceFileMime: z.string().trim().max(120).optional(),
    language: z.enum(['zh-CN', 'en-US']).default('zh-CN'),
  })
  .superRefine((value, ctx) => {
    if (value.source === 'web') {
      if (!value.searchQuery?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['searchQuery'],
          message: 'searchQuery is required for web imports',
        });
      }
      return;
    }
    if (!value.text.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['text'],
        message: 'text is required for non-web imports',
      });
    }
  });

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  return safeRoute(async () => {
    const auth = await requireUserId();
    if ('response' in auth) return auth.response;
    const { id } = await context.params;
    const course = await prisma.course.findFirst({
      where: { id, ownerId: auth.userId },
      select: { id: true },
    });
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 });
    }

    await ensureLegacyProblemsBackfilledForCourse(auth.userId, id);

    const payload = previewSchema.safeParse(await req.json());
    if (!payload.success) {
      return NextResponse.json(
        { error: 'Invalid request body', details: payload.error.flatten() },
        { status: 400 },
      );
    }

    const { model } = await resolveModelFromHeaders(req, {
      allowOpenAIModelOverride: true,
    });

    let importText = payload.data.text;
    let webSearch: {
      query: string;
      sourceCount: number;
      estimatedCostCredits: number;
      sources: Array<{ title: string; url: string }>;
    } | null = null;

    if (payload.data.source === 'web') {
      const query = payload.data.searchQuery?.trim() || '';
      const apiKey = resolveWebSearchApiKey(payload.data.webSearchApiKey);
      if (!apiKey) {
        return NextResponse.json(
          {
            error:
              payload.data.language === 'zh-CN'
                ? '未配置联网搜索 API Key，请先在设置里启用 Tavily。'
                : 'Web search API key is not configured. Please configure Tavily in settings first.',
          },
          { status: 400 },
        );
      }

      await assertUserHasCredits(auth.userId);
      const searchResult = await runWithRequestContext(
        req,
        '/api/courses/problems/import-web',
        () =>
          searchWithTavily({
            query,
            apiKey,
            maxResults: 6,
          }),
      );
      await chargeCreditsForWebSearch({
        userId: auth.userId,
        route: '/api/courses/problems/import-preview',
        query,
        source: 'course-problem-bank-import-web-search',
        courseId: id,
        operationCode: 'course_problem_bank_import_web_search',
        chargeReason: '课程题库联网搜索',
        serviceLabel: 'Tavily Web Search',
      });

      importText = [
        payload.data.language === 'zh-CN'
          ? `课程/搜题关键词：${query}`
          : `Course / search query: ${query}`,
        '',
        formatSearchResultsAsContext(searchResult),
      ]
        .filter(Boolean)
        .join('\n');

      webSearch = {
        query,
        sourceCount: searchResult.sources.length,
        estimatedCostCredits: estimateWebSearchRetailCostCredits(1),
        sources: searchResult.sources.map((source) => ({
          title: source.title,
          url: source.url,
        })),
      };
    }

    const result = await runWithRequestContext(
      req,
      '/api/courses/problems/import-preview',
      async () => {
        const extracted = await extractProblemDraftsFromText({
          text: importText,
          source: payload.data.source,
          language: payload.data.language,
          model,
        });
        return {
          ...extracted,
          drafts: extracted.drafts.map((draft) => ({
            ...draft,
            notebookId: null,
            sourceMeta: {
              ...draft.sourceMeta,
              suggestedNotebookId: null,
              courseId: id,
              webSearchQuery: webSearch?.query ?? draft.sourceMeta.webSearchQuery,
              webSearchSources: webSearch?.sources ?? draft.sourceMeta.webSearchSources,
            },
          })),
        };
      },
    );
    const dedupe = await previewCourseProblemDraftDedupe({
      userId: auth.userId,
      courseId: id,
      drafts: result.drafts,
    });

    const previewBatch = await createProblemImportBatch({
      prisma,
      userId: auth.userId,
      targetType: 'course',
      courseId: id,
      notebookId: null,
      source: payload.data.source,
      sourceText: importText,
      sourceFileName: payload.data.sourceFileName,
      sourceFileMime: payload.data.sourceFileMime,
      draftSnapshot: dedupe.uniqueDrafts,
      draftCount: dedupe.uniqueDrafts.length,
      usage: result.usage,
      webSearch,
      warnings: dedupe.duplicates.map((duplicate) => `Skipped duplicate: ${duplicate.title}`),
    });
    const importBatch =
      dedupe.uniqueDrafts.length === 0
        ? ((await markProblemImportBatchCommitted({
            prisma,
            userId: auth.userId,
            batchId: previewBatch.id,
            committedCount: 0,
            commitResult: {
              requestedCount: result.drafts.length,
              insertedProblemIds: [],
              reusedProblemIds: dedupe.reusedProblemIds,
              skippedDraftIds: dedupe.duplicates.map((duplicate) => duplicate.draftId),
              reusedDrafts: dedupe.duplicates
                .filter(
                  (duplicate): duplicate is typeof duplicate & { existingProblemId: string } =>
                    Boolean(duplicate.existingProblemId),
                )
                .map((duplicate) => ({
                  draftId: duplicate.draftId,
                  existingProblemId: duplicate.existingProblemId,
                  dedupeKey: duplicate.dedupeKey,
                })),
            },
          })) ?? previewBatch)
        : previewBatch;

    return NextResponse.json({
      ...result,
      drafts: dedupe.uniqueDrafts,
      dedupe: {
        extractedCount: result.drafts.length,
        uniqueCount: dedupe.uniqueDrafts.length,
        duplicateCount: dedupe.duplicates.length,
        reusedProblemIds: dedupe.reusedProblemIds,
        skipped: dedupe.duplicates,
      },
      notebooks: [],
      webSearch,
      importBatch: {
        id: importBatch.id,
        status: importBatch.status,
        source: importBatch.source,
        draftCount: importBatch.draftCount,
        committedCount: importBatch.committedCount,
        sourceFileName: importBatch.sourceFileName,
        createdAt: importBatch.createdAt,
      },
    });
  });
}
