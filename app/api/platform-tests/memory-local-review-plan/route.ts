import { NextRequest, NextResponse } from 'next/server';
import { Output } from 'ai';
import { z } from 'zod';

import { callLLM } from '@/lib/ai/llm';
import {
  hybridRetrieve,
  loadLocalProblemBank,
  type LocalProblem,
  type RagQuery,
} from '@/features/qa/test-center/server/local-question-rag';
import {
  MEMORY_REVIEW_PLAN_TOOL_IDS,
  type MemoryReviewPlanEvidence,
  type MemoryReviewPlanQuestion,
  type MemoryReviewPlanResponse,
  type MemoryReviewPlanToolCall,
  type MemoryReviewPlanToolTrace,
} from '@/features/qa/test-center/memory/memory-review-plan-types';
import { courseProblemHref } from '@/features/qa/test-center/memory/problem-bank-link';
import { safeRoute } from '@/lib/server/json-error-response';
import { resolveModelFromHeaders } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';

const calendarSchema = z.object({
  id: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(500),
  startsAt: z.string().trim().min(1).max(80),
  endsAt: z.string().trim().max(80).nullable(),
  timezone: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(80),
});

const memorySchema = z.object({
  id: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(500),
  text: z.string().trim().min(1).max(12_000),
  kind: z.string().trim().min(1).max(120),
  scope: z.string().trim().min(1).max(80),
  status: z.string().trim().min(1).max(80),
  updatedAt: z.number(),
});

const attemptSchema = z.object({
  id: z.string().trim().min(1).max(240),
  problemId: z.string().trim().min(1).max(240),
  problemTitle: z.string().trim().min(1).max(500),
  concept: z.string().trim().min(1).max(300),
  status: z.string().trim().min(1).max(80),
  score: z.number(),
  maxScore: z.number().nullable(),
  feedback: z.string().trim().max(8_000),
  createdAt: z.number(),
});

const notebookSchema = z.object({
  id: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(30_000),
  updatedAt: z.number(),
});

const requestSchema = z.object({
  action: z.literal('generate_review_plan'),
  user: z.object({
    id: z
      .string()
      .trim()
      .regex(/^memory-test-[a-z0-9_-]{1,120}$/i),
    name: z.string().trim().min(1).max(200),
    courseCode: z.literal('CSC148'),
    learnerProfile: z.unknown(),
    studyHabit: z.unknown(),
  }),
  query: z.string().trim().min(1).max(4_000),
  today: z.string().trim().min(1).max(40),
  constraints: z.object({
    totalMinutes: z.number().int().min(15).max(360),
    maxSessions: z.number().int().min(1).max(8),
    maxQuestionsPerSession: z.number().int().min(1).max(8),
  }),
  sources: z.object({
    calendar: z.array(calendarSchema).max(80),
    memories: z.array(memorySchema).max(120),
    attempts: z.array(attemptSchema).max(240),
    notebooks: z.array(notebookSchema).max(20),
  }),
});

const plannedToolCallSchema = z.object({
  toolId: z.enum(MEMORY_REVIEW_PLAN_TOOL_IDS),
  reason: z.string().trim().min(1).max(800),
  query: z.string().trim().min(1).max(800).nullable(),
  limit: z.number().int().min(1).max(32),
});

const readPlanSchema = z
  .object({
    reasoning: z.array(z.string().trim().min(1).max(800)).min(1).max(10),
    calls: z.array(plannedToolCallSchema).min(1).max(MEMORY_REVIEW_PLAN_TOOL_IDS.length),
  })
  .superRefine((plan, context) => {
    const ids = plan.calls.map((call) => call.toolId);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['calls'],
        message: 'Each read tool can be called at most once.',
      });
    }
  });

type UsageSummary = MemoryReviewPlanResponse['usage'];

function usageSummary(
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    totalTokens?: number;
  } | null,
): UsageSummary {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? inputTokens + outputTokens,
  };
}

function addUsage(left: UsageSummary, right: UsageSummary): UsageSummary {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function queryTokens(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  const latin = normalized.match(/[a-z0-9_+-]{2,}/g) || [];
  const cjk = normalized.match(/[\u3400-\u9fff]{2,16}/g) || [];
  const bigrams = cjk.flatMap((run) =>
    Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)),
  );
  return Array.from(new Set([...latin, ...cjk, ...bigrams])).slice(0, 80);
}

function lexicalScore(value: unknown, tokens: string[]): number {
  const text = JSON.stringify(value).normalize('NFKC').toLowerCase();
  if (!tokens.length) return 0;
  return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
}

