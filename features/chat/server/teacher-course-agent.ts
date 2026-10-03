import { readCourseNotes, readConversationRecall } from './context-notes';
import { practiceCardFromSearch } from './practice-card';
import { randomUUID } from 'node:crypto';
import { openai } from '@ai-sdk/openai';
import {
  ToolLoopAgent,
  generateText,
  stepCountIs,
  tool,
  type LanguageModel,
  type ModelMessage,
  type ToolSet,
} from 'ai';
import { z } from 'zod';
import type { ChatFileArtifact, StatelessChatRequest, StatelessEvent } from '@/lib/types/chat';
import { listCourseHardRulesForPrompt } from '@/lib/server/course-hard-rules';
import { assertUserHasCredits } from '@/lib/server/credits';
import { recordLLMUsage } from '@/lib/server/llm-usage';
import type { PrismaClient } from '@/lib/server/generated-prisma';
import { prisma } from '@/lib/server/prisma';
import { normalizeModelMessageInlineImages } from '@/lib/orchestration/model-image-content';
import type { TrustedCourseAccess } from '@/features/chat/server/trusted-course-turn';
import { orderCourseNotebooks } from '@/lib/learning/course-notebook-order';
import { resolveCourseAgentNotebookAccess } from '@/lib/server/course-agent-notebook-access';
import { listLearningCalendarEvents } from '@/features/learning-calendar/server/repository';
import { prepareCourseConversationContext } from '@/features/chat/server/course-context-compression';
import {
  loadCourseLearnerInsight,
  loadTeacherClassOverview,
  loadTeacherProblemInsight,
  loadTeacherStudentInsight,
} from '@/lib/server/course-agent-learner-insights';
import { searchLearnProblemBankForPractice } from '@/lib/server/problem-bank-practice-search';
import { prepareCourseTurnContext, courseTurnContextPrompt } from './turn-context';
import { chatContextSelectionSchema } from '@/features/chat/domain/context-selection';
import {
  formatCourseRuleGuidance,
  loadCourseRuleContext,
  validateCourseRulePacks,
} from '@/features/memory/server/course-rule-pack-store';
import { openaiModelIdFromString } from '@/lib/ai/system-model-policy';
import { createCourseTurnTrace, reasoningProviderOptions } from './course-agent/trace';
import { buildCourseAgentInstructions } from './course-agent/instructions';
import { classifyCourseTask, detectConversationLanguage, skillBudget } from './course-agent/skills';
import { createWriteLongDocumentTool } from './course-agent/long-document';
import { listProblemChapters, searchTeacherProblemBank } from './course-agent/problem-bank-tools';
import {
  formatSourceInventoryForPrompt,
  loadCourseSourceInventory,
  unconvertedSourceHint,
  type CourseSourceInventory,
} from './course-agent/source-inventory';
import { teacherPreviewCardFromMatches } from './practice-card';
import type { TeacherProblemMatch } from './course-agent/problem-bank-tools';
import { resolveProblemReferences } from './course-agent/problem-references';
import { createChatArtifactTools } from './artifacts/tools';
import { saveChatArtifact } from './artifacts/store';

const MAX_SEARCH_RESULTS = 8;
const MAX_SEARCH_EXCERPT_CHARS = 2_400;
const MAX_NOTEBOOK_READ_CHARS = 28_000;

const calendarEventKindSchema = z.enum([
  'assignment',
  'exam',
  'progress',
  'tutorial',
  'holiday',
  'other',
]);
const calendarEventDraftSchema = z.object({
  title: z.string().trim().min(1).max(500),
  kind: calendarEventKindSchema.default('progress'),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start: z
    .string()
    .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
    .optional(),
  durationMinutes: z.number().int().min(5).max(1440).optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
const calendarChangeProposalSchema = z.discriminatedUnion('operation', [
  z.object({
    operation: z.literal('create'),
    summary: z.string().trim().min(1).max(800),
    items: z.array(calendarEventDraftSchema).min(1).max(30),
  }),
  z.object({
    operation: z.literal('update'),
    summary: z.string().trim().min(1).max(800),
    eventId: z.string().trim().min(1).max(200),
    updates: z.object({
      title: z.string().trim().min(1).max(500).optional(),
      date: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
      start: z
        .string()
        .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
        .nullable()
        .optional(),
      durationMinutes: z.number().int().min(5).max(1440).optional(),
      status: z.enum(['planned', 'done', 'skipped']).optional(),
      reason: z.string().trim().min(1).max(500).optional(),
    }),
  }),
  z.object({
    operation: z.literal('delete'),
    summary: z.string().trim().min(1).max(800),
    eventIds: z.array(z.string().trim().min(1).max(200)).min(1).max(30),
  }),
]);

type CalendarChangeProposal = z.infer<typeof calendarChangeProposalSchema>;

type TeacherCourseNotebookInventoryItem = {
  id: string;
  name: string;
  description: string | null;
  kind: 'image' | 'markdown';
  tags: string[];
  sectionCount: number;
  pageCount: number;
  sceneCount: number;
  updatedAt: string;
};

type TeacherCourseInventory = {
  notebooks: TeacherCourseNotebookInventoryItem[];
  totalNotebookCount: number;
  notebookAccessLimit: number | null;
  studentCount: number;
  hardRules: Array<{ id: string; content: string }>;
};

type CourseAgentMode = 'teacher' | 'student';

type SearchCandidate = {
  notebookId: string;
  notebookName: string;
  sectionId: string;
  sectionTitle: string;
  kind: 'markdown' | 'page' | 'scene';
  order: number;
  text: string;
};

function compactText(value: string, maxChars: number): string {
  const compacted = value
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
  if (compacted.length <= maxChars) return compacted;
  return `${compacted.slice(0, Math.max(0, maxChars - 24)).trimEnd()}\n…（内容已截断）`;
}

function jsonText(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value ?? '');
  }
}

