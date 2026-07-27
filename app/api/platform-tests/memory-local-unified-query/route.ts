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
  UNIFIED_MEMORY_QUERY_TOOL_IDS,
  type UnifiedMemoryCalendarAction,
  type UnifiedMemoryQueryEvidence,
  type UnifiedMemoryQueryResponse,
  type UnifiedMemoryQueryToolCall,
  type UnifiedMemoryQueryToolTrace,
} from '@/features/qa/test-center/memory/unified-memory-query-types';
import { safeRoute } from '@/lib/server/json-error-response';
import { resolveOpenAIResponsesModelFromHeaders } from '@/lib/server/resolve-model';
import { runWithRequestContext } from '@/lib/server/request-context';

export const runtime = 'nodejs';

const profileFactSchema = z.object({
  id: z.string().trim().min(1).max(240),
  namespace: z.string().trim().min(1).max(100),
  key: z.string().trim().min(1).max(200),
  valueJson: z.unknown(),
  updatedAt: z.number(),
});

const calendarSchema = z.object({
  id: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(500),
  startsAt: z.string().trim().min(1).max(100),
  endsAt: z.string().trim().max(100).nullable(),
  durationMinutes: z.number().int().min(1).max(1_440).nullable(),
  timezone: z.string().trim().min(1).max(100),
  status: z.string().trim().min(1).max(100),
});

const memorySchema = z.object({
  id: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(500),
  text: z.string().trim().min(1).max(16_000),
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
  answerPreview: z.string().trim().max(8_000).nullable(),
  feedback: z.string().trim().max(8_000),
  createdAt: z.number(),
});

const notebookSchema = z.object({
  id: z.string().trim().min(1).max(240),
  title: z.string().trim().min(1).max(500),
  content: z.string().trim().min(1).max(60_000),
  updatedAt: z.number(),
});

const requestSchema = z
  .object({
    action: z.literal('run_unified_memory_query'),
    caseId: z
      .string()
      .trim()
      .regex(/^[a-z0-9_-]{1,120}$/i),
    query: z.string().trim().min(1).max(12_000),
    today: z.string().trim().min(1).max(40),
    timezone: z.string().trim().min(1).max(100),
    user: z.object({
      id: z
        .string()
        .trim()
        .regex(/^memory-test-[a-z0-9_-]{1,120}$/i),
      name: z.string().trim().min(1).max(200),
      courseCode: z.literal('CSC148'),
    }),
    sources: z.object({
      profile: z.object({ facts: z.array(profileFactSchema).max(20) }),
      calendar: z.array(calendarSchema).max(80),
      workingMemory: z.unknown().nullable(),
      memories: z.array(memorySchema).max(120),
      attempts: z.array(attemptSchema).max(240),
      notebooks: z.array(notebookSchema).max(8),
    }),
  })
  .superRefine((value, context) => {
    const notebookCharacters = value.sources.notebooks.reduce(
      (sum, notebook) => sum + notebook.content.length,
      0,
    );
    if (notebookCharacters > 180_000) {
      context.addIssue({
        code: 'custom',
        path: ['sources', 'notebooks'],
        message: '本地笔记本总内容超过 180000 字符。',
      });
    }
  });

const toolCallSchema = z.object({
  toolId: z.enum(UNIFIED_MEMORY_QUERY_TOOL_IDS),
  reason: z.string().trim().min(1).max(500),
  query: z.string().trim().min(1).max(1_000).nullable(),
  limit: z.number().int().min(1).max(12),
});

const readPlanSchema = z
  .object({
    intent: z.enum([
      'personal_context',
      'learning_state',
      'concept_explanation',
      'problem_explanation',
      'calendar_read',
      'calendar_update',
      'mixed',
    ]),
    decisionSummary: z.string().trim().min(1).max(800),
    calls: z.array(toolCallSchema).max(UNIFIED_MEMORY_QUERY_TOOL_IDS.length),
  })
  .superRefine((plan, context) => {
    const toolIds = plan.calls.map((call) => call.toolId);
    if (new Set(toolIds).size !== toolIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['calls'],
        message: '同一种读取能力在一次计划中最多调用一次。',
      });
    }
    if (plan.intent === 'calendar_update' && !toolIds.includes('read_calendar')) {
      context.addIssue({
        code: 'custom',
        path: ['calls'],
        message: '修改日历前必须读取当前日历。',
      });
    }
  });