function ranked<T>(items: T[], query: string, limit: number): Array<{ item: T; score: number }> {
  const tokens = queryTokens(query);
  return items
    .map((item) => ({ item, score: lexicalScore(item, tokens) }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

function excerpt(value: string, limit = 1_000) {
  const normalized = value.trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function calendarLocalTime(value: string, timezone: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(timestamp);
  } catch {
    return value;
  }
}

function compactNaturalText(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s.,，。:：;；!?！？、/\\()[\]{}'"“”‘’·—_-]+/g, '');
}

function parseSmallHumanNumber(value: string): number | null {
  const normalized = value.normalize('NFKC');
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const digitByCharacter: Record<string, number> = {
    一: 1,
    二: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (normalized === '十') return 10;
  if (normalized.startsWith('十')) return 10 + (digitByCharacter[normalized[1]] || 0);
  if (normalized.endsWith('十')) return (digitByCharacter[normalized[0]] || 0) * 10;
  if (normalized.includes('十')) {
    const [tens, ones] = normalized.split('十');
    return (digitByCharacter[tens] || 0) * 10 + (digitByCharacter[ones] || 0);
  }
  return digitByCharacter[normalized] ?? null;
}

function calendarUserFacingFacts(item: z.infer<typeof calendarSchema>, today: string): string[] {
  const timestamp = Date.parse(item.startsAt);
  if (!Number.isFinite(timestamp)) return [item.title];
  try {
    const parts = new Intl.DateTimeFormat('zh-CN', {
      timeZone: item.timezone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(timestamp);
    const part = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((itemPart) => itemPart.type === type)?.value || '';
    const year = part('year');
    const month = Number(part('month'));
    const day = Number(part('day'));
    const hour = Number(part('hour'));
    const minute = Number(part('minute'));
    const paddedMonth = String(month).padStart(2, '0');
    const paddedDay = String(day).padStart(2, '0');
    const paddedHour = String(hour).padStart(2, '0');
    const paddedMinute = String(minute).padStart(2, '0');
    const dateFacts = [
      `${month}月${day}日`,
      `${month}月${day}号`,
      `${year}-${paddedMonth}-${paddedDay}`,
      `${month}/${day}`,
    ];
    const clockFacts = [
      `${hour}点`,
      `${hour}时`,
      `${hour}:${paddedMinute}`,
      `${paddedHour}:${paddedMinute}`,
    ];
    const todayTimestamp = Date.parse(`${today}T00:00:00`);
    const eventDayTimestamp = Date.parse(`${year}-${paddedMonth}-${paddedDay}T00:00:00`);
    const dayDistance =
      Number.isFinite(todayTimestamp) && Number.isFinite(eventDayTimestamp)
        ? Math.round((eventDayTimestamp - todayTimestamp) / 86_400_000)
        : null;
    const relativeFact =
      dayDistance === 0
        ? '今天'
        : dayDistance === 1
          ? '明天'
          : dayDistance === 2
            ? '后天'
            : dayDistance !== null && dayDistance > 0
              ? `${dayDistance}天后`
              : null;
    return Array.from(
      new Set([item.title, ...dateFacts, ...clockFacts, relativeFact].filter(Boolean) as string[]),
    );
  } catch {
    return [item.title];
  }
}

function inventoryPrompt(input: z.infer<typeof requestSchema>, problemCount: number) {
  return [
    `用户自然语言请求：${input.query}`,
    `今天：${input.today}`,
    `课程：${input.user.courseCode}`,
    `可用数据数量：全局用户资料 1，日历 ${input.sources.calendar.length}，CSC148 学习记忆 ${input.sources.memories.length}，CSC148 作答 ${input.sources.attempts.length}，CSC148 课程笔记 ${input.sources.notebooks.length}，CSC148 真实题库 ${problemCount}。`,
    `可用总时间：${input.constraints.totalMinutes} 分钟；计划必须完整使用这段时间；最多 ${input.constraints.maxSessions} 个 session；每次最多 ${input.constraints.maxQuestionsPerSession} 题。`,
    '',
    '决定是否调用以下读取工具。只调用确实能改变计划的工具；尊重用户明确说“不读取”的来源。',
    '- read_user_profile：读取不按课程隔离的基本学习资料与通用学习习惯。',
    '- read_calendar：读取精确日程与截止时间。',
    '- search_learning_memory：检索掌握、薄弱、原因和下一教学动作。',
    '- search_problem_attempts：检索近期做题、错题和评分反馈。',
    '- search_problem_bank：对 CSC148 真实题库执行 RAG；只要用户要求出题、选题、做题或安排练习，就必须调用，不能自行生成题目。',
    '- search_notebooks：检索课程笔记与课程特有答题契约；只有请求课程标准、模板或资料依据时调用。',
    'query 写该工具自己的检索词；不需要检索词时填 null。limit 表示需要读取到什么深度。',
  ].join('\n');
}

function planOutputSchema(evidenceIds: string[], problemIds: string[]) {
  const evidenceIdSchema = z.enum(evidenceIds as [string, ...string[]]);
  const problemIdsSchema = problemIds.length
    ? z.array(z.enum(problemIds as [string, ...string[]])).max(8)
    : z.array(z.string()).max(0);
  return z.object({
    title: z.string().trim().min(1).max(240),
    summary: z.string().trim().min(1).max(2_000),
    deadlineSummary: z.string().trim().min(1).max(1_000),
    priorities: z
      .array(
        z.object({
          concept: z.string().trim().min(1).max(240),
          reason: z.string().trim().min(1).max(1_000),
          evidenceIds: z.array(evidenceIdSchema).min(1).max(10),
        }),
      )
      .min(1)
      .max(6),
    sessions: z
      .array(
        z.object({
          id: z
            .string()
            .trim()
            .regex(/^session-[1-8]$/),
          dayLabel: z.string().trim().min(1).max(100),
          date: z.string().trim().min(1).max(40),
          startTime: z.string().trim().min(1).max(40),
          minutes: z.number().int().min(10).max(180),
          focus: z.string().trim().min(1).max(300),
          method: z.string().trim().min(1).max(1_500),
          reason: z.string().trim().min(1).max(1_500),
          evidenceIds: z.array(evidenceIdSchema).min(1).max(12),
          problemIds: problemIdsSchema,
          questionCount: z.number().int().min(0).max(8),
          completionSignal: z.string().trim().min(1).max(1_000),
        }),
      )
      .min(1)
      .max(8),
    warnings: z.array(z.string().trim().min(1).max(1_000)).max(8),
  });
}

type GeneratedPlan = z.infer<ReturnType<typeof planOutputSchema>>;

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function queryClauses(query: string) {
  return query
    .split(/[，。！？；;,.!?\n]+/)
    .map((clause) => clause.trim())
    .filter(Boolean);
}

function queryForbidsQuestions(query: string) {
  return queryClauses(query).some((clause) => {
    if (
      /不是(?:不要|不需要|无需|不能|不想).{0,6}(?:出题|选题|做题|练习题|给.{0,3}题)/.test(clause)
    ) {
      return false;
    }
    return /(?:不要|不需要|无需|别|禁止|先不|暂不|这次不|不想|不能|不)(?:再|先|要|需要|用)?(?:给我|给|安排|生成|选择|选|出|做)?(?:任何|新的|额外的|练习)?(?:[0-9一二三四五六七八九十]+\s*道)?(?:题目|题|练习题|做题|出题|选题)/.test(
      clause,
    );
  });
}

function queryForbidsProblemBank(query: string) {
  return queryClauses(query).some((clause) => {
    if (/不是(?:不要|不需要|无需|不能|不想).{0,5}(?:读取|检索|查看|看|用|使用)?题库/.test(clause)) {
      return false;
    }
    return /(?:不要|不需要|无需|别|禁止|先不|暂不|这次不|不想|不能|不)(?:再|先|要|需要)?(?:读取|检索|查看|看|用|使用)?题库/.test(
      clause,
    );
  });
}

function queryRequestsQuestions(query: string) {
  if (queryForbidsQuestions(query) || queryForbidsProblemBank(query)) return false;
  return /题库|(?:出|做|选|安排|给我).{0,12}(?:题|练习)|(?:题|练习).{0,12}(?:安排|计划)/.test(
    query,
  );
}

function explicitRequestedQuestionCount(query: string): number | null {
  if (queryForbidsQuestions(query)) return null;
  const counts = Array.from(
    query.matchAll(/([0-9一二三四五六七八九十]+)\s*道(?:真实)?(?:题|练习)/g),
  )
    .map((match) => parseSmallHumanNumber(match[1]))
    .filter((value): value is number => value !== null && value > 0);
  return counts.length ? Math.max(...counts) : null;
}

function minimumQuestionCount(input: z.infer<typeof requestSchema>) {
  if (!queryRequestsQuestions(input.query)) return 0;
  const explicit = explicitRequestedQuestionCount(input.query);
  if (explicit !== null) return explicit;
  return Math.min(3, Math.max(2, Math.floor(input.constraints.totalMinutes / 15)));
}

function ensureExplicitSourceReads(
  input: z.infer<typeof requestSchema>,
  rawPlan: z.infer<typeof readPlanSchema>,
): z.infer<typeof readPlanSchema> {
  const negativeClauses = queryClauses(input.query).filter((clause) =>
    /不要|不需要|无需|别|禁止|不读取|不检索|不查看|不用/.test(clause),
  );
  const positiveText = queryClauses(input.query)
    .filter((clause) => !negativeClauses.includes(clause))
    .join('；');
  const forbidden = new Set<MemoryReviewPlanToolCall['toolId']>();
  for (const clause of negativeClauses) {
    if (/全局|个人资料|用户资料|学习习惯/.test(clause)) forbidden.add('read_user_profile');
    if (/日历|日程/.test(clause)) forbidden.add('read_calendar');
    if (/学习记忆|长期记忆|课程记忆/.test(clause)) {
      forbidden.add('search_learning_memory');
    }
    if (/做题记录|作答记录|错题/.test(clause)) forbidden.add('search_problem_attempts');
    if (/课程笔记|笔记本|课程资料/.test(clause)) forbidden.add('search_notebooks');
    if (/题库/.test(clause)) forbidden.add('search_problem_bank');
  }

  const callsById = new Map(
    rawPlan.calls
      .filter((call) => !forbidden.has(call.toolId))
      .map((call) => [call.toolId, call] as const),
  );
  const addExplicitCall = (
    toolId: MemoryReviewPlanToolCall['toolId'],
    reason: string,
    query: string | null,
    limit: number,
  ) => {
    if (forbidden.has(toolId) || callsById.has(toolId)) return;
    callsById.set(toolId, { toolId, reason, query, limit });
  };

  if (/个人学习习惯|平时.{0,8}(?:学习|时段)|学习时段|全局用户资料/.test(positiveText)) {
    addExplicitCall('read_user_profile', '用户明确要求按个人学习习惯安排复习时间。', null, 1);
  }
  if (
    /(?:查看|检查|结合|读取|参考|看看).{0,8}(?:日历|日程)|(?:日历|日程).{0,8}(?:安排|结合|查看|检查)|(?:考试|作业|测验|小测).{0,12}(?:截止|时间)|(?:明天|后天|\d+天后).{0,12}(?:截止|考试|作业)/.test(
      positiveText,
    )
  ) {
    addExplicitCall('read_calendar', '用户明确给出或要求核对考试、作业截止或日历时间。', null, 8);
  }
  if (/学习记忆|课程记忆|薄弱点|近期错误|已经掌握|掌握的/.test(positiveText)) {
    addExplicitCall(
      'search_learning_memory',
      '用户明确要求根据掌握、薄弱或近期错误制定计划。',
      input.query,
      8,
    );
  }
  if (/做题记录|作答记录|近期错误|最近做题|错题/.test(positiveText)) {
    addExplicitCall(
      'search_problem_attempts',
      '用户明确要求参考近期做题或错误记录。',
      input.query,
      10,
    );
  }
  if (/课程笔记|笔记本|课程资料/.test(positiveText)) {
    addExplicitCall('search_notebooks', '用户明确要求检查课程笔记或课程资料。', input.query, 4);
  }

  const order: MemoryReviewPlanToolCall['toolId'][] = [
    'read_user_profile',
    'read_calendar',
    'search_learning_memory',
    'search_problem_attempts',
    'search_notebooks',
    'search_problem_bank',
  ];
  return {
    ...rawPlan,
    calls: order.flatMap((toolId) => {
      const call = callsById.get(toolId);
      return call ? [call] : [];
    }),
  };
}

function ensureProblemBankRead(
  input: z.infer<typeof requestSchema>,
  rawPlan: z.infer<typeof readPlanSchema>,
): z.infer<typeof readPlanSchema> {
  if (queryForbidsProblemBank(input.query)) {
    return {
      ...rawPlan,
      calls: rawPlan.calls.filter((call) => call.toolId !== 'search_problem_bank'),
    };
  }
  if (
    !queryRequestsQuestions(input.query) ||
    rawPlan.calls.some((call) => call.toolId === 'search_problem_bank')
  ) {
    const minimumCount = minimumQuestionCount(input);
    const bankCalls = rawPlan.calls
      .filter((call) => call.toolId === 'search_problem_bank')
      .map((call) => ({
        ...call,
        limit: Math.min(32, Math.max(call.limit, minimumCount + 6)),
      }));
    return {
      ...rawPlan,
      calls: [
        ...rawPlan.calls.filter((call) => call.toolId !== 'search_problem_bank'),
        ...bankCalls,
      ],
    };
  }
  const minimumCount = minimumQuestionCount(input);
  return {
    reasoning: [
      ...rawPlan.reasoning,
      '用户要求安排练习题；按照题库选择合同，必须先检索真实题库，不能自行生成题目。',
    ].slice(0, 10),
    calls: [
      ...rawPlan.calls,
      {
        toolId: 'search_problem_bank',
        reason: '用户要求安排可直接作答的练习题，必须从真实 CSC148 题库选择。',
        query: input.query,
        limit: Math.min(
          32,
          Math.max(minimumCount + 3, input.constraints.maxQuestionsPerSession * 2),
        ),
      },
    ],
  };
}

function isWeakLearningEvidence(item: MemoryReviewPlanEvidence) {
  if (item.sourceType === 'attempt') {
    return /(?:·|\b)(?:failed|partial|incorrect|needs[_ -]?review|未通过|部分正确|失败)(?:\b|$)/i.test(
      item.title,
    );
  }
  if (item.sourceType !== 'memory') return false;
  const text = `${item.title}\n${item.excerpt}`;
  if (/课程要求|课程约束|公共记忆|公开课程/.test(text) && !/个人|当前|最近/.test(text)) {
    return false;
  }
  return /薄弱|卡点|错误|失分|失败|未掌握|不稳定|仍会|容易|遗漏|没有.{0,8}(?:做到|检查|覆盖)|需要.{0,8}(?:加强|复习|纠正)|下一(?:教学|步)/.test(
    text,
  );
}

function weakLearningEvidence(items: MemoryReviewPlanEvidence[]) {
  return items.filter(isWeakLearningEvidence);
}

function scopeWeakEvidenceForQuery(
  query: string,
  items: MemoryReviewPlanEvidence[],
): MemoryReviewPlanEvidence[] {
  const onlyRecentAttempts =
    /(?:只|仅)(?:看|参考|根据|使用)?.{0,12}(?:最近|近期).{0,10}(?:做题|作答|错题)记录/.test(query);
  if (!onlyRecentAttempts) return items;
  const datedAttempts = items
    .filter(
      (item) =>
        item.sourceType === 'attempt' &&
        typeof item.observedAt === 'number' &&
        Number.isFinite(item.observedAt),
    )
    .sort((left, right) => (right.observedAt || 0) - (left.observedAt || 0));
  if (!datedAttempts.length) return items.filter((item) => item.sourceType === 'attempt');
  const newestTimestamp = datedAttempts[0].observedAt || 0;
  const latestCluster = datedAttempts.filter(
    (item) => newestTimestamp - (item.observedAt || 0) <= 12 * 60 * 60 * 1_000,
  );
  return latestCluster.length ? latestCluster : datedAttempts.slice(0, 2);
}

const RELEVANCE_STOP_TOKENS = new Set([
  '最近',
  '近期',
  '真实',
  '题库',
  '做题',
  '作答',
  '问题',
  '知识',
  '学习',
  '复习',
  '反馈',
  '课程',
  '需要',
  '这个',
  '一个',
  '完成',
  '正确',
  '错误',
  '通过',
  '学生',
  'csc148',
  '记录',
  '显示',
  '直接',
  '检验',
  '能力',
  '操作',
  '步骤',
  '阶段',
  '代码',
  '实现',
  '状态',
  '内容',
  '方法',
  '结果',
  '已经',
  '仍然',
  '不总',
]);

function relevanceTokens(value: string) {
  return queryTokens(value).filter(
    (token) => token.length >= 2 && !RELEVANCE_STOP_TOKENS.has(token),
  );
}

function evidenceProblemScore(item: MemoryReviewPlanEvidence, problem: unknown) {
  const lexical = lexicalScore(problem, relevanceTokens(`${item.title}\n${item.excerpt}`));
  return (
    lexical +
    directSkillCoverage(item, problem).matched * 20 +
    explicitSkillInstructionScore(item, problem)
  );
}

const DIRECT_SKILL_RULES = [
  {
    id: 'representation-invariant',
    evidence: /representation invariants?|\bri\b|表示不变式|类不变式/i,
    problem: /representation invariants?|\bri\b|表示不变式|类不变式/i,
  },
  {
    id: 'mutation-boundary',
    evidence: /mutation|状态改变|破坏性|修改后|改变后/i,
    problem: /mutation|状态变化|破坏性|deposit|withdraw|修改|改变|可变对象/i,
  },
  {
    id: 'aliasing-copy',
    evidence: /aliasing|别名|浅拷贝|深拷贝|共享引用/i,
    problem: /aliasing|别名|浅拷贝|深拷贝|共享引用|\.copy\(|deepcopy/i,
  },
  {
    id: 'tree-recursion',
    evidence:
      /(?:递归|recursive)[\s\S]*(?:树|子树|bst|tree)|(?:树|子树|bst|tree)[\s\S]*(?:递归|recursive)/i,
    problem:
      /(?:递归|recursive|check_height|_subtrees|_left|_right)[\s\S]*(?:树|子树|bst|tree)|(?:树|子树|bst|tree)[\s\S]*(?:递归|recursive|check_height|_subtrees|_left|_right)/i,
  },
  {
    id: 'recursive-subproblem',
    evidence: /缩小|原树|子问题|subproblem|递归参数/i,
    problem:
      /子树|subtrees?|children?|child|_left|_right|递归调用|recursive call|check_height|树遍历|树结构|遍历/i,
  },
  {
    id: 'complexity-bound',
    evidence: /复杂度|最坏情况|worst.?case|上界|界限|big.?o/i,
    problem: /复杂度|最坏情况|worst.?case|上界|界限|big.?o|o\s*\(/i,
  },
  {
    id: 'abstract-contract',
    evidence: /抽象|接口契约|实现细节|abstraction|interface contract/i,
    problem: /抽象|接口|契约|实现细节|abstraction|interface|contract|public method/i,
  },
  {
    id: 'boundary-proof',
    evidence:
      /正确性证明|边界.{0,6}(?:遗漏|补全)|(?:遗漏|补全).{0,6}边界|空结构|极端输入|proof|edge case/i,
    problem: /证明|边界|base case|空树|空子树|空结构|空列表|极端|proof|edge case|empty/i,
  },
] as const;

function directSkillCoverage(item: MemoryReviewPlanEvidence, problem: unknown) {
  const evidenceText = `${item.title}\n${item.excerpt}`;
  const problemText = JSON.stringify(problem);
  const activated = DIRECT_SKILL_RULES.filter((rule) => rule.evidence.test(evidenceText));
  const matched = activated.filter((rule) => rule.problem.test(problemText));
  return { activated: activated.length, matched: matched.length };
}

function explicitSkillInstructionScore(item: MemoryReviewPlanEvidence, problem: unknown) {
  const evidenceText = `${item.title}\n${item.excerpt}`;
  if (!DIRECT_SKILL_RULES[4].evidence.test(evidenceText)) return 0;
  const problemText = JSON.stringify(problem);
  return /must (?:use|be implemented (?:with|using)) recursion|必须(?:使用|采用)?递归|递归作用于(?:所有|每个)?(?:节点|子树)|不得.{0,8}(?:无限递归)|not cause infinite recursion/i.test(
    problemText,
  )
    ? 40
    : 0;
}

function isDirectEvidenceProblemMatch(item: MemoryReviewPlanEvidence, problem: unknown) {
  const coverage = directSkillCoverage(item, problem);
  const evidenceText = `${item.title}\n${item.excerpt}`;
  const problemRecord = problem as { question?: unknown; tags?: unknown };
  const instructionText = `${typeof problemRecord.question === 'string' ? problemRecord.question : ''}\n${
    Array.isArray(problemRecord.tags) ? problemRecord.tags.join(' ') : ''
  }`;
  if (
    /树遍历与返回值组合|多分支返回值|返回值组合|左右(?:子树|分支).{0,20}(?:返回|组合)/i.test(
      evidenceText,
    )
  ) {
    return (
      /树|bst|binary search tree|treenode/i.test(instructionText) &&
      /三种遍历|实现.{0,60}(?:inorder.{0,60}preorder|preorder.{0,60}postorder)|返回遍历得到|遍历必须包含所有节点|check_height|find_max|左右(?:子树|分支).{0,20}(?:返回|组合)/i.test(
        instructionText,
      )
    );
  }
  if (/representation invariants?|\bri\b|表示不变式|类不变式/i.test(evidenceText)) {
    if (!/representation invariants?|\bri\b|表示不变式|类不变式/i.test(instructionText)) {
      return false;
    }
    if (
      /mutation|状态改变|修改后|改变后/i.test(evidenceText) &&
      !/withdraw|deposit|mutation|状态变化|非法状态|违反|guard|校验|检查|不变式被违反|remain unchanged|never become negative/i.test(
        instructionText,
      )
    ) {
      return false;
    }
    // RI records often end with a generic "边界仍需补全" note. That note must not
    // turn an otherwise direct mutation/guard exercise into a formal-proof exercise.
    return true;
  }
  if (/缩小|原树|子问题|subproblem|递归参数/i.test(evidenceText)) {
    if (
      /也可以.{0,16}(?:迭代|显式栈)|can also.{0,16}(?:iterate|iterative)/i.test(instructionText)
    ) {
      return false;
    }
    return (
      /树|子树|bst|tree|subtree/i.test(instructionText) &&
      /递归|recursive|child|children|subtree|子树|_left|_right|_subtrees|check_height|find_max|遍历/i.test(
        instructionText,
      )
    );
  }
  if (
    /正确性证明|形式化证明|correctness proof/i.test(evidenceText) &&
    /docstring|doctest|文档注释|示例选择|示例组合/i.test(instructionText) &&
    !/正确性证明|形式化证明|correctness proof/i.test(instructionText)
  ) {
    return false;
  }
  if (/正确性证明|形式化证明|correctness proof/i.test(evidenceText)) {
    return /正确性证明|形式化证明|correctness proof|证明算法|证明.{0,12}(?:正确|终止)|prove.{0,20}(?:correct|terminat)|(?:空结构|空树|空列表|极端输入|edge case|empty)[\s\S]{0,80}(?:正确性|证明|proof)/i.test(
      instructionText,
    );
  }
  if (
    /泄露.{0,8}实现细节|实现细节.{0,8}泄露|leak.{0,12}implementation/i.test(evidenceText) &&
    !/indexerror|透出|underlying implementation|public interface|公开接口|内部实现|实现细节|异常抽象/i.test(
      instructionText,
    )
  ) {
    return false;
  }
  if (/泄露.{0,8}实现细节|实现细节.{0,8}泄露|leak.{0,12}implementation/i.test(evidenceText)) {
    return true;
  }
  if (explicitSkillInstructionScore(item, problem) > 0 && coverage.matched > 0) return true;
  if (coverage.activated > 0) return coverage.matched === coverage.activated;
  return lexicalScore(problem, relevanceTokens(`${item.title}\n${item.excerpt}`)) >= 2;
}

function questionTimeFitScore(problem: { type: string; difficulty: string }, totalMinutes: number) {
  if (totalMinutes > 60) return 0;
  if (problem.type === 'choice') return totalMinutes <= 30 ? 1_000 : 600;
  if (problem.difficulty === 'easy') return totalMinutes <= 30 ? 100 : 300;
  if (problem.type === 'code' && problem.difficulty === 'medium') {
    return totalMinutes <= 30 ? 0 : 120;
  }
  if (totalMinutes > 30 && problem.difficulty === 'hard') return -100;
  return 0;
}

function estimatedQuestionMinutes(problem: { type: string; difficulty: string }) {
  if (problem.type === 'choice') return 5;
  if (problem.type === 'code') {
    if (problem.difficulty === 'hard') return 25;
    if (problem.difficulty === 'medium') return 18;
    return 12;
  }
  if (problem.difficulty === 'hard') return 18;
  if (problem.difficulty === 'medium') return 12;
  return 8;
}

function directSkillIds(value: string) {
  return DIRECT_SKILL_RULES.filter((rule) => rule.evidence.test(value)).map((rule) => rule.id);
}

function directEvidenceDomain(value: string) {
  if (/representation invariants?|\bri\b|表示不变式|类不变式/i.test(value)) {
    return 'representation-invariant';
  }
  if (/缩小|原树|子问题|subproblem|递归参数/i.test(value)) return 'recursive-subproblem';
  if (
    /树遍历与返回值组合|多分支返回值|返回值组合|左右(?:子树|分支).{0,20}(?:返回|组合)/i.test(value)
  ) {
    return 'tree-return-composition';
  }
  if (/aliasing|别名|浅拷贝|深拷贝|共享引用/i.test(value)) return 'aliasing-copy';
  if (/正确性证明|形式化证明|correctness proof|空结构|极端输入/i.test(value)) {
    return 'boundary-proof';
  }
  if (/泄露.{0,8}实现细节|实现细节.{0,8}泄露|接口契约|interface contract/i.test(value)) {
    return 'abstract-contract';
  }
  if (/复杂度|最坏情况|worst.?case|上界|界限|big.?o/i.test(value)) {
    return 'complexity-bound';
  }
  if (
    /(?:递归|recursive)[\s\S]*(?:树|子树|bst|tree)|(?:树|子树|bst|tree)[\s\S]*(?:递归|recursive)/i.test(
      value,
    )
  ) {
    return 'tree-recursion';
  }
  return null;
}

function weakEvidenceRepresentatives(args: {
  query: string;
  items: MemoryReviewPlanEvidence[];
  priorityEvidenceIds?: string[];
}) {
  const querySkillIds = new Set(directSkillIds(args.query));
  const topicMatched = querySkillIds.size
    ? args.items.filter((item) =>
        directSkillIds(`${item.title}\n${item.excerpt}`).some((id) => querySkillIds.has(id)),
      )
    : args.items;
  const eligible = topicMatched.length ? topicMatched : args.items;
  const eligibleById = new Map(eligible.map((item) => [item.id, item] as const));
  const ordered = uniqueStrings(args.priorityEvidenceIds || [])
    .map((id) => eligibleById.get(id))
    .filter((item): item is MemoryReviewPlanEvidence => Boolean(item));
  ordered.push(
    ...eligible.filter((item) => !ordered.some((candidate) => candidate.id === item.id)),
  );

  const seenSignatures = new Set<string>();
  const representatives = ordered.filter((item) => {
    const evidenceText = `${item.title}\n${item.excerpt}`;
    const domain = directEvidenceDomain(evidenceText);
    const skillIds = directSkillIds(evidenceText);
    const signature = domain
      ? domain
      : skillIds.length
        ? skillIds.sort().join('|')
        : relevanceTokens(item.title).slice(0, 4).sort().join('|') || item.id;
    if (seenSignatures.has(signature)) return false;
    seenSignatures.add(signature);
    return true;
  });
  return /最薄弱.{0,6}(?:一个|知识点)|一个.{0,6}最薄弱/.test(args.query)
    ? representatives.slice(0, 1)
    : representatives;
}

function problemBankQueries(args: {
  toolQuery: string;
  reason: string;
  evidence: MemoryReviewPlanEvidence[];
}): RagQuery[] {
  const baseTokens = relevanceTokens(args.toolQuery).slice(0, 16);
  const base: RagQuery = {
    query: args.toolQuery,
    purpose: args.reason,
    targetConcepts: baseTokens.length ? baseTokens : ['CSC148'],
    desiredTypes: [],
    exclusions: [],
  };
  const focused = weakLearningEvidence(args.evidence)
    .slice(0, 6)
    .map((item) => {
      const query = `${item.title}\n${item.excerpt}`;
      return {
        query,
        purpose: `直接复查这条薄弱证据：${item.title}`,
        targetConcepts: relevanceTokens(query).slice(0, 20),
        desiredTypes: [],
        exclusions: [],
      } satisfies RagQuery;
    });
  return [base, ...focused];
}

function cleanEvidenceTitle(value: string) {
  return value.replace(
    /\s*·\s*(?:failed|partial|incorrect|needs[_ -]?review|未通过|部分正确|失败)\s*$/i,
    '',
  );
}

function cleanUserFacingEvidence(value: string) {
  return value
    .replace(/(?:来源题目|真实 CSC148 题号|题目记录标识)：[^；。\n]+[；。]?/gi, '')
    .replace(/\b(?:local|fixture)_problem_[a-z0-9_-]+\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/^[；;，,。\s]+|[；;，,。\s]+$/g, '')
    .trim();
}

function evidenceFinding(item: MemoryReviewPlanEvidence) {
  const feedback = item.excerpt.match(/反馈：([^；]+)/)?.[1]?.trim();
  if (feedback) return cleanUserFacingEvidence(feedback);
  return cleanUserFacingEvidence(
    item.excerpt
      .replace(/(?:真实 CSC148 题号|题目记录标识)：[^；]+；?/g, '')
      .replace(/知识点：[^；]+；?/g, '')
      .replace(/得分：[^；]+；?/g, '')
      .trim(),
  );
}

function groundedPriorities(
  priorities: GeneratedPlan['priorities'],
  weakEvidence: MemoryReviewPlanEvidence[],
): GeneratedPlan['priorities'] {
  if (!weakEvidence.length) return priorities;
  const weakIds = new Set(weakEvidence.map((item) => item.id));
  const grounded = priorities.filter((priority) =>
    priority.evidenceIds.some((evidenceId) => weakIds.has(evidenceId)),
  );
  if (grounded.length) return grounded;
  return weakEvidence.slice(0, 3).map((item) => ({
    concept: cleanEvidenceTitle(item.title),
    reason: evidenceFinding(item),
    evidenceIds: [item.id],
  }));
}

function mergeSessionText(left: string, right: string) {
  if (!right || left.includes(right)) return left;
  return `${left}；${right}`;
}

function normalizePlanSessions(args: {
  input: z.infer<typeof requestSchema>;
  sessions: GeneratedPlan['sessions'];
  problems: MemoryReviewPlanResponse['problemBank']['selected'];
  weakEvidence: MemoryReviewPlanEvidence[];
  priorityEvidenceIds: string[];
  hasGroundedClock: boolean;
}): MemoryReviewPlanResponse['plan']['sessions'] {
  const { input } = args;
  const maximumByMinutes = Math.max(1, Math.floor(input.constraints.totalMinutes / 10));
  const maximumSessions =
    input.constraints.totalMinutes <= 30
      ? 1
      : input.constraints.totalMinutes <= 120
        ? Math.min(3, input.constraints.maxSessions, maximumByMinutes)
        : Math.min(input.constraints.maxSessions, maximumByMinutes);
  const minimumSessions = Math.min(
    maximumSessions,
    input.constraints.totalMinutes >= 120 ? 3 : input.constraints.totalMinutes >= 60 ? 2 : 1,
  );
  const targetSessionCount = Math.max(
    minimumSessions,
    Math.min(args.sessions.length, maximumSessions),
  );
  const sessions = args.sessions.slice(0, targetSessionCount).map((session) => ({
    ...session,
    evidenceIds: uniqueStrings(session.evidenceIds),
    problemIds: [...session.problemIds],
  }));

  while (sessions.length < targetSessionCount) {
    const template = sessions[sessions.length - 1] || args.sessions[0];
    sessions.push({
      ...template,
      id: `session-${sessions.length + 1}`,
      dayLabel: `${template.dayLabel}（续）`,
      problemIds: [],
      questionCount: 0,
    });
  }

  for (const extra of args.sessions.slice(targetSessionCount)) {
    const target = sessions[sessions.length - 1];
    target.focus = mergeSessionText(target.focus, extra.focus);
    target.method = mergeSessionText(target.method, extra.method);
    target.reason = mergeSessionText(target.reason, extra.reason);
    target.completionSignal = mergeSessionText(target.completionSignal, extra.completionSignal);
    target.evidenceIds = uniqueStrings([...target.evidenceIds, ...extra.evidenceIds]);
    target.problemIds.push(...extra.problemIds);
    target.minutes += extra.minutes;
  }

  const exactClockPattern = /^([01]?\d|2[0-3]):([0-5]\d)$/;
  const sessionSortKey = (session: (typeof sessions)[number]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date) || !exactClockPattern.test(session.startTime)) {
      return Number.POSITIVE_INFINITY;
    }
    return Date.parse(`${session.date}T${session.startTime}:00`);
  };
  const useAbsoluteClock =
    args.hasGroundedClock &&
    sessions.every(
      (session) =>
        /^\d{4}-\d{2}-\d{2}$/.test(session.date) && exactClockPattern.test(session.startTime),
    );
  if (useAbsoluteClock) {
    for (const session of sessions) {
      session.startTime = roundClockToFiveMinutes(session.startTime);
    }
    sessions.sort((left, right) => sessionSortKey(left) - sessionSortKey(right));
  }
  const calendarWindowMinuteCap = (session: (typeof sessions)[number]) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(session.date) || !exactClockPattern.test(session.startTime)) {
      return Number.POSITIVE_INFINITY;
    }
    const sessionStart = Date.parse(`${session.date}T${session.startTime}:00`);
    const matchingWindowMinutes = input.sources.calendar.flatMap((item) => {
      if (!item.endsAt || !/(?:复习|准备|学习|study|review|prep)/i.test(item.title)) return [];
      const eventStart = Date.parse(
        calendarLocalTime(item.startsAt, item.timezone).replaceAll('/', '-').replace(' ', 'T'),
      );
      const eventEnd = Date.parse(
        calendarLocalTime(item.endsAt, item.timezone).replaceAll('/', '-').replace(' ', 'T'),
      );
      return Number.isFinite(sessionStart) &&
        Number.isFinite(eventStart) &&
        Number.isFinite(eventEnd) &&
        sessionStart >= eventStart &&
        sessionStart < eventEnd
        ? [Math.floor((eventEnd - sessionStart) / 60_000)]
        : [];
    });
    return matchingWindowMinutes.length
      ? Math.min(...matchingWindowMinutes)
      : Number.POSITIVE_INFINITY;
  };

  const problemById = new Map(args.problems.map((problem) => [problem.id, problem] as const));
  const originalProblemIds = new Map(
    sessions.map((session) => [session.id, [...session.problemIds]] as const),
  );
  const usedProblemIds = new Set<string>();
  const exactQuestionTarget = explicitRequestedQuestionCount(input.query);
  const pedagogicalQuestionLimit =
    input.constraints.totalMinutes <= 60
      ? minimumQuestionCount(input)
      : input.constraints.totalMinutes <= 120
        ? minimumQuestionCount(input) + 1
        : Math.floor(input.constraints.totalMinutes / 30);
  const automaticQuestionLimit = Math.max(minimumQuestionCount(input), pedagogicalQuestionLimit);
  const maximumQuestionTarget = exactQuestionTarget ?? automaticQuestionLimit;
  const weakEvidence = args.weakEvidence;
  const weakEvidenceById = new Map(weakEvidence.map((item) => [item.id, item] as const));
  const bestWeakEvidence = (problem: (typeof args.problems)[number]) =>
    [...weakEvidence]
      .map((item) => ({ item, score: evidenceProblemScore(item, problem) }))
      .sort((left, right) => right.score - left.score)[0] || null;
  const primaryWeakEvidenceBySession = new Map<string, MemoryReviewPlanEvidence | undefined>();
  const representativeWeakEvidence = weakEvidenceRepresentatives({
    query: input.query,
    items: weakEvidence,
    priorityEvidenceIds: args.priorityEvidenceIds,
  });

  for (const [index, session] of sessions.entries()) {
    const explicit = session.evidenceIds
      .map((evidenceId) => weakEvidenceById.get(evidenceId))
      .find(Boolean);
    const sessionTokens = relevanceTokens(`${session.focus}\n${session.method}\n${session.reason}`);
    const inferred = [...weakEvidence]
      .map((item) => ({ item, score: lexicalScore(item, sessionTokens) }))
      .sort((left, right) => right.score - left.score)[0];
    primaryWeakEvidenceBySession.set(
      session.id,
      representativeWeakEvidence[index % representativeWeakEvidence.length] ||
        explicit ||
        (inferred?.score ? inferred.item : weakEvidence[index % weakEvidence.length]),
    );
  }

  for (const session of sessions) {
    const remainingQuestionCapacity = Math.max(0, maximumQuestionTarget - usedProblemIds.size);
    const requestedCount = Math.min(
      input.constraints.maxQuestionsPerSession,
      session.problemIds.filter((problemId) => problemById.has(problemId)).length,
      remainingQuestionCapacity,
    );
    if (!weakEvidence.length) {
      session.problemIds = session.problemIds
        .filter((problemId) => problemById.has(problemId) && !usedProblemIds.has(problemId))
        .slice(0, requestedCount);
    } else {
      const sessionTokens = relevanceTokens(
        `${session.focus}\n${session.method}\n${session.reason}`,
      );
      const primaryWeak = primaryWeakEvidenceBySession.get(session.id);
      const rankedProblems = [...args.problems]
        .filter((problem) => !usedProblemIds.has(problem.id))
        .map((problem) => {
          const weakScore = primaryWeak ? evidenceProblemScore(primaryWeak, problem) : 0;
          const sessionScore = lexicalScore(problem, sessionTokens);
          const modelBonus = originalProblemIds.get(session.id)?.includes(problem.id) ? 0.25 : 0;
          const timeFitBonus = questionTimeFitScore(problem, input.constraints.totalMinutes);
          return {
            id: problem.id,
            score: weakScore * 4 + sessionScore + modelBonus + timeFitBonus,
          };
        })
        .sort((left, right) => right.score - left.score);
      const directlyGrounded = primaryWeak
        ? rankedProblems.filter((item) => {
            const problem = problemById.get(item.id);
            return Boolean(problem && isDirectEvidenceProblemMatch(primaryWeak, problem));
          })
        : rankedProblems;
      session.problemIds = directlyGrounded.slice(0, requestedCount).map((item) => item.id);
    }
    session.problemIds.forEach((problemId) => usedProblemIds.add(problemId));
  }

  const desiredQuestionCount = Math.min(
    args.problems.length,
    maximumQuestionTarget,
    exactQuestionTarget ?? Math.max(minimumQuestionCount(input), usedProblemIds.size),
  );
  const remainingProblems = [...args.problems].sort((left, right) => {
    const leftScore = bestWeakEvidence(left)?.score || 0;
    const rightScore = bestWeakEvidence(right)?.score || 0;
    return rightScore - leftScore || right.hybridScore - left.hybridScore;
  });
  for (const problem of remainingProblems) {
    if (usedProblemIds.size >= desiredQuestionCount) break;
    if (usedProblemIds.has(problem.id)) continue;
    const target = [...sessions]
      .filter((session) => session.problemIds.length < input.constraints.maxQuestionsPerSession)
      .map((session) => {
        const primaryWeak = primaryWeakEvidenceBySession.get(session.id);
        return {
          session,
          score: primaryWeak ? evidenceProblemScore(primaryWeak, problem) : 0,
          direct: primaryWeak ? isDirectEvidenceProblemMatch(primaryWeak, problem) : true,
        };
      })
      .filter((candidate) => !weakEvidence.length || candidate.direct)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.session.problemIds.length - right.session.problemIds.length,
      )[0]?.session;
    if (!target) break;
    target.problemIds.push(problem.id);
    target.evidenceIds = uniqueStrings([...target.evidenceIds, `problem:${problem.id}`]);
    usedProblemIds.add(problem.id);
  }

  for (const emptySession of sessions.filter((session) => session.problemIds.length === 0)) {
    const primaryWeak = primaryWeakEvidenceBySession.get(emptySession.id);
    const donor = [...sessions]
      .filter((session) => session.problemIds.length > 1)
      .sort((left, right) => right.problemIds.length - left.problemIds.length)
      .find((session) =>
        session.problemIds.some((problemId) => {
          const problem = problemById.get(problemId);
          return Boolean(
            problem && (!primaryWeak || isDirectEvidenceProblemMatch(primaryWeak, problem)),
          );
        }),
      );
    if (!donor) continue;
    const movableIndex = donor.problemIds.findIndex((problemId) => {
      const problem = problemById.get(problemId);
      return Boolean(
        problem && (!primaryWeak || isDirectEvidenceProblemMatch(primaryWeak, problem)),
      );
    });
    if (movableIndex < 0) continue;
    const [problemId] = donor.problemIds.splice(movableIndex, 1);
    emptySession.problemIds.push(problemId);
  }

  if (input.constraints.totalMinutes <= 30) {
    const shortAssignments = new Map(sessions.map((session) => [session.id, [] as string[]]));
    const assignedShortProblemIds = new Set<string>();
    let madeProgress = true;
    while (assignedShortProblemIds.size < desiredQuestionCount && madeProgress) {
      madeProgress = false;
      for (const session of sessions) {
        const assigned = shortAssignments.get(session.id) || [];
        if (assigned.length >= input.constraints.maxQuestionsPerSession) continue;
        const primaryWeak = primaryWeakEvidenceBySession.get(session.id);
        const candidate = [...args.problems]
          .filter(
            (problem) =>
              problem.type === 'choice' &&
              !assignedShortProblemIds.has(problem.id) &&
              (!primaryWeak || isDirectEvidenceProblemMatch(primaryWeak, problem)),
          )
          .sort((left, right) => {
            if (!primaryWeak) return right.hybridScore - left.hybridScore;
            return (
              evidenceProblemScore(primaryWeak, right) - evidenceProblemScore(primaryWeak, left) ||
              right.hybridScore - left.hybridScore
            );
          })[0];
        if (!candidate) continue;
        assigned.push(candidate.id);
        shortAssignments.set(session.id, assigned);
        assignedShortProblemIds.add(candidate.id);
        madeProgress = true;
        if (assignedShortProblemIds.size >= desiredQuestionCount) break;
      }
    }
    if (assignedShortProblemIds.size === desiredQuestionCount) {
      usedProblemIds.clear();
      for (const session of sessions) {
        session.problemIds = shortAssignments.get(session.id) || [];
        session.problemIds.forEach((problemId) => usedProblemIds.add(problemId));
      }
    }
  } else if (input.constraints.totalMinutes <= 60) {
    const directScore = (problem: (typeof args.problems)[number]) =>
      Math.max(
        ...sessions.map((session) => {
          const primaryWeak = primaryWeakEvidenceBySession.get(session.id);
          return primaryWeak && isDirectEvidenceProblemMatch(primaryWeak, problem)
            ? evidenceProblemScore(primaryWeak, problem)
            : Number.NEGATIVE_INFINITY;
        }),
      );
    const directlyGrounded = [...args.problems]
      .filter((problem) => Number.isFinite(directScore(problem)))
      .sort(
        (left, right) =>
          directScore(right) - directScore(left) || right.hybridScore - left.hybridScore,
      );
    const compactCandidates = [
      ...directlyGrounded
        .filter((problem) => problem.type === 'code' && problem.difficulty !== 'hard')
        .slice(0, 1),
      ...directlyGrounded.filter((problem) => problem.type === 'choice'),
      ...directlyGrounded
        .filter((problem) => problem.type === 'code' && problem.difficulty !== 'hard')
        .slice(1),
      ...directlyGrounded.filter((problem) => problem.type !== 'choice' && problem.type !== 'code'),
      ...directlyGrounded.filter(
        (problem) => problem.type === 'code' && problem.difficulty === 'hard',
      ),
    ];
    const compactSelection = Array.from(
      new Map(compactCandidates.map((problem) => [problem.id, problem] as const)).values(),
    ).slice(0, desiredQuestionCount);
    if (compactSelection.length === desiredQuestionCount) {
      const compactAssignments = new Map(
        sessions.map((session) => [session.id, [] as string[]] as const),
      );
      for (const problem of compactSelection) {
        const target = [...sessions]
          .filter((session) => {
            const primaryWeak = primaryWeakEvidenceBySession.get(session.id);
            return (
              (compactAssignments.get(session.id)?.length || 0) <
                input.constraints.maxQuestionsPerSession &&
              (!primaryWeak || isDirectEvidenceProblemMatch(primaryWeak, problem))
            );
          })
          .sort((left, right) => {
            const load = (session: (typeof sessions)[number]) =>
              (compactAssignments.get(session.id) || []).reduce((sum, problemId) => {
                const assignedProblem = problemById.get(problemId);
                return sum + (assignedProblem ? estimatedQuestionMinutes(assignedProblem) : 0);
              }, 0);
            return load(left) - load(right);
          })[0];
        if (!target) continue;
        compactAssignments.get(target.id)?.push(problem.id);
      }
      if (
        Array.from(compactAssignments.values()).reduce(
          (sum, problemIds) => sum + problemIds.length,
          0,
        ) === desiredQuestionCount
      ) {
        usedProblemIds.clear();
        for (const session of sessions) {
          session.problemIds = compactAssignments.get(session.id) || [];
          session.problemIds.forEach((problemId) => usedProblemIds.add(problemId));
        }
      }
    }
  }

  const selectedTitleKeys = new Set<string>();
  for (const session of sessions) {
    const deduplicatedProblemIds: string[] = [];
    for (const problemId of session.problemIds) {
      const problem = problemById.get(problemId);
      if (!problem) continue;
      const titleKey = compactNaturalText(problem.title);
      if (!selectedTitleKeys.has(titleKey)) {
        selectedTitleKeys.add(titleKey);
        deduplicatedProblemIds.push(problemId);
        continue;
      }
      usedProblemIds.delete(problemId);
      const primaryWeak = primaryWeakEvidenceBySession.get(session.id);
      const replacement = [...args.problems]
        .filter(
          (candidate) =>
            !usedProblemIds.has(candidate.id) &&
            !selectedTitleKeys.has(compactNaturalText(candidate.title)) &&
            (!primaryWeak || isDirectEvidenceProblemMatch(primaryWeak, candidate)),
        )
        .sort((left, right) => {
          if (!primaryWeak) return right.hybridScore - left.hybridScore;
          return (
            evidenceProblemScore(primaryWeak, right) - evidenceProblemScore(primaryWeak, left) ||
            right.hybridScore - left.hybridScore
          );
        })[0];
      if (replacement) {
        deduplicatedProblemIds.push(replacement.id);
        usedProblemIds.add(replacement.id);
        selectedTitleKeys.add(compactNaturalText(replacement.title));
      } else if (exactQuestionTarget !== null) {
        throw new Error(`真实题库无法在不重复题目的前提下满足 ${exactQuestionTarget} 道题。`);
      }
    }
    session.problemIds = deduplicatedProblemIds;
  }

  if (exactQuestionTarget === null) {
    const requiredQuestionCount = minimumQuestionCount(input);
    for (const session of sessions) {
      const windowCap = calendarWindowMinuteCap(session);
      const estimatedSessionQuestions = () =>
        session.problemIds.reduce((sum, problemId) => {
          const problem = problemById.get(problemId);
          return sum + (problem ? estimatedQuestionMinutes(problem) : 0);
        }, 0);
      while (
        estimatedSessionQuestions() > windowCap &&
        usedProblemIds.size > requiredQuestionCount
      ) {
        const removableProblemId = [...session.problemIds].sort((leftId, rightId) => {
          const left = problemById.get(leftId);
          const right = problemById.get(rightId);
          return (
            (right ? estimatedQuestionMinutes(right) : 0) -
            (left ? estimatedQuestionMinutes(left) : 0)
          );
        })[0];
        if (!removableProblemId) break;
        session.problemIds = session.problemIds.filter(
          (problemId) => problemId !== removableProblemId,
        );
        usedProblemIds.delete(removableProblemId);
      }
    }
    const estimatedPlanMinimum = () =>
      sessions.reduce((sum, session) => {
        const questionMinutes = session.problemIds.reduce((questionSum, problemId) => {
          const problem = problemById.get(problemId);
          return questionSum + (problem ? estimatedQuestionMinutes(problem) : 0);
        }, 0);
        return sum + Math.max(10, questionMinutes);
      }, 0);
    while (
      estimatedPlanMinimum() > input.constraints.totalMinutes &&
      usedProblemIds.size > requiredQuestionCount
    ) {
      const removable = sessions
        .flatMap((session) =>
          session.problemIds.map((problemId) => ({
            session,
            problemId,
            problem: problemById.get(problemId),
          })),
        )
        .filter((item) => item.problem)
        .sort((left, right) => {
          const leftCrowded = left.session.problemIds.length > 1 ? 1 : 0;
          const rightCrowded = right.session.problemIds.length > 1 ? 1 : 0;
          return (
            rightCrowded - leftCrowded ||
            estimatedQuestionMinutes(right.problem!) - estimatedQuestionMinutes(left.problem!) ||
            (bestWeakEvidence(left.problem!)?.score || 0) -
              (bestWeakEvidence(right.problem!)?.score || 0)
          );
        })[0];
      if (!removable) break;
      removable.session.problemIds = removable.session.problemIds.filter(
        (problemId) => problemId !== removable.problemId,
      );
      usedProblemIds.delete(removable.problemId);
    }
  }

  for (const session of sessions) {
    const before = originalProblemIds.get(session.id) || [];
    const changed = before.join('|') !== session.problemIds.join('|');
    const selected = session.problemIds
      .map((problemId) => problemById.get(problemId))
      .filter((problem): problem is NonNullable<typeof problem> => Boolean(problem));
    const primary = primaryWeakEvidenceBySession.get(session.id);
    const allMatchPrimary = Boolean(
      primary && selected.every((problem) => isDirectEvidenceProblemMatch(primary, problem)),
    );
    if (changed && selected.length && primary && allMatchPrimary) {
      const titles = selected.map((problem) => `《${problem.title}》`).join('、');
      const primarySkills = new Set(directSkillIds(`${primary.title}\n${primary.excerpt}`));
      const primaryDomain = directEvidenceDomain(`${primary.title}\n${primary.excerpt}`);
      session.focus = `直接修复近期薄弱点：${cleanEvidenceTitle(primary.title)}`;
      session.reason = `近期记录“${cleanEvidenceTitle(primary.title)}”显示：${evidenceFinding(primary)}。本段用 ${titles} 直接复查同一能力，不用已掌握内容凑题量。`;
      session.method = primarySkills.has('recursive-subproblem')
        ? `依次完成 ${titles}；本题统一采用递归解法，不使用显式栈或 DFS/BFS 迭代；先圈出所有 recursive call 的实参，确认它确实移动到 child/subtree，再计算输出或补全代码。`
        : primarySkills.has('representation-invariant')
          ? `依次完成 ${titles}；每题标出 mutation 前后的对象状态，逐条检查表示不变式，并写出阻止非法状态的 guard。`
          : primaryDomain === 'tree-return-composition'
            ? `依次完成 ${titles}；统一采用递归解法，不使用显式栈或 DFS/BFS 迭代；先列出每个 child/subtree 的返回值，再按遍历顺序组合左右分支，最后核对是否遗漏任一分支。`
            : `依次完成 ${titles}；每题先独立写出关键步骤和边界，再依据结果记录一个具体错因。`;
      session.completionSignal = `你能解释每道题怎样检验“${cleanEvidenceTitle(primary.title)}”暴露的问题，并在同类边界下稳定作答。`;
      session.evidenceIds = uniqueStrings([
        ...session.evidenceIds.filter(
          (id) => id.startsWith('calendar:') || id.startsWith('profile:'),
        ),
        primary.id,
      ]);
    } else if (!selected.length) {
      const evidenceLabel = primary ? cleanEvidenceTitle(primary.title) : '本轮证据';
      session.focus = `不新增题：复盘${evidenceLabel}`;
      session.method =
        '不新增题；只根据这条学习证据整理一个具体错因、一个最小反例和一条可复用检查清单。';
      session.reason = primary
        ? `近期记录“${evidenceLabel}”显示：${evidenceFinding(primary)}。本段只做复盘，不声称安排新的题目。`
        : '本段只做证据复盘，不声称安排新的题目。';
      session.completionSignal = '能用自己的话说清一个具体错因，并写出下一次可直接执行的检查步骤。';
      session.evidenceIds = uniqueStrings([
        ...session.evidenceIds.filter((id) => !id.startsWith('problem:')),
        ...(primary ? [primary.id] : []),
      ]);
    }
  }

  const baseMinutes = 10;
  const minuteStep = input.constraints.totalMinutes % 5 === 0 ? 5 : 1;
  const requestedMinutes = sessions.map((session) => session.minutes);
  const minimumMinutes = sessions.map((session) => {
    const questionMinutes = session.problemIds.reduce((sum, problemId) => {
      const problem = problemById.get(problemId);
      return sum + (problem ? estimatedQuestionMinutes(problem) : 0);
    }, 0);
    const rawMinimum = Math.max(baseMinutes, questionMinutes);
    return Math.ceil(rawMinimum / minuteStep) * minuteStep;
  });
  const minimumMinuteTotal = minimumMinutes.reduce((sum, value) => sum + value, 0);
  if (minimumMinuteTotal > input.constraints.totalMinutes) {
    throw new Error(
      `按题型与难度估算至少需要 ${minimumMinuteTotal} 分钟，但用户只有 ${input.constraints.totalMinutes} 分钟；不会生成无法执行的计划。`,
    );
  }
  const weights = requestedMinutes.map((value) => Math.max(1, value));
  const sessionMinuteCaps = sessions.map(calendarWindowMinuteCap);
  const impossibleWindowIndex = minimumMinutes.findIndex(
    (value, index) => value > sessionMinuteCaps[index],
  );
  if (impossibleWindowIndex >= 0) {
    throw new Error(
      `第 ${impossibleWindowIndex + 1} 个复习段至少需要 ${minimumMinutes[impossibleWindowIndex]} 分钟，但引用的日历窗口只有 ${sessionMinuteCaps[impossibleWindowIndex]} 分钟。`,
    );
  }
  const normalizedMinutes = [...minimumMinutes];
  let remaining = input.constraints.totalMinutes - minimumMinuteTotal;
  while (remaining > 0) {
    const nextIncrement = Math.min(minuteStep, remaining);
    const targetIndex = sessions
      .map((_, index) => index)
      .filter((index) => normalizedMinutes[index] + nextIncrement <= sessionMinuteCaps[index])
      .sort((left, right) => {
        const leftExtra = normalizedMinutes[left] - minimumMinutes[left];
        const rightExtra = normalizedMinutes[right] - minimumMinutes[right];
        return weights[right] / (rightExtra + 1) - weights[left] / (leftExtra + 1) || left - right;
      })[0];
    if (targetIndex === undefined) {
      throw new Error('所有复习段都受日历窗口限制，无法容纳用户给定的总复习时长。');
    }
    normalizedMinutes[targetIndex] += nextIncrement;
    remaining -= nextIncrement;
  }

  if (useAbsoluteClock && /未来\s*三天|未来3天/.test(input.query)) {
    const deadlineEvent = [...input.sources.calendar]
      .filter((item) => /考试|截止|作业|exam|deadline/i.test(item.title))
      .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))[0];
    if (deadlineEvent) {
      const deadlineDate = calendarLocalTime(deadlineEvent.startsAt, deadlineEvent.timezone)
        .slice(0, 10)
        .replaceAll('/', '-');
      const deadlineDay = Date.parse(`${deadlineDate}T12:00:00Z`);
      const lastPlanningDate = new Date(deadlineDay - 86_400_000).toISOString().slice(0, 10);
      for (const [index, session] of sessions.entries()) {
        if (session.date < deadlineDate) continue;
        session.date = lastPlanningDate;
        const previousEndMinute = sessions.slice(0, index).reduce((latest, previous, prevIndex) => {
          if (previous.date !== lastPlanningDate) return latest;
          const match = previous.startTime.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
          if (!match) return latest;
          return Math.max(
            latest,
            Number(match[1]) * 60 + Number(match[2]) + normalizedMinutes[prevIndex],
          );
        }, 20 * 60);
        const startMinute = previousEndMinute + 10;
        if (startMinute + normalizedMinutes[index] >= 24 * 60) {
          throw new Error('考试前三天的可用时间不足以容纳全部复习段。');
        }
        session.startTime = `${String(Math.floor(startMinute / 60)).padStart(2, '0')}:${String(
          startMinute % 60,
        ).padStart(2, '0')}`;
      }
    }
  }
  if (useAbsoluteClock) {
    for (let index = 1; index < sessions.length; index += 1) {
      const previous = sessions[index - 1];
      const current = sessions[index];
      if (previous.date !== current.date) continue;
      const previousMatch = previous.startTime.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
      const currentMatch = current.startTime.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
      if (!previousMatch || !currentMatch) continue;
      const previousEnd =
        Number(previousMatch[1]) * 60 + Number(previousMatch[2]) + normalizedMinutes[index - 1];
      const currentStart = Number(currentMatch[1]) * 60 + Number(currentMatch[2]);
      if (currentStart >= previousEnd) continue;
      const shiftedStart = previousEnd + 10;
      if (shiftedStart + normalizedMinutes[index] >= 24 * 60) {
        throw new Error('同一天的复习段在时长归一化后无法排成不重叠时间线。');
      }
      current.startTime = `${String(Math.floor(shiftedStart / 60)).padStart(2, '0')}:${String(
        shiftedStart % 60,
      ).padStart(2, '0')}`;
    }
  }

  let elapsedMinutes = 0;
  return sessions.map((session, index) => {
    const minutes = normalizedMinutes[index];
    const problemEvidenceIds = session.problemIds.map((problemId) => `problem:${problemId}`);
    const evidenceIds = uniqueStrings([
      ...session.evidenceIds.filter((id) => !id.startsWith('problem:')),
      ...problemEvidenceIds,
    ]);
    const questions: MemoryReviewPlanQuestion[] = session.problemIds.map((problemId) => {
      const problem = problemById.get(problemId);
      if (!problem || !problem.href) {
        throw new Error(`无法把题库题 ${problemId} 解析为可作答链接。`);
      }
      const primary = primaryWeakEvidenceBySession.get(session.id);
      const matched =
        primary && isDirectEvidenceProblemMatch(primary, problem)
          ? { item: primary, score: evidenceProblemScore(primary, problem) }
          : bestWeakEvidence(problem);
      const questionEvidenceIds = uniqueStrings([
        ...(matched && isDirectEvidenceProblemMatch(matched.item, problem)
          ? [matched.item.id]
          : session.evidenceIds),
        `problem:${problemId}`,
      ]);
      return {
        problemId,
        title: problem.title,
        href: problem.href,
        type: problem.type,
        difficulty: problem.difficulty,
        tags: problem.tags,
        reason: studentFacingQuestionReason(problem, `${session.focus}\n${session.reason}`),
        evidenceIds: questionEvidenceIds,
      };
    });
    const normalizedDate = useAbsoluteClock ? session.date : input.today;
    let normalizedStartTime = useAbsoluteClock
      ? session.startTime
      : `开始后 ${elapsedMinutes} 分钟`;
    if (useAbsoluteClock) {
      const proposedStart = Date.parse(`${normalizedDate}T${session.startTime}:00`);
      const containingStudyWindow = input.sources.calendar.find((item) => {
        if (!item.endsAt || !/(?:复习|准备|学习|study|review|prep)/i.test(item.title)) {
          return false;
        }
        const localStart = Date.parse(
          calendarLocalTime(item.startsAt, item.timezone).replaceAll('/', '-').replace(' ', 'T'),
        );
        const localEnd = Date.parse(
          calendarLocalTime(item.endsAt, item.timezone).replaceAll('/', '-').replace(' ', 'T'),
        );
        return (
          [proposedStart, localStart, localEnd].every(Number.isFinite) &&
          proposedStart >= localStart &&
          proposedStart < localEnd &&
          proposedStart + minutes * 60_000 > localEnd &&
          minutes * 60_000 <= localEnd - localStart
        );
      });
      if (containingStudyWindow) {
        normalizedStartTime = roundClockToFiveMinutes(
          calendarLocalTime(containingStudyWindow.startsAt, containingStudyWindow.timezone).slice(
            -5,
          ),
        );
      }
    }
    const dateTimestamp = Date.parse(`${normalizedDate}T00:00:00`);
    const todayTimestamp = Date.parse(`${input.today}T00:00:00`);
    const dayDistance =
      Number.isFinite(dateTimestamp) && Number.isFinite(todayTimestamp)
        ? Math.round((dateTimestamp - todayTimestamp) / 86_400_000)
        : null;
    const dayLabel =
      dayDistance === 0
        ? '今天'
        : dayDistance === 1
          ? '明天'
          : dayDistance === 2
            ? '后天'
            : dayDistance !== null && dayDistance > 2
              ? `${dayDistance}天后`
              : session.dayLabel;
    const normalized = {
      ...session,
      id: `session-${index + 1}`,
      dayLabel,
      date: normalizedDate,
      startTime: normalizedStartTime,
      minutes,
      focus: studentFacingTopic(`${session.focus}\n${session.method}\n${session.reason}`),
      method: session.method.replace(/前两次/g, '近期练习').replace(/白天做过/g, '近期做过'),
      reason: session.reason.replace(/前两次/g, '近期练习').replace(/白天做过/g, '近期做过'),
      evidenceIds,
      questions,
      questionCount: questions.length,
    };
    elapsedMinutes += minutes;
    return normalized;
  });
}

function roundClockToFiveMinutes(value: string) {
  const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!match) return value;
  const totalMinutes = Number(match[1]) * 60 + Number(match[2]);
  const roundedMinutes = Math.min(23 * 60 + 55, Math.ceil(totalMinutes / 5) * 5);
  return `${String(Math.floor(roundedMinutes / 60)).padStart(2, '0')}:${String(
    roundedMinutes % 60,
  ).padStart(2, '0')}`;
}