function calendarProposalActionName(
  operation: CalendarChangeProposal['operation'],
): 'calendar.propose_add' | 'calendar.propose_update' | 'calendar.propose_delete' {
  if (operation === 'create') return 'calendar.propose_add';
  if (operation === 'update') return 'calendar.propose_update';
  return 'calendar.propose_delete';
}

function calendarProposalLabel(operation: CalendarChangeProposal['operation']): string {
  if (operation === 'create') return '确认加入日历';
  if (operation === 'update') return '确认修改日历';
  return '确认删除日历事项';
}

function searchTokens(input: string): string[] {
  const normalized = input.normalize('NFKC').toLocaleLowerCase('zh-CN');
  const tokens: string[] = normalized.match(/[\p{L}\p{N}_-]{2,}/gu) || [];
  const hanRuns: string[] = normalized.match(/[\p{Script=Han}]{2,}/gu) || [];
  for (const run of hanRuns) {
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.push(run.slice(index, index + 2));
    }
  }
  return Array.from(new Set(tokens)).slice(0, 40);
}

function scoreSearchCandidate(candidate: SearchCandidate, query: string): number {
  const normalizedQuery = query.normalize('NFKC').toLocaleLowerCase('zh-CN').trim();
  const title = `${candidate.notebookName} ${candidate.sectionTitle}`
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN');
  const body = candidate.text.normalize('NFKC').toLocaleLowerCase('zh-CN');
  let score = 0;
  if (normalizedQuery && title.includes(normalizedQuery)) score += 30;
  if (normalizedQuery && body.includes(normalizedQuery)) score += 18;
  for (const token of searchTokens(normalizedQuery)) {
    if (title.includes(token)) score += token.length >= 4 ? 8 : 4;
    if (body.includes(token)) score += token.length >= 4 ? 4 : 2;
  }
  return score;
}

async function loadTeacherCourseInventory(
  access: TrustedCourseAccess,
  db: PrismaClient,
  mode: CourseAgentMode,
): Promise<TeacherCourseInventory> {
  // Keep these reads sequential. Local development intentionally uses a small
  // PostgreSQL pool and a chat turn must not occupy all connections at once.
  const notebooks = await db.notebook.findMany({
    select: {
      id: true,
      name: true,
      description: true,
      notebookKind: true,
      tags: true,
      sectionCount: true,
      sceneCount: true,
      updatedAt: true,
      createdAt: true,
      coverSlideJson: true,
      _count: { select: { markdownSections: true, pages: true, scenes: true } },
    },
    where: { courseId: access.course.id, ownerId: access.course.ownerId, removedAt: null },
  });
  const studentCount = await db.courseEnrollment.count({
    where: { courseId: access.course.id },
  });
  const hardRules = await listCourseHardRulesForPrompt({
    prisma: db,
    courseId: access.course.id,
    ownerId: access.course.ownerId,
  });

  const ordered = orderCourseNotebooks(
    notebooks.map((notebook) => {
      const cover =
        notebook.coverSlideJson &&
        typeof notebook.coverSlideJson === 'object' &&
        !Array.isArray(notebook.coverSlideJson)
          ? (notebook.coverSlideJson as Record<string, unknown>)
          : {};
      return {
        ...notebook,
        createdAt: notebook.createdAt.getTime(),
        learningOrder:
          typeof cover.learningOrder === 'number' && Number.isInteger(cover.learningOrder)
            ? cover.learningOrder
            : undefined,
      };
    }),
  );
  const notebookAccess =
    mode === 'student'
      ? await resolveCourseAgentNotebookAccess(db, access.userId, access.course.id)
      : null;
  const allowedNotebookIds =
    mode === 'student'
      ? new Set(notebookAccess?.allowedNotebookIds || [])
      : new Set(ordered.map((notebook) => notebook.id));
  const visibleNotebooks = ordered.filter((notebook) => allowedNotebookIds.has(notebook.id));

  return {
    notebooks: visibleNotebooks.map((notebook) => ({
      id: notebook.id,
      name: notebook.name,
      description: notebook.description,
      kind: notebook.notebookKind,
      tags: notebook.tags,
      sectionCount: Math.max(notebook.sectionCount, notebook._count.markdownSections),
      pageCount: notebook._count.pages,
      sceneCount: Math.max(notebook.sceneCount, notebook._count.scenes),
      updatedAt: notebook.updatedAt.toISOString(),
    })),
    totalNotebookCount: ordered.length,
    notebookAccessLimit: notebookAccess?.notebookAccessLimit ?? null,
    studentCount,
    hardRules,
  };
}