const finalAnswerSchema = z.object({
  message: z.string().trim().min(20).max(5_000),
  evidenceState: z.enum(['sufficient', 'partial', 'insufficient']),
  citedEvidenceIds: z.array(z.string().trim().min(1).max(300)).max(20),
  calendarAction: z.object({
    status: z.enum(['none', 'needs_clarification', 'ready']),
    operation: z.enum(['update']).nullable(),
    targetEvidenceId: z.string().trim().min(1).max(300).nullable(),
    updatedTitle: z.string().trim().min(1).max(500).nullable(),
    updatedStartsAt: z.string().trim().min(1).max(100).nullable(),
    durationMinutes: z.number().int().min(1).max(1_440).nullable(),
    confirmationSummary: z.string().trim().min(1).max(1_000).nullable(),
    clarificationQuestion: z.string().trim().min(1).max(1_000).nullable(),
  }),
});

type Input = z.infer<typeof requestSchema>;
type Usage = UnifiedMemoryQueryResponse['usage'];
type ReadPlan = z.infer<typeof readPlanSchema>;
type FinalAnswer = z.infer<typeof finalAnswerSchema>;

function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, totalTokens: 0 };
}

function summarizeUsage(
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    totalTokens?: number;
  } | null,
): Usage {
  const inputTokens = usage?.inputTokens ?? 0;
  const outputTokens = usage?.outputTokens ?? 0;
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: usage?.cachedInputTokens ?? 0,
    totalTokens: usage?.totalTokens ?? inputTokens + outputTokens,
  };
}

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    cachedInputTokens: left.cachedInputTokens + right.cachedInputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function excerpt(value: string, limit = 1_200) {
  const normalized = value.trim();
  return normalized.length > limit ? `${normalized.slice(0, limit)}…` : normalized;
}

function queryTokens(value: string): string[] {
  const normalized = value.normalize('NFKC').toLowerCase();
  const latin = normalized.match(/[a-z0-9_+\-]{2,}/g) || [];
  const cjk = normalized.match(/[\u3400-\u9fff]{2,20}/g) || [];
  const bigrams = cjk.flatMap((run) =>
    Array.from({ length: Math.max(0, run.length - 1) }, (_, index) => run.slice(index, index + 2)),
  );
  return Array.from(new Set([...latin, ...cjk, ...bigrams])).slice(0, 80);
}

function lexicalScore(value: unknown, tokens: string[]) {
  const text = JSON.stringify(value).normalize('NFKC').toLowerCase();
  return tokens.reduce((score, token) => score + (text.includes(token) ? 1 : 0), 0);
}

function ranked<T>(
  items: T[],
  query: string,
  limit: number,
  options?: {
    updatedAt?: (item: T) => number;
    requireLexicalMatch?: boolean;
  },
): Array<{ item: T; score: number }> {
  const tokens = queryTokens(query);
  return items
    .map((item) => ({
      item,
      score: lexicalScore(item, tokens),
      updatedAt: options?.updatedAt?.(item) ?? 0,
    }))
    .filter((candidate) => !options?.requireLexicalMatch || candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.updatedAt - left.updatedAt)
    .slice(0, limit);
}

function availableToolIds(input: Input, problemCount: number) {
  const available = new Set<UnifiedMemoryQueryToolCall['toolId']>();
  if (input.sources.profile.facts.length) available.add('read_user_profile');
  if (input.sources.calendar.length) available.add('read_calendar');
  if (input.sources.workingMemory) available.add('search_working_memory');
  if (input.sources.memories.some((memory) => memory.status === 'active')) {
    available.add('search_learning_memory');
  }
  if (input.sources.attempts.length) available.add('search_problem_attempts');
  if (input.sources.notebooks.length) available.add('search_notebooks');
  if (problemCount > 0) available.add('search_problem_bank');
  return available;
}

function hasPersonalLearningEvidence(input: Input) {
  return Boolean(
    input.sources.workingMemory ||
    input.sources.attempts.length ||
    input.sources.memories.some(
      (memory) => memory.scope === 'private' && memory.status === 'active',
    ),
  );
}