function compactChineseSpacing(value: string) {
  let result = value;
  for (let pass = 0; pass < 3; pass += 1) {
    result = result.replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, '$1$2');
  }
  return result;
}

function shortenNaturalText(value: string, maximumLength: number) {
  const compact = value
    .replace(/\s+/g, ' ')
    .replace(/。[；;]/g, '；')
    .replace(/；{2,}/g, '；')
    .trim();
  if (compact.length <= maximumLength) return compact;
  const candidate = compact.slice(0, maximumLength + 1);
  const boundary = Math.max(
    candidate.lastIndexOf('；'),
    candidate.lastIndexOf('。'),
    candidate.lastIndexOf('，'),
    candidate.lastIndexOf(','),
  );
  return `${candidate.slice(0, boundary >= Math.floor(maximumLength * 0.55) ? boundary : maximumLength).trim()}…`;
}

function studentFacingTopic(value: string) {
  const domain = directEvidenceDomain(value);
  if (domain === 'recursive-subproblem') return '树递归：每次调用都进入更小的子树';
  if (domain === 'tree-return-composition') return '树遍历：完整合并左右分支结果';
  if (domain === 'representation-invariant') return '表示不变式：修改对象后重新检查合法状态';
  if (domain === 'aliasing-copy') return '浅拷贝、深拷贝与共享引用';
  if (domain === 'abstract-contract') return '抽象与接口契约';
  if (domain === 'complexity-bound') return '复杂度与最坏情况边界';
  if (domain === 'boundary-proof') return '边界情况与正确性检查';
  return shortenNaturalText(
    value
      .replace(/^直接修复近期薄弱点[:：]\s*/i, '')
      .replace(/^稳定薄弱点[:：]\s*/i, '')
      .replace(/^不新增题[:：]\s*复盘\s*/i, '错因复盘：')
      .replace(/\s*·\s*(?:阶段|练习)\s*\d+\s*$/i, '')
      .replace(/^短期学习状态$/i, '当前最需要加固的知识点'),
    48,
  );
}