async function loadSearchCandidates(
  inventory: TeacherCourseInventory,
  db: PrismaClient,
): Promise<SearchCandidate[]> {
  const notebookIds = inventory.notebooks.map((notebook) => notebook.id);
  if (notebookIds.length === 0) return [];
  const notebookNames = new Map(
    inventory.notebooks.map((notebook) => [notebook.id, notebook.name] as const),
  );

  const markdownSections = await db.markdownNotebookSection.findMany({
    where: { notebookId: { in: notebookIds } },
    select: { id: true, notebookId: true, title: true, order: true, markdown: true, summary: true },
    orderBy: [{ notebookId: 'asc' }, { order: 'asc' }],
    take: 240,
  });
  const pages = await db.notebookPage.findMany({
    where: { notebookId: { in: notebookIds } },
    select: {
      id: true,
      notebookId: true,
      title: true,
      order: true,
      content: { select: { content: true, whiteboard: true } },
    },
    orderBy: [{ notebookId: 'asc' }, { order: 'asc' }],
    take: 160,
  });
  const scenes = await db.scene.findMany({
    where: { notebookId: { in: notebookIds } },
    select: {
      id: true,
      notebookId: true,
      title: true,
      order: true,
      content: true,
      whiteboard: true,
    },
    orderBy: [{ notebookId: 'asc' }, { order: 'asc' }],
    take: 160,
  });

  return [
    ...markdownSections.map(
      (section): SearchCandidate => ({
        notebookId: section.notebookId,
        notebookName: notebookNames.get(section.notebookId) || section.notebookId,
        sectionId: section.id,
        sectionTitle: section.title,
        kind: 'markdown',
        order: section.order,
        text: [section.summary, section.markdown].filter(Boolean).join('\n'),
      }),
    ),
    ...pages.map(
      (page): SearchCandidate => ({
        notebookId: page.notebookId,
        notebookName: notebookNames.get(page.notebookId) || page.notebookId,
        sectionId: page.id,
        sectionTitle: page.title,
        kind: 'page',
        order: page.order,
        text: jsonText({ content: page.content?.content, whiteboard: page.content?.whiteboard }),
      }),
    ),
    ...scenes.map(
      (scene): SearchCandidate => ({
        notebookId: scene.notebookId,
        notebookName: notebookNames.get(scene.notebookId) || scene.notebookId,
        sectionId: scene.id,
        sectionTitle: scene.title,
        kind: 'scene',
        order: scene.order,
        text: jsonText({ content: scene.content, whiteboard: scene.whiteboard }),
      }),
    ),
  ];
}

function latestUserText(body: StatelessChatRequest): string {
  const message = body.messages
    .slice()
    .reverse()
    .find((item) => item.role === 'user');
  return (
    message?.parts
      .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim() || ''
  );
}

function shouldRequireEvidenceTool(text: string): boolean {
  const normalized = text.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase('zh-CN');
  if (!normalized) return false;
  return !/^(你好|您好|hello|hi|谢谢|多谢|好的|好|明白了|再见)[!！。.]?$/.test(normalized);
}

function formatWebSourceAppendix(sources: unknown): string {
  if (!Array.isArray(sources)) return '';
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    const item = source as Record<string, unknown>;
    if (item.sourceType !== 'url' || typeof item.url !== 'string') continue;
    const url = item.url.trim();
    if (!url || seen.has(url)) continue;
    try {
      const protocol = new URL(url).protocol;
      if (protocol !== 'https:' && protocol !== 'http:') continue;
    } catch {
      continue;
    }
    seen.add(url);
    const rawTitle = typeof item.title === 'string' ? item.title.trim() : '';
    const title = (rawTitle || url).replace(/[\[\]\r\n]+/g, ' ').trim();
    lines.push(`- [${title}](${url})`);
    if (lines.length >= 8) break;
  }
  return lines.length > 0 ? `\n\n### 联网来源\n\n${lines.join('\n')}` : '';
}

type CourseAgentTurnArgs = {
  body: StatelessChatRequest;
  signal: AbortSignal;
  languageModel: LanguageModel;
  modelString?: string;
  providerId?: string;
  access: TrustedCourseAccess;
  db?: PrismaClient;
  onEvent: (event: StatelessEvent) => void | Promise<void>;
};