function isLearningStateRequest(input: Input, plan: ReadPlan) {
  if (plan.intent === 'learning_state') return true;
  if (
    /(?:你觉得|告诉我|判断|看看).*(?:我.*)?(?:卡在哪|哪里不会|哪里不稳|最该补|薄弱|短板)|别把.*(?:长期|一次失误)|只看我.*(?:作答|怎么答)/u.test(
      input.query,
    )
  ) {
    return true;
  }
  if (plan.intent !== 'mixed') return false;
  return /学到哪|学习状态|学得没底|最该补|薄弱|短板|掌握|哪里不会|哪里不稳|卡住|卡在哪|反复出错/u.test(
    input.query,
  );
}

function reconcileReadPlan(args: { input: Input; problemCount: number; generated: ReadPlan }) {
  const available = availableToolIds(args.input, args.problemCount);
  const learningStateRequest = isLearningStateRequest(args.input, args.generated);
  const generated =
    learningStateRequest && args.generated.intent === 'problem_explanation'
      ? { ...args.generated, intent: 'learning_state' as const }
      : args.generated;
  const zeroLearningEvidenceGuard =
    !hasPersonalLearningEvidence(args.input) && learningStateRequest;
  const rejectedCalls = generated.calls.filter(
    (call) =>
      !available.has(call.toolId) ||
      (zeroLearningEvidenceGuard && call.toolId !== 'read_user_profile'),
  );
  let calls = generated.calls.filter(
    (call) =>
      available.has(call.toolId) &&
      (!zeroLearningEvidenceGuard || call.toolId === 'read_user_profile'),
  );

  if (
    zeroLearningEvidenceGuard &&
    available.has('read_user_profile') &&
    !calls.some((call) => call.toolId === 'read_user_profile')
  ) {
    calls = [
      {
        toolId: 'read_user_profile',
        reason: '只确认稳定背景和表达偏好，不把个人资料当作掌握或薄弱证据。',
        query: null,
        limit: 1,
      },
    ];
  }

  const readPlan: ReadPlan = zeroLearningEvidenceGuard
    ? {
        ...generated,
        decisionSummary:
          '本轮没有当前学习状态、长期个人学习记忆或真实作答证据；只读取稳定资料以确认表达偏好，不据此判断掌握或薄弱点。',
        calls,
      }
    : { ...generated, calls };

  return { readPlan, rejectedCalls, zeroLearningEvidenceGuard, available };
}

function zeroLearningEvidenceAnswer(): FinalAnswer {
  return {
    message: [
      '我现在不能可靠地判断你最该补哪一块。现有信息没有包含你最近学过的具体内容、真实作答、反复卡点或错因；如果我现在点名某个知识点，只是在猜，不是根据你的学习情况得出的判断。',
      '要得到不泛泛的结论，你可以发来最近 2—3 道最有代表性的题目、你的答案和反馈；如果手边没有，我也可以先给你一组很短的诊断题。看到实际表现以后，我再告诉你应当先补哪一块；在此之前，我不会把任何具体知识点说成你的薄弱点。',
    ].join('\n\n'),
    evidenceState: 'insufficient',
    citedEvidenceIds: [],
    calendarAction: {
      status: 'none',
      operation: null,
      targetEvidenceId: null,
      updatedTitle: null,
      updatedStartsAt: null,
      durationMinutes: null,
      confirmationSummary: null,
      clarificationQuestion: null,
    },
  };
}

function reconcileEvidenceState(args: {
  input: Input;
  readPlan: ReadPlan;
  generated: FinalAnswer;
}): FinalAnswer {
  if (!isLearningStateRequest(args.input, args.readPlan)) return args.generated;

  if (args.generated.evidenceState !== 'sufficient') {
    return args.generated;
  }

  const privateLearningMemoryCount = args.input.sources.memories.filter(
    (memory) => memory.scope === 'private' && memory.status === 'active',
  ).length;
  const hasBroadEnoughCoverage =
    privateLearningMemoryCount >= 4 && args.input.sources.attempts.length >= 6;

  return hasBroadEnoughCoverage ? args.generated : { ...args.generated, evidenceState: 'partial' };
}