function studentFacingQuestionReason(
  problem: { title: string; type: string; difficulty: string; question: string },
  evidenceText: string,
) {
  const topic = studentFacingTopic(evidenceText);
  const domain = directEvidenceDomain(evidenceText);
  const statement = `${problem.title}\n${problem.question}`;
  if (/初始化与表示不变式/.test(problem.title)) {
    return '逐步追踪对象状态的变化，检查每次赋值后表示不变式是否仍成立。';
  }
  if (/BankAccount[\s\S]*(?:deposit|withdraw)/i.test(statement)) {
    return '亲手完成 deposit 和 withdraw，检查每次修改后 balance 仍满足表示不变式。';
  }
  if (/find_max_using_acc/i.test(statement)) {
    if (domain === 'tree-return-composition') {
      return '列出每个子节点返回的最大值，再合并结果，检查是否漏掉任何分支。';
    }
    return '沿 find_max_using_acc 的调用顺序标出每次传入的子节点，检查递归参数是否真的变小。';
  }
  if (/check_height/i.test(statement)) {
    if (domain === 'tree-return-composition') {
      return '列出每个 child 返回的高度，再做 max 合并，检查是否遗漏一支。';
    }
    return '沿 check_height 的 child 参数逐层追踪树高，检查每次调用是否进入更小子树。';
  }
  if (/inorder[\s\S]*preorder[\s\S]*postorder/i.test(statement)) {
    if (domain === 'tree-return-composition') {
      return '分别写出左右子树的返回字符串，再按遍历顺序完整合并。';
    }
    return '亲手写三种遍历，并逐次检查递归调用是否传入 _left 或 _right。';
  }
  const task = shortenNaturalText(
    problem.title.replace(/^(?:编程题|选择题|代码追踪|简答题)[:：]\s*/i, ''),
    30,
  );
  if (problem.type === 'code') {
    return `亲手完成“${task}”，检查你能否真正做到“${topic}”。`;
  }
  if (problem.type === 'choice') {
    return `判断“${task}”各选项的依据，检查你是否真正理解“${topic}”。`;
  }
  return `用“${task}”这道${problem.difficulty === 'hard' ? '综合' : '短'}题检查“${topic}”。`;
}