export async function runCourseTurn(
  args: CourseAgentTurnArgs & { mode: CourseAgentMode },
): Promise<void> {
  const db = args.db ?? prisma;
  const isStudent = args.mode === 'student';
  const agentId = isStudent ? 'student-course-agent' : 'teacher-course-agent';
  const agentName = isStudent ? '课程学习助理' : '课程助理';
  const messageId = `${agentId}-answer-${randomUUID()}`;
  let practicePlanEmitted = false;
  const teacherProblemCandidates = new Map<string, TeacherProblemMatch>();
  let teacherProblemSearchRan = false;
  const emittedFiles: ChatFileArtifact[] = [];
  let inventoryForTrace: TeacherCourseInventory | null = null;
  const trace = createCourseTurnTrace({
    mode: args.mode,
    agentName,
    emit: (data) => Promise.resolve(args.onEvent({ type: 'public_progress', data })),
    resolveNotebookName: (notebookId) =>
      inventoryForTrace?.notebooks.find((notebook) => notebook.id === notebookId)?.name,
  });

  await args.onEvent({
    type: 'agent_start',
    data: {
      messageId,
      agentId,
      agentName,
      agentColor: '#0f766e',
    },
  });
  await trace.preparing();

  try {
    const [inventory, turnContext, courseNotes, sourceInventory] = await Promise.all([
      loadTeacherCourseInventory(args.access, db, args.mode),
      prepareCourseTurnContext({ db, access: args.access, selection: args.body.contextSelection }),
      readCourseNotes(db, args.access.userId, args.access.course.id),
      // Metadata only (titles, categories, processing status); never file contents.
      isStudent
        ? Promise.resolve([] as CourseSourceInventory)
        : loadCourseSourceInventory({ db, courseId: args.access.course.id }).catch(
            () => [] as CourseSourceInventory,
          ),
    ]);
    inventoryForTrace = inventory;
    const courseRuleContext = await loadCourseRuleContext({
      prisma: db,
      courseId: args.access.course.id,
      body: args.body,
    });
    const preflightRuleGuidance = formatCourseRuleGuidance(
      validateCourseRulePacks({
        packs: courseRuleContext.packs,
        task: courseRuleContext.task,
        reviewText: courseRuleContext.reviewText,
        answerText: '',
      }),
    );
    await trace.prepared({
      notebookCount: inventory.notebooks.length,
      totalNotebookCount: inventory.totalNotebookCount,
      studentCount: isStudent ? undefined : inventory.studentCount,
      hardRuleCount: inventory.hardRules.length,
      notebookNames: inventory.notebooks.map((notebook) => notebook.name),
    });

    // Decide what kind of task this turn is, so budgets and playbooks fit the work.
    const userTexts = userMessageTexts(args.body);
    const latestText = latestUserText(args.body);
    const task = classifyCourseTask(latestText, {
      mode: args.mode,
      hasAttachment: latestUserHasAttachment(args.body),
      previousUserTexts: userTexts.slice(0, -1),
    });
    const replyLanguage = detectConversationLanguage(userTexts);
    const modelId = openaiModelIdFromString(args.modelString);
    const budget = skillBudget(task, modelId);

    let searchCandidatesPromise: Promise<SearchCandidate[]> | null = null;
    const getSearchCandidates = () => {
      searchCandidatesPromise ??= loadSearchCandidates(inventory, db);
      return searchCandidatesPromise;
    };
    const notebookTools = {
      list_course_notebooks: tool({
        description:
          'List every persisted notebook in the current course, including ids, names, kinds, descriptions, and content counts.',
        inputSchema: z.object({}),
        execute: async () => ({
          courseId: args.access.course.id,
          notebookCount: inventory.notebooks.length,
          studentCount: inventory.studentCount,
          notebooks: inventory.notebooks,
        }),
      }),
      search_course_notebooks: tool({
        description:
          'Search or read persisted notebook sections and pages in the current course. Set detail=full and narrow by notebookId or sectionIds when full source content is needed.',
        inputSchema: z.object({
          query: z.string().trim().max(500).default(''),
          notebookId: z.string().trim().min(1).max(200).optional(),
          sectionIds: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
          detail: z.enum(['excerpt', 'full']).default('excerpt'),
          maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
        }),
        execute: async ({ query, notebookId, sectionIds, detail, maxResults }) => {
          const candidates = await getSearchCandidates();
          const sectionIdSet = sectionIds?.length ? new Set(sectionIds) : null;
          const filtered = candidates.filter(
            (candidate) =>
              (!notebookId || candidate.notebookId === notebookId) &&
              (!sectionIdSet || sectionIdSet.has(candidate.sectionId)),
          );
          const limit = maxResults ?? (detail === 'full' ? 3 : 5);
          let remaining =
            detail === 'full' ? MAX_NOTEBOOK_READ_CHARS : MAX_SEARCH_EXCERPT_CHARS * limit;
          const ranked = filtered
            .map((candidate) => ({
              candidate,
              score: query ? scoreSearchCandidate(candidate, query) : 1,
            }))
            .filter((item) => item.score > 0)
            .sort(
              (left, right) =>
                right.score - left.score || left.candidate.order - right.candidate.order,
            )
            .slice(0, limit);
          return {
            query,
            matchCount: ranked.length,
            matches: ranked.map(({ candidate, score }) => ({
              notebookId: candidate.notebookId,
              notebookName: candidate.notebookName,
              sectionId: candidate.sectionId,
              sectionTitle: candidate.sectionTitle,
              kind: candidate.kind,
              order: candidate.order,
              score,
              excerpt: compactText(candidate.text, MAX_SEARCH_EXCERPT_CHARS),
              ...(detail === 'full'
                ? {
                    content: (() => {
                      const content = compactText(candidate.text, remaining);
                      remaining = Math.max(0, remaining - content.length);
                      return content;
                    })(),
                  }
                : {}),
            })),
          };
        },
      }),
    };

    const calendarDb = db as unknown as Parameters<typeof listLearningCalendarEvents>[0];
    const calendarReadTools = {
      list_calendar_events: tool({
        description:
          'Read the current user calendar for this course in a bounded date range. This is read-only and may be used without confirmation.',
        inputSchema: z.object({
          start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        }),
        execute: async ({ start, end }) =>
          listLearningCalendarEvents(calendarDb, {
            ownerId: args.access.userId,
            query: { start, end, courseId: args.access.course.id, limit: 80 },
          }),
      }),
    };
    const calendarMutationTools = {
      propose_calendar_change: tool({
        description:
          'Create one confirmation-required calendar change draft. Use operation=create for new events. For update or delete, call list_calendar_events first and use exact event ids. This tool never writes, updates, or deletes calendar data.',
        inputSchema: calendarChangeProposalSchema,
        execute: async (proposal) => ({
          proposed: true,
          written: false,
          requiresConfirmation: true,
          actionKind: calendarProposalActionName(proposal.operation),
          proposal,
          instruction: '日历尚未更改。请等待学生在确认卡上明确确认。',
        }),
      }),
    };
    const learningReadTools = {
      get_my_learning_context: tool({
        description:
          'Read only the current student own recent questions, problem attempts, and already confirmed learner-state evidence for this course. This tool never writes memory.',
        inputSchema: z.object({
          focus: z.enum(['questions', 'status', 'weakness', 'all']).default('all'),
          timeScope: z.enum(['week', 'month', 'term', 'all']).default('week'),
        }),
        execute: async ({ focus, timeScope }) =>
          loadCourseLearnerInsight({
            prisma: db,
            courseId: args.access.course.id,
            userId: args.access.userId,
            focus,
            timeScope,
          }),
      }),
    };
    const teacherInsightTools = {
      get_course_learning_insight: tool({
        description:
          'Find a currently enrolled student by name, user ID, email, or phone last four digits (studentQuery, scope=student), and read their evidence-based learning insight. Also supports class or problem scope; class results are anonymized. Phone matches return only last four digits and may be ambiguous.',
        inputSchema: z.object({
          scope: z.enum(['student', 'class', 'problem']),
          studentQuery: z.string().trim().min(1).max(200).optional(),
          problemQuery: z.string().trim().min(1).max(240).optional(),
          focus: z.enum(['questions', 'status', 'weakness', 'all']).default('all'),
          timeScope: z.enum(['week', 'month', 'term', 'all']).default('week'),
        }),
        execute: async (input) => {
          if (input.scope === 'student') {
            if (!input.studentQuery) {
              return { found: false, reason: 'scope=student requires studentQuery.' };
            }
            return loadTeacherStudentInsight({
              prisma: db,
              courseId: args.access.course.id,
              studentQuery: input.studentQuery,
              focus: input.focus,
              timeScope: input.timeScope,
            });
          }
          if (input.scope === 'problem') {
            if (!input.problemQuery) {
              return { found: false, reason: 'scope=problem requires problemQuery.' };
            }
            return loadTeacherProblemInsight({
              prisma: db,
              courseId: args.access.course.id,
              problemQuery: input.problemQuery,
              timeScope: input.timeScope,
            });
          }
          return loadTeacherClassOverview({
            prisma: db,
            courseId: args.access.course.id,
            timeScope: input.timeScope,
          });
        },
      }),
    };
    const problemBankTools = {
      search_course_problem_bank: tool({
        description: isStudent
          ? 'Search the real problem bank for this course and return strict matches with persisted problem ids. Never invent replacement questions when matches are insufficient.'
          : "Search this course's platform problem bank (problems filed by chapter). Returns candidates with real ids and hrefs. Cite selected problems using their exact hrefs in the final answer; only cited problems become preview cards, in first-citation order. Never describe where a problem originally came from.",
        inputSchema: z.object({
          query: z.string().trim().min(1).max(500),
          requestedCount: z.number().int().min(1).max(12).default(5),
          chapterId: z.string().trim().max(64).optional(),
        }),
        execute: async ({ query, requestedCount, chapterId }) => {
          if (!isStudent) {
            teacherProblemSearchRan = true;
            const result = await searchTeacherProblemBank({
              db,
              userId: args.access.userId,
              courseId: args.access.course.id,
              query,
              requestedCount,
              chapterId: chapterId || null,
            });
            for (const match of result.matches)
              teacherProblemCandidates.set(match.problemId, match);
            return {
              ...result,
              ...(result.matches.length === 0
                ? { hint: unconvertedSourceHint(sourceInventory) }
                : {}),
              display:
                '这些是候选题，尚未显示卡片。最终正文中用 [《章节》· 题库第 N 题](工具返回的 href) 引用选中的题目；应用按首次引用顺序生成同一组卡片。',
            };
          }
          const result = await searchLearnProblemBankForPractice({
            prisma: db,
            userId: args.access.userId,
            courseId: args.access.course.id,
            query,
            requestedCount,
            allowedNotebookIds: inventory.notebooks.map((notebook) => notebook.id),
          });
          if (isStudent) {
            const plan = practiceCardFromSearch({
              result,
              id: `practice-${messageId}`,
              userId: args.access.userId,
              courseId: args.access.course.id,
              courseName: args.access.course.name,
            });
            if (plan) {
              await args.onEvent({ type: 'practice_plan', data: { messageId, plan } });
              practicePlanEmitted = true;
            }
          }
          return result;
        },
      }),
    };
    const teacherProblemBankTools = {
      list_problem_chapters: tool({
        description:
          'List the problem-bank chapters of this course with available problem counts, including uncategorized questions. All imported bank problems are available to course teachers and students without a publishing step. Use a returned chapter id to narrow search_course_problem_bank.',
        inputSchema: z.object({}),
        execute: async () => ({
          chapters: await listProblemChapters({ db, courseId: args.access.course.id }),
        }),
      }),
    };
    const fileTools = createChatArtifactTools({
      db,
      courseId: args.access.course.id,
      userId: args.access.userId,
      courseName: args.access.course.name,
      onArtifact: async (artifact) => {
        emittedFiles.push(artifact);
        await args.onEvent({ type: 'chat_artifact', data: { messageId, artifact } });
      },
    });
    const loadSectionText = async (sectionIds: string[]) => {
      const wanted = new Set(sectionIds);
      const candidates = await getSearchCandidates();
      return candidates
        .filter((candidate) => wanted.has(candidate.sectionId))
        .map(
          (candidate) =>
            `## ${candidate.notebookName} · ${candidate.sectionTitle}\n\n${candidate.text}`,
        )
        .join('\n\n')
        .slice(0, MAX_NOTEBOOK_READ_CHARS);
    };
    const longDocumentTools = {
      write_long_document: createWriteLongDocumentTool({
        model: args.languageModel,
        language: replyLanguage,
        loadSectionText,
        abortSignal: args.signal,
        onDocument: async ({ title, markdown }) => {
          // Long documents are delivered as files; chat history keeps only the summary.
          const [docx, pdf] = await Promise.all([
            import('./artifacts/docx').then((m) => m.renderMarkdownToDocx({ title, markdown })),
            import('./artifacts/pdf').then((m) => m.renderMarkdownToPdf({ title, markdown })),
          ]);
          const saved: ChatFileArtifact[] = [];
          for (const [buffer, fileKind, mimeType, extension] of [
            [
              docx,
              'docx',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              'docx',
            ],
            [pdf, 'pdf', 'application/pdf', 'pdf'],
          ] as const) {
            const artifact = await saveChatArtifact({
              db,
              courseId: args.access.course.id,
              userId: args.access.userId,
              fileKind,
              title,
              fileName: `${title}.${extension}`,
              mimeType,
              buffer,
            });
            saved.push(artifact);
            emittedFiles.push(artifact);
            await args.onEvent({ type: 'chat_artifact', data: { messageId, artifact } });
          }
          return {
            fileName: saved.map((artifact) => artifact.fileName).join('、'),
            id: saved[0]?.id,
          };
        },
      }),
    };
    const hostedWebTools = {
      web_search: openai.tools.webSearch({
        externalWebAccess: true,
        searchContextSize: 'medium',
      }),
    };
    const sharedTools = {
      ...notebookTools,
      ...problemBankTools,
      ...calendarReadTools,
      ...hostedWebTools,
      recall_conversation: tool({
        description:
          'Find your own past conversations in this course by title or summary. First list matches; read a known conversationId for recent original messages. Never treat assistant suggestions as confirmed user decisions.',
        inputSchema: z.object({
          conversationId: z.string().max(200).optional(),
          query: z.string().max(120).optional(),
          beforeSequence: z.string().regex(/^\d+$/).max(20).optional(),
        }),
        execute: (input) =>
          readConversationRecall(db, {
            ownerId: args.access.userId,
            courseId: args.access.course.id,
            ...input,
          }),
      }),
      read_selected_context: tool({
        description:
          'Read exact course data by verified IDs; this tool never changes data. To view a bank question, use source="problem" and its real problemId, omitting studentId and attemptId. Teachers/admins do not need student enrollment to read course problems. Only include studentId for an actual enrolled student when reading learning records or an attempt; never substitute the current teacher/admin ID. Reuse IDs already present in context.',
        inputSchema: chatContextSelectionSchema,
        execute: async (selection) =>
          prepareCourseTurnContext({ db, access: args.access, selection }),
      }),
    };
    // Students may make study files for themselves but not spend credits on images.
    const tools: ToolSet = isStudent
      ? {
          ...sharedTools,
          ...learningReadTools,
          ...calendarMutationTools,
          create_document: fileTools.create_document,
        }
      : {
          ...sharedTools,
          ...teacherInsightTools,
          ...teacherProblemBankTools,
          ...fileTools,
          ...longDocumentTools,
        };

    if (args.modelString && args.providerId) {
      await assertUserHasCredits(isStudent ? args.access.userId : args.access.course.ownerId);
    }
    const preparedContext = await prepareCourseConversationContext({
      messages: args.body.messages,
      mode: args.mode,
      model: args.languageModel,
      signal: args.signal,
      onCompressionStart: async ({ trigger, estimatedTokens, messageCount }) => {
        await trace.contextCompacting(
          trigger === 'token_budget'
            ? `估算上下文约 ${estimatedTokens.toLocaleString()} tokens，正在把较早内容整理成摘要，最近消息保留原文。`
            : `当前有 ${messageCount} 条消息，正在把较早内容整理成摘要，最近消息保留原文。`,
        );
      },
    });
    if (preparedContext.compression) {
      await args.onEvent({
        type: 'context_compression',
        data: { ...preparedContext.compression, messageId },
      });
      await trace.contextCompacted(
        `已将 ${preparedContext.compression.compressedMessageCount} 条较早消息合并为摘要，保留最近 ${preparedContext.compression.retainedMessageCount} 条原文。`,
        ['完整聊天记录仍保留'],
      );
    }
    await args.onEvent({
      type: 'context_usage',
      data: {
        usedTokens: preparedContext.estimatedContextTokens,
        limitTokens: preparedContext.contextTokenBudget,
        estimated: true,
      },
    });
    if (
      preparedContext.summaryUsage &&
      preparedContext.summaryUsage.totalTokens > 0 &&
      args.modelString &&
      args.providerId
    ) {
      const modelId = args.modelString.includes(':')
        ? args.modelString.slice(args.modelString.indexOf(':') + 1)
        : args.modelString;
      await recordLLMUsage({
        userId: isStudent ? args.access.userId : args.access.course.ownerId,
        route: '/api/chat',
        source: isStudent
          ? 'student-course-chat-context-compression'
          : 'teacher-course-chat-context-compression',
        providerId: args.providerId,
        modelId,
        modelString: args.modelString,
        ...preparedContext.summaryUsage,
        courseId: args.access.course.id,
        courseName: args.access.course.name,
        operationCode: isStudent
          ? 'student_course_chat_context_compression'
          : 'teacher_course_chat_context_compression',
        chargeReason: '聊天上下文自动整理',
        serviceLabel: isStudent ? '学生课程聊天上下文' : '教师课程聊天上下文',
      });
    }
    let calendarProposalEmitted = false;
    const instructions = [
      buildCourseAgentInstructions({
        access: args.access,
        inventory,
        mode: args.mode,
        teachingMode: args.body.config.teachingMode === 'guided' ? 'guided' : 'reply',
        courseRulePrompt: courseRuleContext.prompt,
        courseRuleGuidance: preflightRuleGuidance,
        task,
        language: replyLanguage,
        sourceInventoryPrompt: isStudent
          ? undefined
          : formatSourceInventoryForPrompt(sourceInventory),
        availableTools: Object.keys(tools),
      }),
      turnContext ? courseTurnContextPrompt(turnContext) : '',
      courseNotes.length
        ? `当前用户的既有学习笔记，仅作背景资料，不代表最新成绩或事实：\n${JSON.stringify(courseNotes).replace(/</g, '\\u003c')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    const providerOptions = reasoningProviderOptions(args.modelString, {
      providerId: args.providerId,
    });
    const requireEvidence =
      !turnContext && shouldRequireEvidenceTool(latestText) && task !== 'calendar';
    const agent = new ToolLoopAgent({
      id: agentId,
      model: args.languageModel,
      instructions,
      tools,
      stopWhen: stepCountIs(budget.maxSteps),
      maxOutputTokens: budget.maxOutputTokens,
      ...(providerOptions ? { providerOptions } : {}),
      prepareStep: ({ stepNumber }) => {
        // The last allowed step must produce text; tool-only endings used to surface as
        // "课程助理没有返回可展示的回答".
        if (stepNumber >= budget.maxSteps - 1) return { toolChoice: 'none' as const };
        if (stepNumber === 0 && requireEvidence) return { toolChoice: 'required' as const };
        return { toolChoice: 'auto' as const };
      },
      experimental_onToolCallStart: async ({ toolCall }) => {
        await trace.toolStarted(toolCall.toolCallId, toolCall.toolName, toolCall.input);
      },
      experimental_onToolCallFinish: async ({ toolCall, success, output, error }) => {
        if (
          success &&
          toolCall.toolName === 'propose_calendar_change' &&
          !calendarProposalEmitted
        ) {
          const parsedProposal = calendarChangeProposalSchema.safeParse(toolCall.input);
          if (parsedProposal.success) {
            calendarProposalEmitted = true;
            const proposal = parsedProposal.data;
            await args.onEvent({
              type: 'action',
              data: {
                actionId: `calendar-proposal-${randomUUID()}`,
                actionName: calendarProposalActionName(proposal.operation),
                params: {
                  ...proposal,
                  label: calendarProposalLabel(proposal.operation),
                  courseId: args.access.course.id,
                  requiresConfirmation: true,
                },
                agentId,
                messageId,
              },
            });
          }
        }
        await trace.toolFinished(toolCall.toolCallId, { success, output, error });
      },
    });

    const modelMessages = normalizeModelMessageInlineImages(preparedContext.modelMessages);
    const result = await agent.stream({
      messages: modelMessages,
      abortSignal: args.signal,
    });
    let streamedText = '';
    let pendingProblemText = '';
    let answerStarted = false;
    let toolRan = false;
    const emitText = async (content: string) => {
      if (!content) return;
      if (!answerStarted) {
        answerStarted = true;
        await trace.answering();
      }
      streamedText += content;
      if (!isStudent && teacherProblemSearchRan) {
        pendingProblemText += content;
        return;
      }
      await args.onEvent({ type: 'text_delta', data: { content, messageId } });
    };
    for await (const part of result.fullStream) {
      if (args.signal.aborted) break;
      switch (part.type) {
        case 'reasoning-delta':
          await trace.reasoning(part.text, part.id);
          break;
        case 'tool-call':
          toolRan = true;
          // Provider-executed tools (web_search) never reach experimental_onToolCall*.
          if (part.providerExecuted)
            await trace.toolStarted(part.toolCallId, part.toolName, part.input);
          break;
        case 'tool-result':
          if (part.providerExecuted) {
            await trace.toolFinished(part.toolCallId, {
              success: true,
              output: part.output,
              toolName: part.toolName,
            });
          }
          break;
        case 'tool-error':
          if (part.providerExecuted) {
            await trace.toolFinished(part.toolCallId, {
              success: false,
              error: part.error,
              toolName: part.toolName,
            });
          }
          break;
        case 'start-step':
          if (toolRan && !answerStarted) await trace.composing();
          break;
        case 'text-delta':
          await emitText(part.text);
          break;
        case 'error':
          throw part.error;
        default:
          break;
      }
    }

    // A turn whose only output is a card or file is complete; otherwise make one
    // tool-free attempt before reporting an empty answer.
    const deliveredWithoutText =
      calendarProposalEmitted || practicePlanEmitted || emittedFiles.length > 0;
    let fallbackUsage: { inputTokens?: number; outputTokens?: number } | null = null;
    if (!args.signal.aborted && !streamedText.trim()) {
      const priorResponse = await Promise.resolve(result.response).catch(() => null);
      const fallback = await generateText({
        model: args.languageModel,
        system: instructions,
        messages: [
          ...(modelMessages as ModelMessage[]),
          ...((priorResponse?.messages ?? []) as ModelMessage[]),
          {
            role: 'user',
            content: deliveredWithoutText
              ? '请用两三句话说明刚才已经生成的内容（题目卡片、文件或日历草案），不要再调用工具。'
              : '请根据以上已经取得的资料直接给出回答；资料不足时明确说明缺什么。不要再调用工具。',
          },
        ],
        maxOutputTokens: Math.min(budget.maxOutputTokens, 4_000),
        abortSignal: args.signal,
      }).catch(() => null);
      if (fallback?.text?.trim()) {
        await emitText(fallback.text);
        fallbackUsage = fallback.usage ?? null;
      }
    }

    const missingRuleGuidance = formatCourseRuleGuidance(
      validateCourseRulePacks({
        packs: courseRuleContext.packs,
        task: courseRuleContext.task,
        reviewText: courseRuleContext.reviewText,
        answerText: streamedText,
      }),
    );
    if (!args.signal.aborted && missingRuleGuidance) {
      await emitText(`\n\n### 课程规范补充\n\n${missingRuleGuidance}`);
    }

    if (!args.signal.aborted) {
      const webSourceAppendix = formatWebSourceAppendix(await result.sources);
      if (webSourceAppendix) await emitText(webSourceAppendix);
    }

    if (!args.signal.aborted && pendingProblemText) {
      const resolved = resolveProblemReferences({
        text: pendingProblemText,
        courseId: args.access.course.id,
        candidates: [...teacherProblemCandidates.values()],
      });
      const plan = teacherPreviewCardFromMatches({
        matches: resolved.selected,
        query: latestText,
        id: `practice-${messageId}`,
        userId: args.access.userId,
        courseId: args.access.course.id,
        courseName: args.access.course.name,
      });
      // Send the same resolved selection with the body; never emit intermediate searches.
      if (plan) {
        await args.onEvent({ type: 'practice_plan', data: { messageId, plan } });
        practicePlanEmitted = true;
      }
      await args.onEvent({
        type: 'text_delta',
        data: { content: resolved.text, messageId },
      });
    }

    const totalUsage = await result.totalUsage;
    const inputTokens =
      Math.max(0, Math.round(totalUsage.inputTokens || 0)) +
      Math.max(0, Math.round(fallbackUsage?.inputTokens || 0));
    const outputTokens =
      Math.max(0, Math.round(totalUsage.outputTokens || 0)) +
      Math.max(0, Math.round(fallbackUsage?.outputTokens || 0));
    const cachedInputTokens = Math.max(0, Math.round(totalUsage.cachedInputTokens || 0));
    const totalTokens = inputTokens + outputTokens;
    if (totalTokens > 0 && args.modelString && args.providerId) {
      await recordLLMUsage({
        userId: isStudent ? args.access.userId : args.access.course.ownerId,
        route: '/api/chat',
        source: isStudent ? 'student-course-chat' : 'teacher-course-chat',
        providerId: args.providerId,
        modelId,
        modelString: args.modelString,
        inputTokens,
        outputTokens,
        cachedInputTokens,
        totalTokens,
        courseId: args.access.course.id,
        courseName: args.access.course.name,
        operationCode: isStudent ? 'student_course_chat' : 'teacher_course_chat',
        chargeReason: isStudent ? '学生课程聊天' : '教师课程聊天',
        serviceLabel: isStudent ? '学生课程学习助理' : '教师端课程助理',
      });
    }

    const answered = Boolean(streamedText.trim()) || deliveredWithoutText;
    await trace.finished({
      answered,
      deliverable: emittedFiles.length
        ? `已生成 ${emittedFiles.length} 个文件`
        : calendarProposalEmitted
          ? '已生成日历草案，等待确认'
          : practicePlanEmitted
            ? isStudent
              ? '已生成练习卡'
              : '已显示题目卡片'
            : undefined,
    });
    if (!args.signal.aborted && !answered) {
      throw new Error(`${agentName}没有返回可展示的回答。`);
    }
    if (!args.signal.aborted) {
      await args.onEvent({
        type: 'agent_end',
        data: { messageId, agentId },
      });
      await args.onEvent({
        type: 'done',
        data: {
          totalActions: calendarProposalEmitted ? 1 : 0,
          totalAgents: 1,
          agentHadContent: true,
        },
      });
    }
  } catch (error) {
    await trace
      .failed(error instanceof Error ? error.message : String(error))
      .catch(() => undefined);
    throw error;
  }
}

/** Plain text of every user message, oldest first (for task and language detection). */
function userMessageTexts(body: StatelessChatRequest): string[] {
  return body.messages
    .filter((item) => item.role === 'user')
    .map((item) =>
      (item.parts || [])
        .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
        .join('\n')
        .trim(),
    )
    .filter(Boolean);
}

function latestUserHasAttachment(body: StatelessChatRequest): boolean {
  const message = body.messages
    .slice()
    .reverse()
    .find((item) => item.role === 'user');
  return Boolean(
    message?.parts?.some((part) => part.type === 'file' || String(part.type).startsWith('data-')),
  );
}

export function runTeacherCourseTurn(args: CourseAgentTurnArgs): Promise<void> {
  return runCourseTurn({ ...args, mode: 'teacher' });
}

export function runStudentCourseTurn(args: CourseAgentTurnArgs): Promise<void> {
  return runCourseTurn({ ...args, mode: 'student' });
}