function normalizeCitedEvidenceIds(
  citedEvidenceIds: string[],
  evidence: UnifiedMemoryQueryEvidence[],
) {
  const evidenceById = new Map(evidence.map((item) => [item.id, item.id] as const));
  const evidenceBySourceId = new Map(
    evidence
      .filter((item) => item.sourceId)
      .map((item) => [item.sourceId as string, item.id] as const),
  );

  return Array.from(
    new Set(citedEvidenceIds.map((id) => evidenceById.get(id) ?? evidenceBySourceId.get(id) ?? id)),
  );
}

function inventoryPrompt(input: Input, problemCount: number) {
  const workingCount = input.sources.workingMemory ? 1 : 0;
  return [
    `当前日期：${input.today}；时区：${input.timezone}；课程：${input.user.courseCode}。`,
    `用户自然语言：${input.query}`,
    '',
    '你是同一个面向用户的大 agent 的内部读取规划阶段。先判断用户真正要完成的事，再选择最少但足够的读取能力。用户不会说内部能力名，也不会提供内部 ID。',
    '只输出简短、可审计的决策摘要，不输出逐步思维过程。',
    '',
    `当前可用数量：个人资料 ${input.sources.profile.facts.length}，日历 ${input.sources.calendar.length}，工作记忆 ${workingCount}，长期学习记忆 ${input.sources.memories.length}，近期作答 ${input.sources.attempts.length}，已生成课程笔记本 ${input.sources.notebooks.length}，真实题库 ${problemCount}。`,
    '',
    '可用读取能力：',
    '- read_user_profile：姓名以外的稳定背景、讲解偏好、学习时长与习惯。用户说“按我习惯的方式”时应考虑。',
    '- read_calendar：精确日程；任何日历修改都必须先读，歧义时不能猜。',
    '- search_working_memory：当前正在卡住的点和最近教学动作。',
    '- search_learning_memory：较稳定的掌握、薄弱、原因与下一教学动作。',
    '- search_problem_attempts：实际做题表现、得分和反馈。',
    '- search_notebooks：用户之前生成的 CSC148 课程笔记本与老师契约。课程知识点或课程格式讲解时应考虑。',
    '- search_problem_bank：302 道真实 CSC148 题。用户粘贴或指代题面、要讲题或要对症选题时应考虑。',
    '',
    '不要调用数量为 0 的读取能力。不要因为能力存在就全读。题目讲解不要只搜长期记忆；课程知识讲解不要凭个人资料猜。修改日历以外的请求不得生成写操作。',
    'query 写给该读取能力的自然检索词；纯读取无需 query 时填 null。',
  ].join('\n');
}

function evidencePrompt(args: {
  input: Input;
  readPlan: z.infer<typeof readPlanSchema>;
  evidence: UnifiedMemoryQueryEvidence[];
  failedTools: UnifiedMemoryQueryToolTrace[];
}) {
  const evidenceText = args.evidence.length
    ? args.evidence
        .map(
          (item, index) =>
            `${index + 1}. [${item.id}] (${item.sourceType}) ${item.title}\n${item.excerpt}`,
        )
        .join('\n\n')
    : '本轮没有取得可用证据。';
  return [
    `用户原话：${args.input.query}`,
    `当前日期：${args.input.today}；用户时区：${args.input.timezone}。`,
    `内部意图：${args.readPlan.intent}。`,
    '',
    '已返回证据：',
    evidenceText,
    '',
    args.failedTools.length
      ? `读取失败摘要：${args.failedTools
          .map((item) => item.error)
          .filter(Boolean)
          .join('；')}`
      : '读取失败摘要：无。',
    '',
    '直接回答用户。message 必须像同一个助教自然理解了上下文后给出的回复，不要告诉用户你走了哪条路径、调用了什么工具、查了哪个存储层，也不要出现内部 ID、文件路径、RAG、trace 或 JSON。',
    '只根据上面真正返回的证据个性化；证据少就降低结论强度，完全不足时明确说目前还不能可靠判断并给出下一步。',
    '没有真实学习证据时，禁止声称用户“最近做过”“连续出现”“记录显示”某类题，也禁止比较具体知识点的掌握强弱。课程常识和题库存在不能代替个人学习证据。',
    '知识点讲解要回答关键因果、给一个小例子和自检；题目讲解要指出考点、推理层次、易错点和检查方法，不要只报答案。',
    'citedEvidenceIds 只写上面真实存在并实际支持回答的 ID；这些 ID 不得出现在 message。',
    '学习状态回答如果综合了 working_memory、learning_memory 和 attempt，citedEvidenceIds 必须至少各保留一条实际支撑关键结论的证据；不要只引用其中一种却声称完成了综合判断。',
    '',
    '日历规则：只有用户明确要求修改日历时才设置 calendarAction。必须从日历证据中唯一定位 targetEvidenceId。',
    '- 唯一定位且新时间明确：status=ready、operation=update，并填写新的 ISO 时间、标题和时长。',
    '- 有多个合理候选或新时间不明确：status=needs_clarification，不填写目标和修改值，并给自然追问。',
    '- 不是日历修改：status=none。',
    '不得修改未读取到的事件。calendarAction 是测试执行合同，message 仍面向普通用户自然说明结果。',
  ].join('\n');
}