function studentFacingMethod(value: string) {
  return shortenNaturalText(
    compactChineseSpacing(
      value
        .replace(/^依次完成\s+[\s\S]*?[；;]/, '')
        .replace(/recursive call/gi, '递归调用')
        .replace(/child\/subtree/gi, '子节点或子树')
        .replace(/recursive subproblem/gi, '递归子问题')
        .replace(/base case/gi, '终止条件')
        .replace(/mutation/gi, '修改对象')
        .replace(/aliasing/gi, '共享引用')
        .replace(/guard/gi, '防护条件')
        .replace(/Representation Invariants?/gi, '表示不变式')
        .replace(/\bRI\b/g, '表示不变式')
        .replace(/不新增题[；;]\s*/g, ''),
    ),
    118,
  );
}

function studentFacingReason(value: string) {
  return shortenNaturalText(
    compactChineseSpacing(
      value
        .replace(/^近期记录“[^”]+”显示[:：]\s*/i, '')
        .replace(/[；;。]\s*候选题里[\s\S]*$/i, '')
        .replace(/本段用[\s\S]*$/i, '')
        .replace(/本段只做[\s\S]*$/i, '')
        .replace(/下一教学动作[:：]/g, '建议：')
        .replace(/recursive call/gi, '递归调用')
        .replace(/child\/subtree/gi, '子节点或子树')
        .replace(/recursive subproblem/gi, '递归子问题')
        .replace(/base case/gi, '终止条件')
        .replace(/mutation/gi, '修改对象')
        .replace(/aliasing/gi, '共享引用')
        .replace(/guard/gi, '防护条件')
        .replace(/Representation Invariants?/gi, '表示不变式')
        .replace(/\bRI\b/g, '表示不变式'),
    ),
    82,
  );
}

function studentFacingCalendarTime(startsAt: string, timezone: string) {
  const [date = '', time = ''] = calendarLocalTime(startsAt, timezone).split(' ');
  const [, month = '', day = ''] = date.split('/');
  if (!month || !day || !time) return date || time;
  return `${Number(month)}月${Number(day)}日 ${time}`;
}

function studentFacingSessionStart(
  session: MemoryReviewPlanResponse['plan']['sessions'][number],
  index: number,
) {
  if (/^开始后\s*0\s*分钟$/.test(session.startTime)) return '现在开始';
  if (/^开始后\s*\d+\s*分钟$/.test(session.startTime)) return index === 0 ? '现在开始' : '接着';
  return `${session.dayLabel} ${session.startTime}`;
}

function buildUserMessage(args: {
  input: z.infer<typeof requestSchema>;
  readPlan: z.infer<typeof readPlanSchema>;
  evidence: MemoryReviewPlanEvidence[];
  title: string;
  priorities: GeneratedPlan['priorities'];
  sessions: MemoryReviewPlanResponse['plan']['sessions'];
}) {
  const calledTools = new Set(args.readPlan.calls.map((call) => call.toolId));
  const scheduleEvidenceSourceIds = new Set(
    args.evidence.filter((item) => item.sourceType === 'schedule').map((item) => item.sourceId),
  );
  const citedScheduleSourceIds = new Set(
    args.sessions
      .flatMap((session) => session.evidenceIds)
      .filter((evidenceId) => evidenceId.startsWith('calendar:'))
      .map((evidenceId) => evidenceId.slice('calendar:'.length)),
  );
  const relevantCalendar = args.input.sources.calendar
    .filter((item) => scheduleEvidenceSourceIds.has(item.id) && citedScheduleSourceIds.has(item.id))
    .sort((left, right) => {
      const priority = (title: string) => (/考试|截止|作业|exam|deadline/i.test(title) ? 0 : 1);
      return (
        priority(left.title) - priority(right.title) ||
        Date.parse(left.startsAt) - Date.parse(right.startsAt)
      );
    })[0];
  const totalMinutes = args.sessions.reduce((sum, session) => sum + session.minutes, 0);
  const totalQuestions = args.sessions.reduce(
    (sum, session) => sum + (session.questions?.length || 0),
    0,
  );
  const firstActionSession =
    args.sessions.find((session) => (session.questions?.length || 0) > 0) || args.sessions[0];
  const firstQuestion = firstActionSession?.questions?.[0];
  const firstAction = firstActionSession
    ? `${studentFacingSessionStart(firstActionSession, args.sessions.indexOf(firstActionSession))}先${
        firstQuestion
          ? `做《${firstQuestion.title}》`
          : studentFacingMethod(firstActionSession.method)
      }（${firstActionSession.minutes} 分钟）`
    : '现在开始复习';
  const lines: string[] = [];
  if (relevantCalendar) {
    const eventKind = /考试|exam/i.test(relevantCalendar.title) ? '考试' : '截止';
    lines.push(
      `${eventKind}：${relevantCalendar.title}，${studentFacingCalendarTime(relevantCalendar.startsAt, relevantCalendar.timezone)}。因此复习会在${eventKind}前完成；${firstAction}。整份计划共 ${totalMinutes} 分钟、${totalQuestions} 道题。`,
    );
  } else {
    lines.push(`${firstAction}。整份计划共 ${totalMinutes} 分钟、${totalQuestions} 道题。`);
  }
  const priorityTopics = uniqueStrings(
    args.sessions.map((session) =>
      studentFacingTopic(`${session.focus}\n${session.method}\n${session.reason}`),
    ),
  ).slice(0, 3);
  if (priorityTopics.length) lines.push(`这轮先解决：${priorityTopics.join('；')}。`);
  if (/避开.{0,12}基础递归|基础递归.{0,12}(?:已经|已)掌握/.test(args.input.query)) {
    lines.push('基础递归已经掌握，这次不再安排。');
  }
  const onlyRecentAttemptsAndBank =
    calledTools.size === 2 &&
    calledTools.has('search_problem_attempts') &&
    calledTools.has('search_problem_bank');
  if (onlyRecentAttemptsAndBank) {
    lines.push('这轮只根据你最近的作答和真实题库安排，不使用日历、长期记忆或课程笔记。');
  } else if (calledTools.has('read_calendar') && !relevantCalendar) {
    lines.push('日历里没有相关考试或截止事项，所以这次只按你给出的可用时间安排。');
  }
  const explainedTopics = new Set<string>();
  const explainedMethods = new Set<string>();
  for (const [index, session] of args.sessions.entries()) {
    const topic = studentFacingTopic(`${session.focus}\n${session.method}\n${session.reason}`);
    const sessionLines = [
      `• ${studentFacingSessionStart(session, index)}｜${session.minutes} 分钟｜${topic}`,
    ];
    if (session.questions?.length) {
      sessionLines.push(
        `  题目：${session.questions.map((question) => `《${question.title}》`).join('、')}`,
      );
    } else {
      sessionLines.push(`  任务：围绕“${topic}”整理一个错因、一个最小反例和一条检查规则`);
    }
    if (session.questions?.length && !explainedMethods.has(topic)) {
      sessionLines.push(`  做法（${topic}）：${studentFacingMethod(session.method)}`);
      explainedMethods.add(topic);
    }
    if (!explainedTopics.has(topic)) {
      const reason = studentFacingReason(session.reason);
      if (reason) sessionLines.push(`  原因：${reason}`);
      explainedTopics.add(topic);
    }
    lines.push(sessionLines.join('\n'));
  }
  if (
    calledTools.has('search_notebooks') &&
    !args.evidence.some((item) => item.sourceType === 'notebook')
  ) {
    lines.push('课程笔记里没有找到与本轮重点直接相关的内容，因此没有拿无关材料支撑安排。');
  }
  if (totalQuestions > 0) {
    lines.push('每道题旁都有“做这道题”按钮，点击即可开始。每题只记录一个最关键错因。');
  }
  return lines.join('\n\n');
}

function planPrompt(args: {
  input: z.infer<typeof requestSchema>;
  readPlan: z.infer<typeof readPlanSchema>;
  evidence: MemoryReviewPlanEvidence[];
  problems: MemoryReviewPlanResponse['problemBank']['selected'];
  failedTools: MemoryReviewPlanToolTrace[];
}) {
  const evidenceText = args.evidence
    .map(
      (item, index) =>
        `${index + 1}. [${item.id}] (${item.sourceType}) ${item.title}\n${item.excerpt}`,
    )
    .join('\n\n');
  const problemText = args.problems
    .map(
      (problem) =>
        `[${problem.id}] ${problem.title}\n类型/难度：${problem.type}/${problem.difficulty}\n标签：${problem.tags.join('、')}\n题面：${excerpt(problem.question, 900)}`,
    )
    .join('\n\n');
  return [
    '## 你正在面对的情景',
    '你刚刚作为一名学习教练，完成了一次受权限约束的学习情况调查。现在只需要产出结构化执行计划；服务端会基于归一化后的 session 和真实题目生成学生版短回复，UI 会负责渲染题目链接。',
    'title、summary、priority、session 的 focus/method/reason 会显示在界面中，必须使用学生能理解的教学语言，不能写成后台记录或测试报告。',
    '',
    `用户请求：${args.input.query}`,
    `今天：${args.input.today}`,
    `总时间：${args.input.constraints.totalMinutes} 分钟`,
    `最多 session：${args.input.constraints.maxSessions}`,
    `每次最多题数：${args.input.constraints.maxQuestionsPerSession}`,
    '',
    `读取计划：${JSON.stringify(args.readPlan)}`,
    args.failedTools.length
      ? `读取失败：${args.failedTools.map((item) => `${item.toolId}: ${item.error}`).join('；')}`
      : '读取失败：无',
    '',
    '## 已读取证据',
    evidenceText,
    '',
    '## 已检索的真实 CSC148 题库候选',
    problemText || '没有调用题库或没有返回候选。',
    '',
    '## 学生使用情景',
    '学生会在聊天式学习界面里阅读计划，通常只愿意先看几十秒。结构化结果必须帮助 UI 在第一屏回答：何时开始、先做什么、做多久。完整 evidence 与技术 trace 会单独折叠，不要把验收过程写进 focus、method 或 reason。',
    '在下结论前先检查证据内部是否一致：题目标题、知识点、作答状态和反馈是否在描述同一件事。如果它们彼此冲突，就把该证据视为不可靠，不要把矛盾信息强行编成一个学习故事；可以降低结论置信度、排除这条证据，并在 warnings 中说明。',
    '把 failed、partial、未掌握或明确薄弱的证据作为选题主依据；passed/已掌握证据只用于避免重复训练。只要还有明确薄弱点，就不能仅凭已通过记录另开一个新主题或用已掌握内容凑题量。',
    '每道题必须直接练到它所引用的薄弱证据中的同一知识点、操作或边界；只在大类上相邻不算匹配。例如“树递归调用必须传更小子树”应选会实际编写或检查递归参数的树题，普通嵌套深度题或 BST 搜索复杂度题不能替代。若候选中没有直接题，宁可减少题量并在 warnings 说明，也不要硬套迁移理由。',
    '课程笔记只有在正文与当前请求和 session 主题直接一致时才可引用；检索到了无关笔记不代表它能支撑结论，应明确说明没有找到对口笔记并排除该证据。',
    '把证据翻译成学生能理解的学习判断，而不是复述后台记录。focus 只写本段要解决的具体问题；method 只写可执行动作；reason 用一句话解释近期表现为什么导向这个安排。',
    '如果本轮读到了相关日历事项，必须让学生感知到两件事：第一，日历里具体是哪项考试、截止或学习安排，以及它在什么日期或时间；第二，这项日程怎样改变了复习的先后顺序、强度或留出的缓冲时间。不要只写“我参考了你的日历”。这不是固定句式要求，应自然嵌入当前情景；多项日程只说真正影响决策的事项。如果读取日历却没有找到相关未来事项，也要直接说明没有找到什么，而不是假装日历支持了计划。',
    '当安排题目时，结构化 problemIds 只保存真实题目 ID；不要在 method、reason 和 completionSignal 中反复抄题名。UI 会把题名、简短理由和“做这道题”按钮渲染在同一题卡。',
    '计划必须现实可执行：根据选择题、追踪题、简答题、代码题及其难度估算时间，不要为了显得充实而把过多题目塞进一个时间段。高强度意味着聚焦和及时反馈，不等于题量失真。',
    '只有读到了可靠日历、用户学习时段，或用户自己给出了具体钟点，userMessage 才能承诺绝对日期和开始时间；否则使用“开始后 0–15 分钟”这类相对时间，并让用户自行决定何时开始。',
    '保持信息密度：概括重复证据，不逐条复述后台记录；同一个理由不要在多个 session 里复制。用“表示不变式”“修改对象”“共享引用”“递归调用”“子树”等教学语言，不要使用短期学习状态、稳定薄弱点、阶段 1、练习 9、结构化计划等系统标签。',
    '时间尽量使用 5 分钟的倍数。不要输出 ISO 时间、时区、confirmed/completed 等运行状态，也不要描述“页面下方”或其他无法由模型确认的界面位置。',
    '只谈本轮实际读取且与决策有关的内容；没有可靠证据时要诚实，但不必机械罗列所有未调用来源。',
    '',
    '## 结构化执行结果',
    '生成用户可以直接执行的计划。每个 priority 和 session 都必须引用真实 evidenceId。',
    '每个 session 必须说明日期、开始时间、分钟数、复习方法、原因、题目数量和完成信号；所有 session.minutes 之和必须恰好等于总时间。',
    'sessions 必须按真实执行时间先后排列。同一天 00:30 必须排在 20:00 之前；任何 session 都不能声称已经完成实际上排在它之后的练习。startTime 只写一个开始钟点或一个“开始后 N 分钟”，不要同时在 startTime 中写时间区间；区间长度必须与 minutes 完全一致。',
    'problemIds 只能从上面的真实候选选择；questionCount 必须等于 problemIds 数量。',
    '每个安排了 problemId 的 session 都必须引用对应的 problem:{problemId} evidenceId，并同时引用解释为什么选它的学习记忆、近期作答、日历或课程笔记证据。',
    '如果没有日历证据，deadlineSummary 必须明确说没有可靠截止时间，不能猜考试。',
  ].join('\n');
}