function reconcileCalendarAction(args: {
  input: Input;
  evidence: UnifiedMemoryQueryEvidence[];
  generated: z.infer<typeof finalAnswerSchema>['calendarAction'];
}): UnifiedMemoryCalendarAction {
  const eventByEvidenceId = new Map<string, Input['sources']['calendar'][number]>(
    args.input.sources.calendar.map((event) => [`calendar:${event.id}`, event] as const),
  );
  const returnedEvidenceIds = new Set(
    args.evidence.filter((item) => item.sourceType === 'schedule').map((item) => item.id),
  );
  const generated = args.generated;
  if (generated.status !== 'ready') {
    return {
      status: generated.status,
      operation: null,
      targetEvidenceId: null,
      targetEventId: null,
      updatedTitle: null,
      updatedStartsAt: null,
      durationMinutes: null,
      confirmationSummary: generated.confirmationSummary,
      clarificationQuestion: generated.clarificationQuestion,
    };
  }

  const target = generated.targetEvidenceId
    ? eventByEvidenceId.get(generated.targetEvidenceId)
    : null;
  const validDate = generated.updatedStartsAt
    ? Number.isFinite(Date.parse(generated.updatedStartsAt))
    : false;
  if (
    !target ||
    !generated.targetEvidenceId ||
    !returnedEvidenceIds.has(generated.targetEvidenceId) ||
    !validDate ||
    !generated.durationMinutes
  ) {
    return {
      status: 'needs_clarification',
      operation: null,
      targetEvidenceId: null,
      targetEventId: null,
      updatedTitle: null,
      updatedStartsAt: null,
      durationMinutes: null,
      confirmationSummary: null,
      clarificationQuestion:
        '我还不能唯一确认要改哪一项，或新的时间不够明确。请补充事件名称和目标时间。',
    };
  }

  return {
    status: 'ready',
    operation: 'update',
    targetEvidenceId: generated.targetEvidenceId,
    targetEventId: target.id,
    updatedTitle: generated.updatedTitle || target.title,
    updatedStartsAt: generated.updatedStartsAt,
    durationMinutes: generated.durationMinutes,
    confirmationSummary: generated.confirmationSummary,
    clarificationQuestion: null,
  };
}