export async function POST(request: NextRequest) {
  return runWithRequestContext(
    request,
    '/api/platform-tests/memory-local-review-plan',
    () =>
      safeRoute(async () => {
        const parsed = requestSchema.safeParse(await request.json());
        if (!parsed.success) {
          return NextResponse.json(
            { error: '本地记忆复习计划测试请求无效。', details: parsed.error.flatten() },
            { status: 400 },
          );
        }

        const input = parsed.data;
        const bank = await loadLocalProblemBank('CSC148');
        if (!bank.courseId) {
          throw new Error('CSC148 本地题库快照缺少真实 courseId，不能生成可作答链接。');
        }
        // Attempt evidence keeps its original title/concept/feedback. Rebinding a fixture attempt
        // to a different bank item makes the evidence internally contradictory.
        const csc148Attempts = input.sources.attempts;
        const { model, modelString } = await resolveModelFromHeaders(request, {
          allowOpenAIModelOverride: true,
        });
        let usage: UsageSummary = {
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          totalTokens: 0,
        };

        const plannerResult = await callLLM(
          {
            model,
            system: [
              'You are the read planner for a course-scoped learning-memory agent.',
              'Plan tool calls before seeing private source contents.',
              'Use the minimum evidence necessary, but do not omit evidence explicitly required by the user.',
              'Never ignore an explicit instruction not to read a source.',
            ].join('\n'),
            prompt: inventoryPrompt(input, bank.problemCount),
            output: Output.object({ schema: readPlanSchema }),
            maxOutputTokens: 4_000,
            maxRetries: 0,
          },
          'platform-test-memory-review-read-plan',
        );
        usage = addUsage(usage, usageSummary(plannerResult.usage));
        const readPlan = ensureProblemBankRead(
          input,
          ensureExplicitSourceReads(input, plannerResult.output as z.infer<typeof readPlanSchema>),
        );

        const evidence: MemoryReviewPlanEvidence[] = [];
        const trace: MemoryReviewPlanToolTrace[] = [];
        const selectedProblems: MemoryReviewPlanResponse['problemBank']['selected'] = [];

        for (const call of readPlan.calls as MemoryReviewPlanToolCall[]) {
          const startedAt = new Date().toISOString();
          const startedMs = Date.now();
          const outputEvidenceIds: string[] = [];
          let error: string | null = null;
          try {
            const toolQuery = call.query || input.query;
            if (call.toolId === 'read_user_profile') {
              const evidenceItem: MemoryReviewPlanEvidence = {
                id: `profile:${input.user.id}`,
                sourceType: 'profile',
                title: `${input.user.name} 的全局基本学习资料`,
                excerpt: excerpt(
                  JSON.stringify({
                    learnerProfile: input.user.learnerProfile,
                    studyHabit: input.user.studyHabit,
                  }),
                  2_000,
                ),
                sourceId: input.user.id,
                score: null,
              };
              evidence.push(evidenceItem);
              outputEvidenceIds.push(evidenceItem.id);
            } else if (call.toolId === 'read_calendar') {
              const now = Date.parse(`${input.today}T00:00:00`);
              const items = input.sources.calendar
                .filter((item) => {
                  const timestamp = Date.parse(item.startsAt);
                  return Number.isFinite(timestamp) && timestamp >= now;
                })
                .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
                .slice(0, call.limit);
              for (const item of items) {
                const evidenceItem: MemoryReviewPlanEvidence = {
                  id: `calendar:${item.id}`,
                  sourceType: 'schedule',
                  title: item.title,
                  excerpt: `本地时间：${calendarLocalTime(item.startsAt, item.timezone)}${
                    item.endsAt ? ` 至 ${calendarLocalTime(item.endsAt, item.timezone)}` : ''
                  }；时区 ${item.timezone}；状态 ${item.status}；ISO ${item.startsAt}`,
                  sourceId: item.id,
                  score: null,
                };
                evidence.push(evidenceItem);
                outputEvidenceIds.push(evidenceItem.id);
              }
            } else if (call.toolId === 'search_learning_memory') {
              for (const { item, score } of ranked(
                input.sources.memories.filter((memory) => memory.status === 'active'),
                toolQuery,
                call.limit,
              )) {
                const evidenceItem: MemoryReviewPlanEvidence = {
                  id: `memory:${item.id}`,
                  sourceType: 'memory',
                  title: item.title,
                  excerpt: excerpt(item.text),
                  sourceId: item.id,
                  score,
                };
                evidence.push(evidenceItem);
                outputEvidenceIds.push(evidenceItem.id);
              }
            } else if (call.toolId === 'search_problem_attempts') {
              const recentAttempts = [...csc148Attempts].sort(
                (left, right) => right.createdAt - left.createdAt,
              );
              const newestAttemptCount = Math.min(
                call.limit,
                Math.max(2, Math.ceil(call.limit / 3)),
              );
              const newestAttempts = recentAttempts
                .slice(0, newestAttemptCount)
                .map((item) => ({ item, score: lexicalScore(item, queryTokens(toolQuery)) }));
              const selectedAttempts = Array.from(
                new Map(
                  [...newestAttempts, ...ranked(recentAttempts, toolQuery, call.limit)].map(
                    (candidate) => [candidate.item.id, candidate] as const,
                  ),
                ).values(),
              ).slice(0, call.limit);
              for (const { item, score } of selectedAttempts) {
                const evidenceItem: MemoryReviewPlanEvidence = {
                  id: `attempt:${item.id}`,
                  sourceType: 'attempt',
                  title: `${item.problemTitle} · ${item.status}`,
                  excerpt: excerpt(
                    `题目记录标识：${item.problemId}；知识点：${item.concept}；得分：${item.score}/${item.maxScore ?? '未知'}；反馈：${item.feedback}`,
                  ),
                  sourceId: item.id,
                  score,
                  observedAt: item.createdAt,
                };
                evidence.push(evidenceItem);
                outputEvidenceIds.push(evidenceItem.id);
              }
            } else if (call.toolId === 'search_notebooks') {
              const notebookTokens = relevanceTokens(toolQuery);
              const notebookMatches = input.sources.notebooks
                .map((item) => ({ item, score: lexicalScore(item, notebookTokens) }))
                .filter((item) => item.score >= 2)
                .sort((left, right) => right.score - left.score)
                .slice(0, call.limit);
              for (const { item, score } of notebookMatches) {
                const evidenceItem: MemoryReviewPlanEvidence = {
                  id: `notebook:${item.id}`,
                  sourceType: 'notebook',
                  title: item.title,
                  excerpt: excerpt(item.content, 1_600),
                  sourceId: item.id,
                  score,
                };
                evidence.push(evidenceItem);
                outputEvidenceIds.push(evidenceItem.id);
              }
            } else if (call.toolId === 'search_problem_bank') {
              const ragQueries = problemBankQueries({
                toolQuery,
                reason: call.reason,
                evidence: scopeWeakEvidenceForQuery(input.query, evidence),
              });
              let candidates: Array<{
                problem: LocalProblem;
                hybridScore: number;
              }>;
              try {
                candidates = await hybridRetrieve({
                  bank,
                  queries: ragQueries,
                  limit: Math.min(bank.problems.length, Math.max(32, call.limit * 4)),
                });
              } catch (caught) {
                const reason = caught instanceof Error ? caught.message : String(caught);
                error = `语义 embedding 不可用，已降级为本地 lexical RAG：${reason}`;
                const weakItems = scopeWeakEvidenceForQuery(
                  input.query,
                  weakLearningEvidence(evidence),
                );
                candidates = bank.problems
                  .map((problem) => ({
                    problem,
                    hybridScore: Math.max(
                      lexicalScore(problem, relevanceTokens(toolQuery)),
                      ...weakItems.map((item) => evidenceProblemScore(item, problem)),
                    ),
                  }))
                  .sort((left, right) => right.hybridScore - left.hybridScore)
                  .slice(0, call.limit);
              }
              const weakItems = scopeWeakEvidenceForQuery(
                input.query,
                weakLearningEvidence(evidence),
              );
              if (weakItems.length) {
                const representatives = weakEvidenceRepresentatives({
                  query: input.query,
                  items: weakItems,
                });
                const existingCandidateIds = new Set(
                  candidates.map((candidate) => candidate.problem.id),
                );
                const deterministicGroundedCandidates = bank.problems
                  .filter(
                    (problem) =>
                      !existingCandidateIds.has(problem.id) &&
                      representatives.some((item) => isDirectEvidenceProblemMatch(item, problem)),
                  )
                  .map((problem) => ({
                    problem,
                    hybridScore: Math.max(
                      ...representatives.map((item) => evidenceProblemScore(item, problem)),
                    ),
                  }));
                candidates = [...deterministicGroundedCandidates, ...candidates];
                candidates.sort((left, right) => {
                  const leftGrounding = Math.max(
                    ...weakItems.map((item) => evidenceProblemScore(item, left.problem)),
                  );
                  const rightGrounding = Math.max(
                    ...weakItems.map((item) => evidenceProblemScore(item, right.problem)),
                  );
                  return (
                    rightGrounding -
                      leftGrounding +
                      questionTimeFitScore(right.problem, input.constraints.totalMinutes) -
                      questionTimeFitScore(left.problem, input.constraints.totalMinutes) ||
                    right.hybridScore - left.hybridScore
                  );
                });
                const pools = representatives.map((item) =>
                  candidates
                    .filter((candidate) => isDirectEvidenceProblemMatch(item, candidate.problem))
                    .sort(
                      (left, right) =>
                        evidenceProblemScore(item, right.problem) +
                          questionTimeFitScore(right.problem, input.constraints.totalMinutes) -
                          (evidenceProblemScore(item, left.problem) +
                            questionTimeFitScore(left.problem, input.constraints.totalMinutes)) ||
                        right.hybridScore - left.hybridScore,
                    ),
                );
                const usedCandidateIds = new Set<string>();
                const diverseCandidates: typeof candidates = [];
                let madeProgress = true;
                while (diverseCandidates.length < call.limit && madeProgress) {
                  madeProgress = false;
                  for (const pool of pools) {
                    const candidate = pool.find((item) => !usedCandidateIds.has(item.problem.id));
                    if (!candidate) continue;
                    diverseCandidates.push(candidate);
                    usedCandidateIds.add(candidate.problem.id);
                    madeProgress = true;
                    if (diverseCandidates.length >= call.limit) break;
                  }
                }
                candidates = [
                  ...diverseCandidates,
                  ...candidates.filter((item) => !usedCandidateIds.has(item.problem.id)),
                ];
              }
              candidates = candidates.slice(0, call.limit);
              for (const candidate of candidates) {
                const selected = {
                  id: candidate.problem.id,
                  sourceId: candidate.problem.sourceId,
                  title: candidate.problem.title,
                  type: candidate.problem.type,
                  difficulty: candidate.problem.difficulty,
                  tags: candidate.problem.tags,
                  question: candidate.problem.question,
                  hybridScore: candidate.hybridScore,
                };
                selectedProblems.push(selected);
                const evidenceItem: MemoryReviewPlanEvidence = {
                  id: `problem:${selected.id}`,
                  sourceType: 'problem',
                  title: selected.title,
                  excerpt: excerpt(
                    `类型/难度：${selected.type}/${selected.difficulty}；标签：${selected.tags.join('、')}；题面：${selected.question}`,
                    1_600,
                  ),
                  sourceId: selected.id,
                  score: selected.hybridScore,
                };
                evidence.push(evidenceItem);
                outputEvidenceIds.push(evidenceItem.id);
              }
            }
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
          }
          trace.push({
            ...call,
            status: error && outputEvidenceIds.length === 0 ? 'failed' : 'completed',
            startedAt,
            durationMs: Date.now() - startedMs,
            outputEvidenceIds,
            error,
          });
        }

        const uniqueEvidence = Array.from(
          new Map(evidence.map((item) => [item.id, item] as const)).values(),
        );
        if (!uniqueEvidence.length) {
          throw new Error('读取计划没有返回任何可用于制定学习计划的证据。');
        }
        const uniqueProblems = Array.from(
          new Map(selectedProblems.map((item) => [item.id, item] as const)).values(),
        ).map((problem) => ({
          ...problem,
          href: courseProblemHref(bank.courseId, problem.id),
        }));
        const questionsRequested = queryRequestsQuestions(input.query);
        if (questionsRequested && uniqueProblems.length === 0) {
          throw new Error('用户要求安排题目，但真实 CSC148 题库检索没有返回可用候选。');
        }
        const explicitQuestionCount = explicitRequestedQuestionCount(input.query);
        const normalizedSessionCapacity = Math.min(
          input.constraints.maxSessions,
          Math.max(1, Math.floor(input.constraints.totalMinutes / 10)),
        );
        const questionCapacity =
          normalizedSessionCapacity * input.constraints.maxQuestionsPerSession;
        if (explicitQuestionCount !== null && explicitQuestionCount > questionCapacity) {
          throw new Error(
            `用户明确要求 ${explicitQuestionCount} 道题，但当前计划容量最多为 ${questionCapacity} 道；不能静默减少题量。`,
          );
        }
        if (explicitQuestionCount !== null && uniqueProblems.length < explicitQuestionCount) {
          throw new Error(
            `用户明确要求 ${explicitQuestionCount} 道题，但本轮只检索到 ${uniqueProblems.length} 道真实候选；不能用生成题补足。`,
          );
        }
        const selectableProblems = questionsRequested ? uniqueProblems : [];
        const outputSchema = planOutputSchema(
          uniqueEvidence.map((item) => item.id),
          selectableProblems.map((item) => item.id),
        );
        const generationResult = await callLLM(
          {
            model,
            system: [
              '你是一名负责制定可执行学习计划的学习教练。',
              '你只能根据已执行读取工具返回的证据制定计划。',
              '你只输出结构化计划；服务端生成学生短回复，UI 渲染题目链接。',
              'focus、method 和 reason 必须具体、简短、面向学生，不能使用内部系统标签。',
              '不得编造日历、记忆、作答、题目、课程笔记或 evidence id。',
            ].join('\n'),
            prompt: planPrompt({
              input,
              readPlan,
              evidence: uniqueEvidence,
              problems: selectableProblems,
              failedTools: trace.filter((item) => item.status === 'failed'),
            }),
            output: Output.object({ schema: outputSchema }),
            maxOutputTokens: 8_000,
            maxRetries: 0,
          },
          'platform-test-memory-review-plan',
        );
        usage = addUsage(usage, usageSummary(generationResult.usage));
        const generatedPlan = generationResult.output as z.infer<typeof outputSchema>;
        const weakEvidence = scopeWeakEvidenceForQuery(
          input.query,
          weakLearningEvidence(uniqueEvidence),
        );
        const calledTools = new Set(readPlan.calls.map((call) => call.toolId));
        const absoluteClockPattern = /(?:^|\D)(?:[01]?\d|2[0-3]):[0-5]\d(?:\D|$)/;
        const hasGroundedClock =
          absoluteClockPattern.test(input.query) ||
          calledTools.has('read_user_profile') ||
          calledTools.has('read_calendar');
        const normalizedSessions = normalizePlanSessions({
          input,
          sessions: generatedPlan.sessions,
          problems: selectableProblems,
          weakEvidence,
          priorityEvidenceIds: generatedPlan.priorities.flatMap((priority) => priority.evidenceIds),
          hasGroundedClock,
        });
        const normalizedPriorities = groundedPriorities(generatedPlan.priorities, weakEvidence);
        const hasScheduleEvidence = uniqueEvidence.some((item) => item.sourceType === 'schedule');
        const deadlineSummary = hasScheduleEvidence
          ? generatedPlan.deadlineSummary
          : '没有读取到可靠的考试或截止时间；本计划只按你提供的可用时长安排，不假设额外截止日期。';
        const plannedMinutesAfterNormalization = normalizedSessions.reduce(
          (sum, session) => sum + session.minutes,
          0,
        );
        const plannedQuestionsAfterNormalization = normalizedSessions.reduce(
          (sum, session) => sum + session.questionCount,
          0,
        );
        const suggestedQuestionCount = minimumQuestionCount(input);
        if (
          explicitQuestionCount !== null &&
          plannedQuestionsAfterNormalization < explicitQuestionCount
        ) {
          throw new Error(
            `真实题库中只有 ${plannedQuestionsAfterNormalization} 道候选能直接对应当前薄弱证据，少于用户明确要求的 ${explicitQuestionCount} 道；不会用相邻主题凑题。`,
          );
        }
        const summary = `本轮优先处理${normalizedPriorities
          .slice(0, 3)
          .map((priority) => priority.concept)
          .join(
            '、',
          )}；共安排 ${plannedMinutesAfterNormalization} 分钟和 ${plannedQuestionsAfterNormalization} 道真实题库题。`;
        const plan: Omit<GeneratedPlan, 'sessions'> & {
          userMessage: string;
          sessions: MemoryReviewPlanResponse['plan']['sessions'];
        } = {
          ...generatedPlan,
          userMessage: '',
          summary,
          deadlineSummary: (() => {
            if (!calledTools.has('read_calendar')) return deadlineSummary;
            const deadlineEvent = [...input.sources.calendar]
              .filter((item) => /考试|截止|作业|测验|小测|exam|deadline|quiz/i.test(item.title))
              .sort((left, right) => {
                const priority = (title: string) =>
                  /考试|截止|作业|exam|deadline/i.test(title) ? 0 : 1;
                return (
                  priority(left.title) - priority(right.title) ||
                  Date.parse(left.startsAt) - Date.parse(right.startsAt)
                );
              })[0];
            return deadlineEvent
              ? `已确认：${deadlineEvent.title}在 ${calendarLocalTime(
                  deadlineEvent.startsAt,
                  deadlineEvent.timezone,
                )}；本轮结构化计划共安排 ${plannedMinutesAfterNormalization} 分钟。`
              : '没有读取到可靠的考试或截止时间；本计划只按用户给定的可用时长安排。';
          })(),
          priorities: normalizedPriorities,
          sessions: normalizedSessions,
          warnings: [
            ...generatedPlan.warnings.filter(
              (warning) =>
                !/候选|未选|未(?:加入|选择)|没有.{0,30}(?:加入|选)|第\s*\d+\s*(?:次|个|段)|\bsession\b|凌晨|强度|只保留|题库|课程笔记|课程资料|笔记本/i.test(
                  warning,
                ),
            ),
            ...(generatedPlan.sessions.reduce((sum, session) => sum + session.minutes, 0) !==
            plannedMinutesAfterNormalization
              ? ['服务端已把各段时长归一为用户给定的总时间。']
              : []),
            ...(explicitQuestionCount === null &&
            plannedQuestionsAfterNormalization < suggestedQuestionCount
              ? [
                  `真实题库中有 ${plannedQuestionsAfterNormalization} 道题能直接对应当前薄弱证据，因此没有用相邻主题凑到 ${suggestedQuestionCount} 道。`,
                ]
              : []),
          ].slice(0, 8),
        };
        plan.userMessage = buildUserMessage({
          input,
          readPlan,
          evidence: uniqueEvidence,
          title: plan.title,
          priorities: plan.priorities,
          sessions: plan.sessions,
        });

        const citedEvidenceIds = [
          ...plan.priorities.flatMap((item) => item.evidenceIds),
          ...plan.sessions.flatMap((item) => item.evidenceIds),
        ];
        const validEvidenceIds = new Set(uniqueEvidence.map((item) => item.id));
        const validProblemIds = new Set(uniqueProblems.map((item) => item.id));
        const unknownEvidenceIds = citedEvidenceIds.filter((id) => !validEvidenceIds.has(id));
        const usedProblemIds = plan.sessions.flatMap((item) => item.problemIds);
        const unknownProblemIds = usedProblemIds.filter((id) => !validProblemIds.has(id));
        const usedProblemTitles = uniqueProblems
          .filter((item) => usedProblemIds.includes(item.id))
          .map((item) => item.title);
        const scheduleEvidenceIds = new Set(
          uniqueEvidence.filter((item) => item.sourceType === 'schedule').map((item) => item.id),
        );
        const userMessage = plan.userMessage.trim();
        const compactUserMessage = compactNaturalText(userMessage);
        const compactUserQuery = compactNaturalText(input.query);
        const readCalendarItems = input.sources.calendar.filter((item) =>
          scheduleEvidenceIds.has(`calendar:${item.id}`),
        );
        const calendarFacts = Array.from(
          new Set(readCalendarItems.flatMap((item) => calendarUserFacingFacts(item, input.today))),
        );
        const novelCalendarFacts = calendarFacts.filter(
          (fact) => !compactUserQuery.includes(compactNaturalText(fact)),
        );
        const calendarFactsToCheck = novelCalendarFacts.length ? novelCalendarFacts : calendarFacts;
        const userMessageNamesCalendarFact = calendarFactsToCheck.some((fact) =>
          compactUserMessage.includes(compactNaturalText(fact)),
        );
        const userMessageExplainsCalendarImpact =
          /因此|所以|这意味着|据此|考虑到|距离.{0,20}(?:还有|只剩)|(?:考试|截止).{0,30}(?:前|优先|复习|安排)|(?:优先|提前|压缩|留出|保留).{0,30}(?:复习|练习|检查|缓冲|休息)/.test(
            userMessage,
          );
        const userMessageExplainsEmptyCalendar =
          /没有.{0,20}(?:日历|日程|考试|截止)|(?:日历|日程).{0,20}(?:没有|未找到|没找到)/.test(
            userMessage,
          );
        const userMessageCalendarEvidenceChainPassed =
          !calledTools.has('read_calendar') ||
          (readCalendarItems.length
            ? userMessageNamesCalendarFact && userMessageExplainsCalendarImpact
            : userMessageExplainsEmptyCalendar);
        const userMessageNamesSelectedProblem =
          usedProblemTitles.length === 0 ||
          usedProblemTitles.some((title) => {
            const genericTitleTokens = new Set([
              '实现',
              '判断',
              '选择',
              '分析',
              '代码',
              '题目',
              '考试',
              '原题',
              '关于',
              '下面',
              '哪项',
              '什么',
              '使用',
            ]);
            return queryTokens(title).some(
              (token) =>
                token.length >= 2 &&
                !genericTitleTokens.has(token) &&
                compactUserMessage.includes(compactNaturalText(token)),
            );
          });
        const explicitQuestionTotals = Array.from(
          userMessage.matchAll(
            /(?:总共|共计|一共|合计)\s*([0-9一二三四五六七八九十]+)\s*道题|这\s*([0-9一二三四五六七八九十]+)\s*道题里/g,
          ),
        )
          .map((match) => parseSmallHumanNumber(match[1] || match[2]))
          .filter((count): count is number => count !== null);
        const userMessageQuestionTotalPassed = explicitQuestionTotals.every(
          (count) => count === usedProblemIds.length,
        );
        const userMessageHasPlanDay =
          /现在开始|接着|今天|明天|后天|大后天|第[一二三四五六七八12345678]天|\d{1,2}月\d{1,2}[日号]|\d{4}-\d{1,2}-\d{1,2}|开始后/.test(
            userMessage,
          );
        const userMessageHasPlanDuration = /\d{1,3}\s*分钟/.test(userMessage);
        const userMessagePlanActionabilityPassed =
          userMessageHasPlanDay && userMessageHasPlanDuration && userMessageNamesSelectedProblem;
        const userProvidedClockTime = absoluteClockPattern.test(input.query);
        const userMessageUsesGroundedTime =
          !absoluteClockPattern.test(userMessage) ||
          userProvidedClockTime ||
          calledTools.has('read_user_profile') ||
          calledTools.has('read_calendar');
        const internalMarkerPattern =
          /(?:attempt|problem|memory|calendar|notebook|fixture|session)[_:][a-z0-9_-]+|evidence\s*id|query\s*=|limit\s*=|\bRAG\b|search_[a-z_]+|read_[a-z_]+/i;
        const userMessageHasNoInternalMarkers = !internalMarkerPattern.test(userMessage);
        const studentUxForbiddenPattern =
          /\bISO\b|Asia\/Shanghai|\b(?:confirmed|completed|planned)\b|本地时间[:：]|时区[:：]|状态[:：]|结构化计划|短期学习状态|稳定薄弱点|\bRAG\b|阶段\s*1|练习\s*9|页面下方|放在下方|我按你的要求参考了/i;
        const userMessageHasNoUxLeak = !studentUxForbiddenPattern.test(userMessage);
        const userMessageMaximumLength =
          input.constraints.totalMinutes <= 30
            ? 700
            : input.constraints.totalMinutes <= 60
              ? 900
              : input.constraints.totalMinutes <= 120
                ? 1_100
                : 1_400;
        const userMessageLengthPassed =
          userMessage.length >= 120 && userMessage.length <= userMessageMaximumLength;
        const firstPlannedQuestionTitle = plan.sessions
          .flatMap((session) => session.questions || [])[0]
          ?.title.trim();
        const firstScreenText = compactNaturalText(userMessage.slice(0, 320));
        const firstActionText = compactNaturalText(userMessage.slice(0, 650));
        const userMessageFirstScreenActionPassed =
          firstScreenText.includes(`${plannedMinutesAfterNormalization}分钟`) &&
          firstScreenText.includes(`${usedProblemIds.length}道题`) &&
          /先做|先练|现在开始/.test(userMessage.slice(0, 320)) &&
          (!firstPlannedQuestionTitle ||
            firstActionText.includes(compactNaturalText(firstPlannedQuestionTitle)));
        const normalizedMessageBlocks = userMessage
          .split(/\n+/)
          .map((line) => compactNaturalText(line.replace(/\d+/g, '#')))
          .filter((line) => line.length >= 18 && !line.startsWith('•'));
        const repeatedMessageBlocks = normalizedMessageBlocks.filter(
          (line, index) => normalizedMessageBlocks.indexOf(line) !== index,
        );
        const legacyTemplatePattern =
          /这样安排是因为[:：]|本段题目[:：]|这些题都来自现有题库|完成标准[:：]|不用已掌握内容凑题量/;
        const userMessageAvoidsRepeatedReportTemplate =
          repeatedMessageBlocks.length === 0 && !legacyTemplatePattern.test(userMessage);
        const userMessageUsesNaturalDurations =
          (input.constraints.totalMinutes % 5 !== 0 ||
            plan.sessions.every((session) => session.minutes % 5 === 0)) &&
          !/开始后\s*0\s*分钟|今天[，,]\s*\d{4}-\d{1,2}-\d{1,2}/.test(userMessage);
        const unsupportedSourceClaims = [
          {
            toolId: 'read_calendar' as const,
            pattern: /(?:参考|检查|读取|结合).{0,16}(?:日历|日程)/,
          },
          {
            toolId: 'search_learning_memory' as const,
            pattern: /(?:参考|检查|读取|结合).{0,16}(?:长期记忆|学习记忆)/,
          },
          {
            toolId: 'search_notebooks' as const,
            pattern: /(?:参考|检查|读取|结合).{0,16}(?:课程笔记|讲义)/,
          },
        ].filter(({ toolId, pattern }) => !calledTools.has(toolId) && pattern.test(userMessage));
        const userMessageRespectsSourceBoundary = unsupportedSourceClaims.length === 0;
        const sessionShapePassed = plan.sessions.every(
          (session) =>
            session.date &&
            session.startTime &&
            session.minutes >= 10 &&
            session.method &&
            session.reason &&
            session.questionCount === session.problemIds.length &&
            session.questionCount === (session.questions?.length || 0),
        );
        const plannedMinutes = plan.sessions.reduce((sum, session) => sum + session.minutes, 0);
        const planConstraintPassed =
          plan.sessions.length <= input.constraints.maxSessions &&
          plannedMinutes === input.constraints.totalMinutes &&
          plan.sessions.every(
            (session) => session.questionCount <= input.constraints.maxQuestionsPerSession,
          );
        const selectedProblemById = new Map(
          uniqueProblems.map((problem) => [problem.id, problem] as const),
        );
        const questionLinkContractPassed = plan.sessions.every((session) => {
          const questions = session.questions || [];
          return (
            questions.length === session.problemIds.length &&
            questions.every((question, index) => {
              const selected = selectedProblemById.get(question.problemId);
              return (
                question.problemId === session.problemIds[index] &&
                Boolean(selected) &&
                question.title === selected?.title &&
                question.type === selected?.type &&
                question.difficulty === selected?.difficulty &&
                question.href === courseProblemHref(bank.courseId, question.problemId) &&
                question.evidenceIds.includes(`problem:${question.problemId}`)
              );
            })
          );
        });
        const questionEvidenceChainPassed = plan.sessions.every((session) =>
          (session.questions || []).every((question) => {
            const nonProblemEvidenceIds = question.evidenceIds.filter(
              (evidenceId) => !evidenceId.startsWith('problem:'),
            );
            return (
              question.evidenceIds.every((evidenceId) => validEvidenceIds.has(evidenceId)) &&
              (uniqueEvidence.some((item) => item.sourceType !== 'problem')
                ? nonProblemEvidenceIds.length > 0
                : true)
            );
          }),
        );
        const weakEvidenceIds = new Set(weakEvidence.map((item) => item.id));
        const questionDirectGroundingPassed =
          weakEvidence.length === 0 ||
          plan.sessions.every((session) =>
            (session.questions || []).every((question) => {
              const problem = selectedProblemById.get(question.problemId);
              if (!problem) return false;
              return question.evidenceIds.some((evidenceId) => {
                if (!weakEvidenceIds.has(evidenceId)) return false;
                const item = weakEvidence.find((candidate) => candidate.id === evidenceId);
                return Boolean(item && isDirectEvidenceProblemMatch(item, problem));
              });
            }),
          );
        const directChoiceCandidateCount = uniqueProblems.filter(
          (problem) =>
            problem.type === 'choice' &&
            (weakEvidence.length === 0 ||
              weakEvidence.some((item) => isDirectEvidenceProblemMatch(item, problem))),
        ).length;
        const shortPlanTimeFitPassed =
          input.constraints.totalMinutes > 30 ||
          directChoiceCandidateCount < usedProblemIds.length ||
          plan.sessions.every((session) =>
            (session.questions || []).every((question) => question.type === 'choice'),
          );
        const sessionQuestionWorkloadPassed = plan.sessions.every((session) => {
          const requiredMinutes = (session.questions || []).reduce((sum, question) => {
            const problem = selectedProblemById.get(question.problemId);
            return problem ? sum + estimatedQuestionMinutes(problem) : Number.POSITIVE_INFINITY;
          }, 0);
          return requiredMinutes <= session.minutes;
        });
        const sessionStartOrdinals = plan.sessions.map((session) => {
          const absolute = session.startTime.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
          if (absolute && /^\d{4}-\d{2}-\d{2}$/.test(session.date)) {
            return Date.parse(`${session.date}T${absolute[1].padStart(2, '0')}:${absolute[2]}:00`);
          }
          const relative = session.startTime.match(/^开始后\s*(\d+)\s*分钟$/);
          const dayStart = Date.parse(`${session.date}T00:00:00`);
          return relative && Number.isFinite(dayStart)
            ? dayStart + Number(relative[1]) * 60_000
            : Number.NaN;
        });
        const sessionTimelinePassed = sessionStartOrdinals.every(
          (value, index) =>
            Number.isFinite(value) &&
            (index === 0 ||
              value >= sessionStartOrdinals[index - 1] + plan.sessions[index - 1].minutes * 60_000),
        );
        const calendarSessionWindowsPassed = plan.sessions.every((session) => {
          return input.sources.calendar.every((item) => {
            if (!item?.endsAt) return true;
            const localStart = calendarLocalTime(item.startsAt, item.timezone)
              .replaceAll('/', '-')
              .replace(' ', 'T');
            const localEnd = calendarLocalTime(item.endsAt, item.timezone)
              .replaceAll('/', '-')
              .replace(' ', 'T');
            const absolute = session.startTime.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
            if (!absolute) return true;
            const sessionStart = Date.parse(
              `${session.date}T${absolute[1].padStart(2, '0')}:${absolute[2]}`,
            );
            const eventStart = Date.parse(localStart);
            const eventEnd = Date.parse(localEnd);
            if (![sessionStart, eventStart, eventEnd].every(Number.isFinite)) return true;
            const sessionEnd = sessionStart + session.minutes * 60_000;
            const overlaps = sessionStart < eventEnd && sessionEnd > eventStart;
            if (!overlaps) return true;
            const isStudyWindow = /(?:复习|准备|学习|study|review|prep)/i.test(item.title);
            return isStudyWindow && sessionStart >= eventStart && sessionEnd <= eventEnd;
          });
        });
        const explicitQuestionCountPassed =
          explicitQuestionCount === null || usedProblemIds.length === explicitQuestionCount;
        const questionBoundaryPassed = questionsRequested || usedProblemIds.length === 0;
        const attemptEvidenceBySourceId = new Map(
          uniqueEvidence
            .filter((item) => item.sourceType === 'attempt')
            .map((item) => [item.sourceId, item] as const),
        );
        const attemptEvidencePreserved =
          !calledTools.has('search_problem_attempts') ||
          csc148Attempts.every((attempt) => {
            const item = attemptEvidenceBySourceId.get(attempt.id);
            if (!item) return true;
            return (
              item.title.includes(attempt.problemTitle) &&
              item.excerpt.includes(attempt.concept) &&
              item.excerpt.includes(attempt.feedback)
            );
          });
        const calendarGroundingPassed =
          !calledTools.has('read_calendar') ||
          scheduleEvidenceIds.size === 0 ||
          citedEvidenceIds.some((id) => scheduleEvidenceIds.has(id));
        const checks: MemoryReviewPlanResponse['machineChecks'] = [
          {
            id: 'user-message-standalone',
            label: '学生版回复长度足够说明计划且没有信息过载',
            passed: userMessageLengthPassed,
            detail: `${userMessage.length}/${userMessageMaximumLength} 个字符`,
          },
          {
            id: 'user-message-no-internal-markers',
            label: '最终用户消息没有暴露内部 ID、工具名或检索参数',
            passed: userMessageHasNoInternalMarkers,
            detail: userMessageHasNoInternalMarkers ? '未发现内部标识' : '发现内部标识',
          },
          {
            id: 'user-message-no-ux-leak',
            label: '学生版回复没有运行元数据、系统标签或失真的界面描述',
            passed: userMessageHasNoUxLeak,
            detail: userMessageHasNoUxLeak ? '未发现 UX 泄漏' : '发现运行元数据或系统标签',
          },
          {
            id: 'user-message-source-boundary',
            label: '学生版回复没有暗示读取用户排除的来源',
            passed: userMessageRespectsSourceBoundary,
            detail: userMessageRespectsSourceBoundary
              ? '来源表述符合本轮读取边界'
              : `不当声称：${unsupportedSourceClaims.map((item) => item.toolId).join('、')}`,
          },
          {
            id: 'user-message-first-screen-action',
            label: '前 320 字给出总量和第一步，前 650 字出现第一道题',
            passed: userMessageFirstScreenActionPassed,
            detail: userMessageFirstScreenActionPassed
              ? '学生无需先读完整报告即可开始'
              : '首屏缺少总时长、总题数、第一步或第一道题',
          },
          {
            id: 'user-message-no-repeated-report-template',
            label: '学生版回复没有重复复制验收报告模板',
            passed: userMessageAvoidsRepeatedReportTemplate,
            detail: userMessageAvoidsRepeatedReportTemplate
              ? '未发现重复报告段落'
              : `发现 ${repeatedMessageBlocks.length} 个重复块或旧报告句式`,
          },
          {
            id: 'student-facing-natural-durations',
            label: '复习时长使用自然的 5 分钟时间块',
            passed: userMessageUsesNaturalDurations,
            detail: userMessageUsesNaturalDurations
              ? plan.sessions.map((session) => `${session.minutes}m`).join(' + ')
              : '存在零分钟偏移、日期重复或非 5 分钟时长',
          },
          {
            id: 'user-message-time-grounding',
            label: '最终用户消息中的绝对时间有日历、习惯或用户输入依据',
            passed: userMessageUsesGroundedTime,
            detail: userMessageUsesGroundedTime
              ? '没有无依据的绝对钟点'
              : '未读取时间依据，却给出了绝对钟点',
          },
          {
            id: 'user-message-calendar-evidence-chain',
            label: '最终用户消息说清了具体日程及其对计划的影响',
            passed: userMessageCalendarEvidenceChainPassed,
            detail: !calledTools.has('read_calendar')
              ? '本轮没有读取日历'
              : readCalendarItems.length === 0
                ? userMessageExplainsEmptyCalendar
                  ? '已向用户说明没有相关未来日程'
                  : '读取日历无结果，但用户消息没有说明证据缺口'
                : userMessageCalendarEvidenceChainPassed
                  ? '包含日历中的具体事实，并解释了它如何改变计划'
                  : `缺少${userMessageNamesCalendarFact ? '' : '具体日程事实'}${
                      !userMessageNamesCalendarFact && !userMessageExplainsCalendarImpact
                        ? '和'
                        : ''
                    }${userMessageExplainsCalendarImpact ? '' : '日程对计划的影响'}`,
          },
          {
            id: 'user-message-plan-actionability',
            label: '最终用户消息本身包含复习日期、时长和所选题目',
            passed: userMessagePlanActionabilityPassed,
            detail: userMessagePlanActionabilityPassed
              ? '不展开技术字段也能直接开始执行计划'
              : `缺少${userMessageHasPlanDay ? '' : '复习日期'}${
                  !userMessageHasPlanDay &&
                  (!userMessageHasPlanDuration || !userMessageNamesSelectedProblem)
                    ? '、'
                    : ''
                }${userMessageHasPlanDuration ? '' : '复习时长'}${
                  !userMessageHasPlanDuration && !userMessageNamesSelectedProblem ? '、' : ''
                }${userMessageNamesSelectedProblem ? '' : '具体选题'}`,
          },
          {
            id: 'user-message-question-total',
            label: '最终用户消息中的题目总数与结构化计划一致',
            passed: userMessageQuestionTotalPassed,
            detail: userMessageQuestionTotalPassed
              ? explicitQuestionTotals.length
                ? `用户消息与计划均为 ${usedProblemIds.length} 题`
                : '用户消息没有额外声明可能冲突的题目总数'
              : `计划实际为 ${usedProblemIds.length} 题，用户消息写成 ${explicitQuestionTotals.join('、')} 题`,
          },
          {
            id: 'read-plan-distinct-tools',
            label: '读取计划中的工具没有重复调用',
            passed: calledTools.size === readPlan.calls.length,
            detail: readPlan.calls.map((call) => call.toolId).join(' → '),
          },
          {
            id: 'valid-evidence-ids',
            label: '计划只引用真实返回的 evidenceId',
            passed: unknownEvidenceIds.length === 0,
            detail: unknownEvidenceIds.length ? unknownEvidenceIds.join('、') : '全部引用有效',
          },
          {
            id: 'real-problem-bank-ids',
            label: '计划题目全部来自 CSC148 真实题库快照',
            passed: unknownProblemIds.length === 0,
            detail: `${usedProblemIds.length} 个题目引用；题库共 ${bank.problemCount} 题`,
          },
          {
            id: 'actionable-question-links',
            label: '每道计划题都有由真实 courseId 和 problemId 生成的标题链接',
            passed: questionLinkContractPassed,
            detail: questionLinkContractPassed
              ? `${usedProblemIds.length} 道题的 ID、标题、类型与链接全部匹配`
              : '至少一道题的 ID、标题、类型、顺序或链接不匹配',
          },
          {
            id: 'question-evidence-chain',
            label: '每道计划题都保留题库证据和选题依据',
            passed: questionEvidenceChainPassed,
            detail: questionEvidenceChainPassed
              ? '题库证据与学习依据均可回溯'
              : '至少一道题缺少题库证据或学习依据',
          },
          {
            id: 'question-direct-grounding',
            label: '每道题直接对应失败、部分正确或明确薄弱证据中的同一能力',
            passed: questionDirectGroundingPassed,
            detail: questionDirectGroundingPassed
              ? '所有题目与其薄弱证据存在直接知识点或操作重合'
              : '至少一道题只与证据大类相邻，没有直接检验同一能力',
          },
          {
            id: 'short-plan-question-fit',
            label: '30 分钟以内优先安排可在时限内完成的直接匹配短题',
            passed: shortPlanTimeFitPassed,
            detail:
              input.constraints.totalMinutes > 30
                ? '本轮不是短时计划'
                : `${directChoiceCandidateCount} 道直接匹配选择题候选`,
          },
          {
            id: 'session-question-workload',
            label: '每次复习的题型和难度可在分配时长内完成',
            passed: sessionQuestionWorkloadPassed,
            detail: sessionQuestionWorkloadPassed
              ? '每个 session 均覆盖所选题目的最低估算时长'
              : '至少一个 session 的题目最低估算时长超过分配时长',
          },
          {
            id: 'explicit-question-count',
            label: '用户明确指定题数时不会静默减少或增加',
            passed: explicitQuestionCountPassed,
            detail:
              explicitQuestionCount === null
                ? '用户没有明确指定题数'
                : `${usedProblemIds.length}/${explicitQuestionCount} 道题`,
          },
          {
            id: 'question-generation-boundary',
            label: '用户明确不要题目时不会安排题目',
            passed: questionBoundaryPassed,
            detail: questionsRequested ? '本轮明确需要题目' : `${usedProblemIds.length} 道题`,
          },
          {
            id: 'attempt-evidence-preserved',
            label: '近期作答标题、知识点和反馈保持原始一致性',
            passed: attemptEvidencePreserved,
            detail: attemptEvidencePreserved
              ? `${csc148Attempts.length} 条作答记录未被强行改绑到其他题目`
              : '至少一条作答证据在读取时被改名或改绑',
          },
          {
            id: 'session-actionability',
            label: '每次复习都包含时间、方法、理由和题量',
            passed: sessionShapePassed,
            detail: `${plan.sessions.length} 个 session`,
          },
          {
            id: 'session-timeline-order',
            label: '所有 session 按真实执行时间排序且开始时间格式一致',
            passed: sessionTimelinePassed,
            detail: sessionTimelinePassed ? '时间线单调递增' : '存在倒序或不可解析的开始时间',
          },
          {
            id: 'calendar-session-window',
            label: '复用日历时段时，session 时长不超过日历窗口',
            passed: calendarSessionWindowsPassed,
            detail: calendarSessionWindowsPassed
              ? '所有复用日历时段均未越界'
              : '至少一个 session 超过其引用的日历时段',
          },
          {
            id: 'plan-constraints',
            label: '计划遵守总时长、次数和单次题量限制',
            passed: planConstraintPassed,
            detail: `${plannedMinutes}/${input.constraints.totalMinutes} 分钟；${plan.sessions.length}/${input.constraints.maxSessions} 次`,
          },
          {
            id: 'calendar-grounding',
            label: '读取日历后，截止时间证据实际参与计划',
            passed: calendarGroundingPassed,
            detail: scheduleEvidenceIds.size
              ? `${scheduleEvidenceIds.size} 条日历证据`
              : '本轮没有可用日历证据',
          },
        ];

        const response: MemoryReviewPlanResponse = {
          action: 'generate_review_plan',
          model: modelString,
          readPlan,
          trace,
          evidence: uniqueEvidence,
          problemBank: {
            courseCode: 'CSC148',
            courseId: bank.courseId,
            source: bank.source,
            totalCount: bank.problemCount,
            selected: uniqueProblems,
          },
          plan: {
            ...plan,
            warnings: [
              ...plan.warnings,
              ...trace
                .filter((item) => item.error)
                .map((item) =>
                  item.status === 'failed'
                    ? `${item.toolId} 读取失败：${item.error}`
                    : `${item.toolId} 降级执行：${item.error}`,
                ),
            ],
          },
          machineChecks: checks,
          passedMachineCheck: checks.every((check) => check.passed),
          usage,
          persistence: 'none',
        };
        return NextResponse.json(response);
      }),
    {
      operationCode: 'platform_test_memory_review_plan',
      chargeReason: '本地记忆证据化复习计划测试',
    },
  );
}