export async function POST(request: NextRequest) {
  return runWithRequestContext(
    request,
    '/api/platform-tests/memory-local-unified-query',
    () =>
      safeRoute(async () => {
        const parsed = requestSchema.safeParse(await request.json());
        if (!parsed.success) {
          return NextResponse.json(
            { error: '统一记忆查询测试请求无效。', details: parsed.error.flatten() },
            { status: 400 },
          );
        }

        const input = parsed.data;
        const bank = await loadLocalProblemBank('CSC148');
        const { model, modelString } = await resolveOpenAIResponsesModelFromHeaders(request, {
          allowOpenAIModelOverride: true,
        });
        let usage = emptyUsage();

        const plannerResult = await callLLM(
          {
            model,
            system: [
              'You are the private read-planning phase of one unified learning agent.',
              'Infer intent from ordinary language and choose only the necessary capabilities.',
              'Return a brief decision summary, never hidden chain-of-thought.',
            ].join('\n'),
            prompt: inventoryPrompt(input, bank.problemCount),
            output: Output.object({ schema: readPlanSchema }),
            maxOutputTokens: 3_000,
            maxRetries: 0,
          },
          'platform-test-unified-memory-query-plan',
        );
        usage = addUsage(usage, summarizeUsage(plannerResult.usage));
        const generatedReadPlan = plannerResult.output as ReadPlan;
        const {
          readPlan,
          rejectedCalls,
          zeroLearningEvidenceGuard,
          available: availableTools,
        } = reconcileReadPlan({
          input,
          problemCount: bank.problemCount,
          generated: generatedReadPlan,
        });

        const evidence: UnifiedMemoryQueryEvidence[] = [];
        const trace: UnifiedMemoryQueryToolTrace[] = [];
        const selectedProblemIds: string[] = [];

        for (const call of readPlan.calls as UnifiedMemoryQueryToolCall[]) {
          const startedAt = Date.now();
          const outputEvidenceIds: string[] = [];
          let error: string | null = null;
          try {
            const toolQuery = call.query || input.query;
            if (call.toolId === 'read_user_profile') {
              if (input.sources.profile.facts.length) {
                const item: UnifiedMemoryQueryEvidence = {
                  id: `profile:${input.user.id}`,
                  sourceType: 'profile',
                  title: `${input.user.name} 的稳定学习资料`,
                  excerpt: excerpt(JSON.stringify(input.sources.profile.facts), 2_400),
                  sourceId: input.user.id,
                  score: null,
                };
                evidence.push(item);
                outputEvidenceIds.push(item.id);
              }
            } else if (call.toolId === 'read_calendar') {
              const items = [...input.sources.calendar]
                .filter((item) => Number.isFinite(Date.parse(item.startsAt)))
                .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt))
                .slice(0, call.limit);
              for (const event of items) {
                const item: UnifiedMemoryQueryEvidence = {
                  id: `calendar:${event.id}`,
                  sourceType: 'schedule',
                  title: event.title,
                  excerpt: `开始 ${event.startsAt}；结束 ${event.endsAt || '未设置'}；时长 ${event.durationMinutes ?? '未知'} 分钟；时区 ${event.timezone}；状态 ${event.status}`,
                  sourceId: event.id,
                  score: null,
                };
                evidence.push(item);
                outputEvidenceIds.push(item.id);
              }
            } else if (call.toolId === 'search_working_memory') {
              if (input.sources.workingMemory) {
                const item: UnifiedMemoryQueryEvidence = {
                  id: `working:${input.user.id}`,
                  sourceType: 'working_memory',
                  title: '当前学习状态',
                  excerpt: excerpt(JSON.stringify(input.sources.workingMemory), 2_000),
                  sourceId: input.user.id,
                  score: null,
                };
                evidence.push(item);
                outputEvidenceIds.push(item.id);
              }
            } else if (call.toolId === 'search_learning_memory') {
              for (const { item: memory, score } of ranked(
                input.sources.memories.filter((item) => item.status === 'active'),
                toolQuery,
                call.limit,
                { updatedAt: (item) => item.updatedAt },
              )) {
                const item: UnifiedMemoryQueryEvidence = {
                  id: `memory:${memory.id}`,
                  sourceType: 'learning_memory',
                  title: memory.title,
                  excerpt: excerpt(memory.text),
                  sourceId: memory.id,
                  score,
                };
                evidence.push(item);
                outputEvidenceIds.push(item.id);
              }
            } else if (call.toolId === 'search_problem_attempts') {
              for (const { item: attempt, score } of ranked(
                input.sources.attempts,
                toolQuery,
                call.limit,
                { updatedAt: (item) => item.createdAt },
              )) {
                const item: UnifiedMemoryQueryEvidence = {
                  id: `attempt:${attempt.id}`,
                  sourceType: 'attempt',
                  title: `${attempt.problemTitle} · ${attempt.status}`,
                  excerpt: excerpt(
                    `知识点：${attempt.concept}；原始作答：${attempt.answerPreview || '未保存'}；得分：${attempt.score}/${attempt.maxScore ?? '未知'}；反馈：${attempt.feedback || '无诊断反馈'}`,
                  ),
                  sourceId: attempt.id,
                  score,
                };
                evidence.push(item);
                outputEvidenceIds.push(item.id);
              }
            } else if (call.toolId === 'search_notebooks') {
              for (const { item: notebook, score } of ranked(
                input.sources.notebooks,
                toolQuery,
                call.limit,
                {
                  updatedAt: (item) => item.updatedAt,
                  requireLexicalMatch: true,
                },
              )) {
                const item: UnifiedMemoryQueryEvidence = {
                  id: `notebook:${notebook.id}`,
                  sourceType: 'notebook',
                  title: notebook.title,
                  excerpt: excerpt(notebook.content, 2_000),
                  sourceId: notebook.id,
                  score,
                };
                evidence.push(item);
                outputEvidenceIds.push(item.id);
              }
            } else if (call.toolId === 'search_problem_bank') {
              const ragQuery: RagQuery = {
                query: toolQuery,
                purpose: call.reason,
                targetConcepts: queryTokens(toolQuery).slice(0, 8),
                desiredTypes: [],
                exclusions: [],
              };
              let candidates: Array<{ problem: LocalProblem; hybridScore: number }>;
              try {
                candidates = await hybridRetrieve({ bank, queries: [ragQuery], limit: call.limit });
              } catch (caught) {
                error = `语义召回不可用，已降级为本地词汇召回：${caught instanceof Error ? caught.message : String(caught)}`;
                candidates = ranked(bank.problems, toolQuery, call.limit).map((candidate) => ({
                  problem: candidate.item,
                  hybridScore: candidate.score,
                }));
              }
              for (const candidate of candidates) {
                selectedProblemIds.push(candidate.problem.id);
                const item: UnifiedMemoryQueryEvidence = {
                  id: `problem:${candidate.problem.id}`,
                  sourceType: 'problem',
                  title: candidate.problem.title,
                  excerpt: excerpt(
                    `类型/难度：${candidate.problem.type}/${candidate.problem.difficulty}；标签：${candidate.problem.tags.join('、')}；题面：${candidate.problem.question}`,
                    2_000,
                  ),
                  sourceId: candidate.problem.id,
                  score: candidate.hybridScore,
                };
                evidence.push(item);
                outputEvidenceIds.push(item.id);
              }
            }
          } catch (caught) {
            error = caught instanceof Error ? caught.message : String(caught);
          }
          trace.push({
            ...call,
            status: error && outputEvidenceIds.length === 0 ? 'failed' : 'completed',
            durationMs: Date.now() - startedAt,
            outputEvidenceIds,
            error,
          });
        }

        const uniqueEvidence = Array.from(
          new Map(evidence.map((item) => [item.id, item] as const)).values(),
        );
        let generated: FinalAnswer;
        if (zeroLearningEvidenceGuard) {
          generated = zeroLearningEvidenceAnswer();
        } else {
          const generationResult = await callLLM(
            {
              model,
              system: [
                '你是同一个统一学习 agent 的回答阶段。',
                '自然综合证据，不向用户暴露内部路由、工具、存储层或隐藏思维过程。',
                '只引用实际返回的证据；证据不足时诚实降低判断强度。',
              ].join('\n'),
              prompt: evidencePrompt({
                input,
                readPlan,
                evidence: uniqueEvidence,
                failedTools: trace.filter((item) => item.status === 'failed'),
              }),
              output: Output.object({ schema: finalAnswerSchema }),
              maxOutputTokens: 6_000,
              maxRetries: 0,
            },
            'platform-test-unified-memory-query-answer',
          );
          usage = addUsage(usage, summarizeUsage(generationResult.usage));
          generated = reconcileEvidenceState({
            input,
            readPlan,
            generated: generationResult.output as FinalAnswer,
          });
          generated = {
            ...generated,
            citedEvidenceIds: normalizeCitedEvidenceIds(generated.citedEvidenceIds, uniqueEvidence),
          };
        }
        const calendarAction = reconcileCalendarAction({
          input,
          evidence: uniqueEvidence,
          generated: generated.calendarAction,
        });

        const validEvidenceIds = new Set(uniqueEvidence.map((item) => item.id));
        const unknownEvidenceIds = generated.citedEvidenceIds.filter(
          (id) => !validEvidenceIds.has(id),
        );
        const distinctTools = new Set(readPlan.calls.map((call) => call.toolId));
        const internalMarkerPattern =
          /(?:attempt|problem|memory|calendar|notebook|fixture|working|profile)[_:][a-z0-9_-]+|evidence\s*id|\bRAG\b|trace|search_[a-z_]+|read_[a-z_]+|(?:文件|存储|数据库)路径/i;
        const noInternalMarkers = !internalMarkerPattern.test(generated.message);
        const fabricatedRecentHistoryPattern =
          /(?:根据|只根据|从)你最近(?:这批|这些|的)?(?:题|记录|作答)|你最近(?:出现了|做过|连续)|最近记录(?:显示|看)|连续一串/u;
        const zeroLearningEvidenceGrounded =
          !zeroLearningEvidenceGuard ||
          (generated.evidenceState === 'insufficient' &&
            !fabricatedRecentHistoryPattern.test(generated.message));
        const executedUnavailableTools = readPlan.calls.filter(
          (call) => !availableTools.has(call.toolId),
        );
        const calendarActionGrounded =
          calendarAction.status !== 'ready' ||
          Boolean(
            calendarAction.targetEvidenceId &&
            validEvidenceIds.has(calendarAction.targetEvidenceId) &&
            calendarAction.targetEventId &&
            calendarAction.updatedStartsAt,
          );
        const checks: UnifiedMemoryQueryResponse['machineChecks'] = [
          {
            id: 'distinct-tools',
            label: '同一种读取能力没有重复调用',
            passed: distinctTools.size === readPlan.calls.length,
            detail: readPlan.calls.map((call) => call.toolId).join(' → ') || '本轮未调用读取能力',
          },
          {
            id: 'valid-evidence',
            label: '回答只引用真实返回的证据',
            passed: unknownEvidenceIds.length === 0,
            detail: unknownEvidenceIds.length ? unknownEvidenceIds.join('、') : '全部引用有效',
          },
          {
            id: 'available-tools-only',
            label: '没有执行数量为 0 或当前请求不应使用的读取能力',
            passed: executedUnavailableTools.length === 0,
            detail: rejectedCalls.length
              ? `已在执行前拦截：${rejectedCalls.map((call) => call.toolId).join('、')}`
              : '规划中的读取能力均有真实可用来源',
          },
          {
            id: 'zero-learning-evidence-grounding',
            label: '零学习证据时不虚构近期记录或具体薄弱点',
            passed: zeroLearningEvidenceGrounded,
            detail: zeroLearningEvidenceGuard
              ? '已启用确定性证据不足回复，不生成具体知识点诊断'
              : '本轮存在个人学习证据，按实际证据生成',
          },
          {
            id: 'no-internal-routing',
            label: '用户回复不暴露内部路由、路径或 ID',
            passed: noInternalMarkers,
            detail: noInternalMarkers ? '未发现内部标识' : '用户回复含内部标识',
          },
          {
            id: 'calendar-grounding',
            label: '日历修改只作用于唯一且真实的事件',
            passed: calendarActionGrounded,
            detail:
              calendarAction.status === 'ready'
                ? calendarAction.confirmationSummary || '已形成可执行修改'
                : calendarAction.status === 'needs_clarification'
                  ? '存在歧义，未形成写操作'
                  : '本轮不修改日历',
          },
          {
            id: 'problem-bank-grounding',
            label: '题目证据只来自真实 CSC148 题库',
            passed: selectedProblemIds.every((id) => bank.problems.some((item) => item.id === id)),
            detail: `${new Set(selectedProblemIds).size} 道命中；题库共 ${bank.problemCount} 题`,
          },
        ];

        const response: UnifiedMemoryQueryResponse = {
          action: 'run_unified_memory_query',
          caseId: input.caseId,
          model: modelString,
          agent: {
            intent: readPlan.intent,
            decisionSummary: readPlan.decisionSummary,
            calls: readPlan.calls,
          },
          trace,
          evidence: uniqueEvidence,
          answer: {
            message: generated.message,
            evidenceState: generated.evidenceState,
            citedEvidenceIds: generated.citedEvidenceIds.filter((id) => validEvidenceIds.has(id)),
            calendarAction,
          },
          problemBank: {
            courseCode: 'CSC148',
            source: bank.source,
            totalCount: bank.problemCount,
            selectedProblemIds: Array.from(new Set(selectedProblemIds)),
          },
          machineChecks: checks,
          passedMachineCheck: checks.every((check) => check.passed),
          usage,
          persistence: 'none',
        };
        return NextResponse.json(response);
      }),
    {
      operationCode: 'platform_test_unified_memory_query',
      chargeReason: '第二阶段统一记忆查询测试',
    },
  );
}
