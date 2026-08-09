import type {
  LearnAction,
  LearnHooks,
  LearnProblemBankSearchResult,
  LearnRunContext,
  LearnTurnDecision,
  LearnTurnInput,
} from '../domain/types';
import { explicitPracticeTarget } from '../domain/practice-target';
import { resolveFixedReviewWorkflow } from '../../teaching-orchestrator/domain/fixed-workflows';
import { questionEvidence } from './evidence';
import { createLearnRunContext, snapshotLearnRunContext } from './run-context';
import { coerceLearnTurnDecisionOutput, createLearnTurnDecision } from './responses';
import {
  type LearnSemanticRouterOutput,
  handoffOutputToPacketArgs,
  selectedToolIdsForTrace,
} from './semantic-router';
import { learnProblemBankSearchResultSchema } from './schemas';
import { LearnTraceRecorder, compactTraceValue } from './tracing';

export type DecideTeachingTurnOptions = {
  hooks?: LearnHooks;
  runId?: string;
  currentDate?: string;
  semanticRouter?: (ctx: LearnRunContext) => Promise<LearnSemanticRouterOutput | null>;
  searchProblemBank?: (args: {
    courseId?: string;
    query: string;
    requestedCount: number;
  }) => Promise<LearnProblemBankSearchResult>;
};

const DIRECT_ANSWER_WORKFLOW_PATTERN =
  /(?:日历|calendar|日程|schedule|加入.{0,8}(?:计划|日历|日程)|(?:做|给|来|制定|创建|生成|安排|修改|删除|同步).{0,12}(?:复习|预习|学习|练习|计划|日程)|(?:找|选|推荐|生成|出|给|来|做).{0,8}(?:练习题|题目|题库|小测|quiz|practice set)|(?:临时|迷你|生成|做).{0,8}(?:小课堂|课堂|课件|幻灯|ppt|图片|图像)|(?:联网|网络|web).{0,6}(?:搜索|查询)|(?:记住|保存|写入|更新|修改|纠正)|(?:开始|打开).{0,8}(?:活动|任务)|\b(?:plan|workflow|calendar|schedule)\b|\bhow\s+should\s+i\s+(?:review|study|practice|prepare)\b|\b(?:create|make|build|design|draft|prepare|give\s+me)\b.{0,32}\b(?:review|revision|study|practice|preview)\b)/iu;
const DIRECT_ANSWER_CONTEXT_ONLY_PATTERN =
  /^(?:好|好的|可以|确认|是的|不是|继续|继续吧|然后呢|按这个|就这样|同意|取消|yes|no|ok|okay|continue|go on)[\s,.!?，。！？]*$/iu;
const DIRECT_ANSWER_LEARNER_STATE_PATTERN =
  /(?:我|学生|我的历史|学习历史).{0,14}(?:学到哪|学习进度|掌握|薄弱|弱点|错题|问过什么|学习情况|会什么|不会什么)|(?:最近|历史|过往)?.{0,8}错题.{0,16}(?:分析|总结|薄弱|弱点|原因|规律)|(?:薄弱|弱点).{0,16}(?:错题|历史|学习情况)|(?:what do i know|my progress|my weaknesses|learning status|analy[sz]e.{0,24}(?:mistakes|weaknesses)|recent mistakes)/iu;
const DIRECT_ANSWER_PROOF_PATTERN =
  /(?:证明|证法|证明思路|怎么证|如何证)|\b(?:prove|proof|proof\s+(?:idea|strategy)|demonstrate\s+that)\b/iu;
const DIRECT_ANSWER_QUESTION_PATTERN =
  /(?:讲解|解释|说明|为什么|怎么|如何|什么是|定义|证明|推导|解答|求解|分析|比较|区别|关系|原理|总结|概括|复述|explain|why|how|what is|define|prove|derive|solve|compare|summarize|walk\s*through)/iu;

/**
 * High-confidence fast path for ordinary teaching questions.
 *
 * Stateful workflows and learner-state audits keep the semantic router. Plain
 * explanations can go straight to the trusted course answerer, which already
 * performs source retrieval and emits confirmation-gated learning actions.
 */
export function shouldUseDirectCourseAnswerFastPath(
  input: Pick<LearnTurnInput, 'question' | 'courseId'>,
): boolean {
  const question = input.question.normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!input.courseId || !question || DIRECT_ANSWER_CONTEXT_ONLY_PATTERN.test(question)) {
    return false;
  }
  if (
    DIRECT_ANSWER_WORKFLOW_PATTERN.test(question) ||
    DIRECT_ANSWER_LEARNER_STATE_PATTERN.test(question) ||
    DIRECT_ANSWER_PROOF_PATTERN.test(question)
  ) {
    return false;
  }
  return DIRECT_ANSWER_QUESTION_PATTERN.test(question);
}

async function emitValidationError(
  ctx: LearnRunContext,
  message: string,
  metadata?: Record<string, unknown>,
): Promise<never> {
  await ctx.hooks?.emit?.({ type: 'validation_error', message, metadata });
  throw new Error(message);
}

function nonEmptyString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0;
}

function arrayLength(value: unknown) {
  return Array.isArray(value) ? value.length : 0;
}

function validateReviewPlanArtifact(artifact: Record<string, unknown>) {
  const hasLearningGoal = nonEmptyString(artifact.learningGoal);
  const focusPointCount = arrayLength(artifact.focusPoints);
  const selfCheckCount = arrayLength(artifact.selfChecks);

  if (!hasLearningGoal || focusPointCount < 2 || selfCheckCount < 2) {
    throw new Error(
      'AI semantic router review_plan must include learningGoal, at least two focusPoints, and at least two selfChecks.',
    );
  }
}

function isPlanArtifact(artifact: Record<string, unknown>) {
  if (artifact.kind === 'calendar_draft') {
    return Array.isArray(artifact.items) && artifact.items.length > 0;
  }
  if (artifact.kind === 'activity_plan' || artifact.kind === 'review_plan') {
    if (artifact.kind === 'review_plan') {
      validateReviewPlanArtifact(artifact);
    }
    return (
      (Array.isArray(artifact.tasks) && artifact.tasks.length > 0) ||
      (Array.isArray(artifact.calendarDraftItems) && artifact.calendarDraftItems.length > 0)
    );
  }
  return false;
}

function hasClarificationOrConfirmationAction(output: LearnSemanticRouterOutput) {
  return [...output.directCalls, ...output.proposals].some(
    (action) =>
      action.kind === 'review_mode.request_choice' ||
      action.kind === 'learner_progress.request_confirmation',
  );
}

function validateSemanticRouterOutput(output: LearnSemanticRouterOutput) {
  if (output.answerMode === 'course_answer') {
    if (!output.handoff) {
      throw new Error('AI semantic router must provide a handoff for course_answer turns.');
    }
    if (!output.handoff.requiredBehavior.length) {
      throw new Error('AI semantic router course_answer handoff must include requiredBehavior.');
    }
  }
  if (output.answerMode === 'client_activity_plan') {
    const hasPlanArtifact = output.artifacts.some(isPlanArtifact);
    if (!output.replyText.trim()) {
      throw new Error('AI semantic router client_activity_plan must include replyText.');
    }
    if (!hasPlanArtifact) {
      throw new Error('AI semantic router client_activity_plan must include a plan artifact.');
    }
  }
  if (
    output.planningDecision?.intent &&
    ['review_plan', 'preview_plan'].includes(output.planningDecision.intent) &&
    !output.artifacts.some(isPlanArtifact) &&
    !hasClarificationOrConfirmationAction(output)
  ) {
    throw new Error(
      `AI semantic router ${output.planningDecision.intent} must include a displayable plan artifact or a confirmation action.`,
    );
  }
  if (output.planningDecision?.shouldAskProgressFirst) {
    const hasProgressRequestAction = [...output.directCalls, ...output.proposals].some(
      (action) => action.kind === 'learner_progress.request_confirmation',
    );
    if (!hasProgressRequestAction) {
      throw new Error(
        'AI semantic router progress confirmation must use learner_progress.request_confirmation.',
      );
    }
  }

  const allActions = [...output.directCalls, ...output.proposals];
  const calendarAddActions = allActions.filter((action) => action.kind === 'calendar.propose_add');
  const promisesCalendarAddConfirmation =
    /(确认|同意|回复).{0,36}(添加|加入|写入).{0,24}(日历|日程)|(?:添加|加入|写入).{0,24}(日历|日程).{0,24}(确认|同意|回复)/i.test(
      output.replyText,
    );
  if (promisesCalendarAddConfirmation && calendarAddActions.length === 0) {
    throw new Error(
      'AI semantic router must emit calendar.propose_add when replyText asks the learner to confirm a calendar addition.',
    );
  }
  for (const action of calendarAddActions) {
    const payload = readRecord(action.payload);
    if (!Array.isArray(payload?.items) || payload.items.length === 0) {
      throw new Error('AI semantic router calendar.propose_add must include at least one item.');
    }
  }
}

function enforceExplicitExplanationRoute(
  input: LearnTurnInput,
  output: LearnSemanticRouterOutput,
): LearnSemanticRouterOutput {
  const question = input.question.normalize('NFKC');
  const explicitlyRequestsExplanation =
    /讲解|解释|证明思路|为什么|怎么证明|如何证明|explain|walk\s*through|proof\s*(?:idea|strategy)/i.test(
      question,
    );
  const alsoRequestsPlanning =
    /计划|安排|日程|calendar|schedule|plan|练题|刷题|做题|practice|exercise|quiz|test/i.test(
      question,
    );
  if (!explicitlyRequestsExplanation || alsoRequestsPlanning) {
    return output;
  }

  const proofRequiredBehavior = [
    'For a proof walkthrough, state the induction parameter, base case, induction hypothesis, exact smaller object, and why every invariant in the claim is preserved.',
    'Check for circular reasoning: never invoke the theorem being proved (or an equivalent representation theorem) as a premise.',
    ...(/binary representation|不同.{0,12}2.{0,8}幂|2.{0,8}幂.{0,12}不同/i.test(question)
      ? [
          'For the distinct-powers-of-2 proof, follow this exact non-circular skeleton: choose m with 2^m <= n < 2^(m+1), set r = n - 2^m, handle r = 0 directly, and for r > 0 note 0 < r < 2^m <= n so strong induction applies to r.',
          'After writing r as a sum of distinct powers, explicitly prove each power in that sum is < 2^m (otherwise the nonnegative sum would be at least 2^m > r); therefore the new 2^m term is not repeated.',
          'Do not claim that an even case is obtained by merely adding 2^1; if using an even/odd proof, explicitly shift every exponent and handle the new 2^0 term.',
        ]
      : []),
  ];
  const proofForbiddenBehavior = [
    'Do not invoke the target theorem, binary expansion, or an equivalent representation fact as a premise of its own proof.',
  ];

  if (output.answerMode === 'course_answer' && output.handoff) {
    return {
      ...output,
      handoff: {
        ...output.handoff,
        requiredBehavior: Array.from(
          new Set([...output.handoff.requiredBehavior, ...proofRequiredBehavior]),
        ),
        forbiddenBehavior: Array.from(
          new Set([...output.handoff.forbiddenBehavior, ...proofForbiddenBehavior]),
        ),
      },
      reason: [output.reason, 'Deterministic proof-quality constraints enriched the handoff.']
        .filter(Boolean)
        .join(' '),
    };
  }

  return {
    ...output,
    answerMode: 'course_answer',
    replyText: '',
    planningDecision: null,
    directCalls: [],
    proposals: [],
    artifacts: [],
    selectedToolIds: Array.from(
      new Set([
        ...output.selectedToolIds,
        'search_memory' as const,
        'search_course_materials' as const,
        'answer_course_question' as const,
      ]),
    ),
    handoff: {
      reasonSummary:
        'The learner explicitly requested an explanation or proof walkthrough, so answer in the course chat instead of creating a plan artifact.',
      requiredBehavior: [
        'Answer the requested concept, proof, or problem directly.',
        'Use course materials and retrieved source evidence when available.',
        'Explain the reasoning steps and likely misconception; do not stop at the final result.',
        ...proofRequiredBehavior,
      ],
      forbiddenBehavior: [
        'Do not turn this explanation-only request into a study plan, calendar change, or practice proposal.',
        'Do not invent source claims or problem-bank items.',
        ...proofForbiddenBehavior,
      ],
      missingEvidence: [],
    },
    reason: [
      output.reason,
      'Deterministic contract guard corrected an explicit explanation-only request to course_answer.',
    ]
      .filter(Boolean)
      .join(' '),
    confidence: Math.max(output.confidence, 0.98),
  };
}

function reviewModeLabel(mode: string) {
  if (mode === 'explain') return '听讲解';
  if (mode === 'practice') return '练题目';
  return '讲解 + 练题';
}

function reviewModeFollowupText(query: string, mode: 'explain' | 'practice' | 'both') {
  const target = query.trim();
  if (mode === 'explain') return target ? `我想听讲解：${target}` : '听讲解';
  if (mode === 'practice') return target ? `我想练题目：${target}` : '练题目';
  return target ? `我想讲解和练题都有：${target}` : '都有';
}

function buildReviewModeChoiceAction(input: LearnTurnInput) {
  const options = [
    {
      value: 'explain',
      label: reviewModeLabel('explain'),
      followupText: reviewModeFollowupText(input.question, 'explain'),
    },
    {
      value: 'practice',
      label: reviewModeLabel('practice'),
      followupText: reviewModeFollowupText(input.question, 'practice'),
    },
    {
      value: 'both',
      label: reviewModeLabel('both'),
      followupText: reviewModeFollowupText(input.question, 'both'),
    },
  ];
  return {
    kind: 'review_mode.request_choice' as const,
    label: '选择复习方式',
    summary: '你这次更想听讲解、练题，还是两者都要？',
    confirmation: 'required' as const,
    payload: {
      confirmationType: 'review_mode',
      targetText: input.question,
      options,
    },
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function payloadString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function calendarItemsFromArtifact(artifact: Record<string, unknown>) {
  if (artifact.kind === 'calendar_draft' && Array.isArray(artifact.items)) {
    return artifact.items.filter((item): item is Record<string, unknown> =>
      Boolean(readRecord(item) && payloadString(readRecord(item)?.title)),
    );
  }
  if (
    (artifact.kind === 'activity_plan' || artifact.kind === 'review_plan') &&
    Array.isArray(artifact.calendarDraftItems)
  ) {
    return artifact.calendarDraftItems.filter((item): item is Record<string, unknown> =>
      Boolean(readRecord(item) && payloadString(readRecord(item)?.title)),
    );
  }
  return [];
}

async function maybeResolvePlanCalendarFollowup(args: {
  ctx: LearnRunContext;
  recorder: LearnTraceRecorder;
  userEvidence: ReturnType<typeof questionEvidence>;
}): Promise<LearnTurnDecision | null> {
  const input = args.ctx.input;
  const isCalendarFollowup =
    /日历|calendar/i.test(input.question) &&
    /添加|加入|放到|同步|排进|安排|add|put|sync/i.test(input.question) &&
    /刚才|这份|上述|计划|活动|plan|artifact/i.test(input.question);
  if (!isCalendarFollowup) return null;

  const sourceArtifact = input.recentArtifacts
    .map(readRecord)
    .find((artifact) => artifact && calendarItemsFromArtifact(artifact).length > 0);
  if (!sourceArtifact) return null;
  const items = calendarItemsFromArtifact(sourceArtifact);
  const sourceTitle = payloadString(sourceArtifact.title) || '学习计划';
  const sourceArtifactId = payloadString(sourceArtifact.id);

  const tool = await args.recorder.toolStart({
    toolId: 'propose_calendar_change',
    purpose: 'Convert the referenced plan calendar draft into a confirmation-required proposal.',
    inputSummary: compactTraceValue({
      question: input.question,
      sourceArtifactId,
      itemCount: items.length,
    }),
  });
  await args.recorder.toolEnd(tool, {
    outputSummary: `Prepared ${items.length} calendar items from the referenced plan.`,
    evidenceIds: [args.userEvidence.id],
  });
  await args.recorder.step({
    kind: 'propose_writeback',
    label: 'Plan to calendar proposal',
    reasonSummary:
      'The learner explicitly referenced the existing plan, so reuse its calendar draft instead of asking for a new review mode.',
    evidence: [args.userEvidence],
    outputSummary: `${items.length} calendar items require confirmation before insertion.`,
    confidence: 0.99,
    metadata: { sourceArtifactId, itemCount: items.length },
  });

  return args.recorder.finish(
    createLearnTurnDecision({
      answerMode: 'action_only',
      replyText: `我已把「${sourceTitle}」整理成 ${items.length} 个日历事项；确认后才会写入学习日历。`,
      proposals: [
        {
          kind: 'calendar.propose_add',
          label: '把学习计划加入日历',
          summary: `确认后会把「${sourceTitle}」里的 ${items.length} 个活动加入学习日历。`,
          confirmation: 'required',
          payload: {
            title: sourceTitle,
            items,
            sourceArtifactId,
          },
        },
      ],
      reason:
        'Resolved an explicit plan-to-calendar follow-up from the referenced artifact; no new review-mode decision was needed.',
      confidence: 0.99,
      trace: args.recorder.trace,
    }),
  );
}

function confirmsPendingCalendarAdd(text: string) {
  const normalized = text.normalize('NFKC').replace(/\s+/g, '').trim();
  if (!normalized || normalized.length > 32) return false;
  return /^(?:请)?(?:确认(?:添加|加入|写入|执行)?|同意(?:添加|加入|写入)?|按(?:这个|上述|该方案)(?:添加|加入|执行)|就按(?:这个|上述|该方案)(?:添加|加入|执行)?)[，。.!！]?$/i.test(
    normalized,
  );
}

function latestPendingCalendarAdd(input: LearnTurnInput): LearnAction | null {
  for (const candidate of input.recentActions) {
    const action = readRecord(candidate);
    if (action?.kind !== 'calendar.propose_add') continue;
    const status = payloadString(action.status);
    if (status && status !== 'proposed' && status !== 'needs_confirmation') continue;
    const payload = readRecord(action.payload);
    if (!Array.isArray(payload?.items) || payload.items.length === 0) continue;
    const items = payload.items.filter((item) => {
      const record = readRecord(item);
      return Boolean(record && payloadString(record.title) && payloadString(record.date));
    });
    if (items.length !== payload.items.length) continue;
    return {
      kind: 'calendar.propose_add',
      label: payloadString(action.label) || '确认加入日历',
      summary: payloadString(action.summary) || '按上一轮确认的方案加入学习日历。',
      confirmation: 'required',
      payload: {
        ...payload,
        items,
      },
    };
  }
  return null;
}

async function maybeResolveConfirmedCalendarAdd(args: {
  ctx: LearnRunContext;
  recorder: LearnTraceRecorder;
  userEvidence: ReturnType<typeof questionEvidence>;
}): Promise<LearnTurnDecision | null> {
  if (!confirmsPendingCalendarAdd(args.ctx.input.question)) return null;
  const action = latestPendingCalendarAdd(args.ctx.input);
  if (!action) return null;
  const itemCount = Array.isArray(action.payload?.items) ? action.payload.items.length : 0;

  const tool = await args.recorder.toolStart({
    toolId: 'propose_calendar_change',
    purpose: 'Resolve the learner confirmation against the latest pending calendar addition.',
    inputSummary: compactTraceValue({ question: args.ctx.input.question, itemCount }),
  });
  await args.recorder.toolEnd(tool, {
    outputSummary: `Bound confirmation to ${itemCount} previously proposed calendar item(s).`,
    evidenceIds: [args.userEvidence.id],
  });
  await args.recorder.step({
    kind: 'propose_writeback',
    label: 'Confirm pending calendar addition',
    reasonSummary:
      'The learner explicitly confirmed the latest pending calendar proposal, so execute that exact payload without asking again.',
    evidence: [args.userEvidence],
    outputSummary: `${itemCount} confirmed calendar item(s) are ready for the client executor.`,
    confidence: 1,
    metadata: { itemCount },
  });

  return args.recorder.finish(
    createLearnTurnDecision({
      answerMode: 'action_only',
      replyText: '',
      directCalls: [action],
      reason: 'Executed the latest structured calendar proposal after explicit confirmation.',
      confidence: 1,
      trace: args.recorder.trace,
    }),
  );
}

function shortReviewModeReply(text: string): 'explain' | 'practice' | 'both' | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return null;
  if (/^(听)?讲解$|^解释$|^explain$/.test(normalized)) return 'explain';
  if (/^练题目?$|^做题$|^刷题$|^练习$|^practice$/.test(normalized)) return 'practice';
  if (/^都有$|^都要$|^两个都$|^讲解\s*\+\s*练题$|^both$/.test(normalized)) return 'both';
  return null;
}

function latestReviewModeTarget(input: LearnTurnInput): string {
  for (const action of input.recentActions) {
    const record = readRecord(action);
    if (record?.kind !== 'review_mode.request_choice') continue;
    const payload = readRecord(record.payload);
    const targetText = payloadString(payload?.targetText);
    if (targetText) return targetText;
  }
  return '';
}

function reviewModeChoiceQuestion(mode: 'explain' | 'practice' | 'both', targetText: string) {
  if (mode === 'explain') return `我想听讲解：${targetText}`;
  if (mode === 'practice') return `我想练题目：${targetText}`;
  return `我想讲解和练题都有：${targetText}`;
}

function resolveReviewModeChoiceInput(input: LearnTurnInput): LearnTurnInput {
  const mode = shortReviewModeReply(input.question);
  if (!mode) return input;
  const targetText = latestReviewModeTarget(input);
  if (!targetText) return input;
  return {
    ...input,
    question: reviewModeChoiceQuestion(mode, targetText),
  };
}

function normalizeProblemBankSummaryText(value: string): string {
  return value
    .toLowerCase()
    .replace(/\\forall|&forall;|∀/g, ' forall ')
    .replace(/\\exists|&exist;|&exists;|∃/g, ' exists ')
    .replace(/\s+/g, ' ')
    .trim();
}

function problemBankSampleStrings(sample: Record<string, unknown>): string[] {
  const tags = Array.isArray(sample.tags)
    ? sample.tags.map((tag) => (typeof tag === 'string' ? tag : '')).filter(Boolean)
    : [];
  return [
    typeof sample.title === 'string' ? sample.title : '',
    typeof sample.notebookName === 'string' ? sample.notebookName : '',
    ...tags,
  ].filter(Boolean);
}

function problemBankSampleId(sample: Record<string, unknown>): string {
  const id = typeof sample.id === 'string' ? sample.id : '';
  const problemId = typeof sample.problemId === 'string' ? sample.problemId : '';
  return id || problemId;
}

function problemBankSampleTitle(sample: Record<string, unknown>): string {
  return typeof sample.title === 'string' && sample.title.trim()
    ? sample.title.trim()
    : problemBankSampleId(sample) || 'Untitled problem';
}

function problemBankSampleTags(sample: Record<string, unknown>): string[] {
  return Array.isArray(sample.tags)
    ? sample.tags.map((tag) => (typeof tag === 'string' ? tag.trim() : '')).filter(Boolean)
    : [];
}

function hasTruthTableSummarySignal(text: string): boolean {
  return /truth\s*table|truthtable|truth\s*(value|values|statement|statements|assignment|assignments)|logical\s*(equivalence|statement|statements)|compound\s*(proposition|statement)|真值表|命题真值|真值判断|逻辑等价|复合命题/i.test(
    text,
  );
}

function hasQuantifierSummarySignal(text: string): boolean {
  return /forall|for\s+all|exists|there\s+exists|predicate|quantifier|全称|存在|量词|谓词|任意|并非所有|不是所有|所有.*都/i.test(
    text,
  );
}

function buildProblemBankSummarySearch(args: {
  input: LearnTurnInput;
  target: string;
  requestedCount: number;
  searchError?: string;
}): LearnProblemBankSearchResult | null {
  const samples = args.input.problemBank.samples;
  if (!samples.length && args.input.problemBank.activeCount <= 0) return null;

  const targetText = normalizeProblemBankSummaryText(args.target);
  const truthTableTarget = hasTruthTableSummarySignal(targetText);
  const quantifierTarget = hasQuantifierSummarySignal(targetText) && !truthTableTarget;
  const matches: LearnProblemBankSearchResult['matches'] = [];
  const excluded: LearnProblemBankSearchResult['excluded'] = [];

  for (const sample of samples) {
    const sampleText = normalizeProblemBankSummaryText(problemBankSampleStrings(sample).join(' '));
    const problemId = problemBankSampleId(sample);
    const title = problemBankSampleTitle(sample);
    const tags = problemBankSampleTags(sample);
    const truthSignal = hasTruthTableSummarySignal(sampleText);
    const quantifierSignal = hasQuantifierSummarySignal(sampleText);

    if (truthTableTarget) {
      if (quantifierSignal) {
        excluded.push({
          problemId,
          title,
          reason: '题库摘要含有量词/谓词信号，不能归入本轮 truth table 练习。',
          excerpt: problemBankSampleStrings(sample).join('；'),
          metadata: { source: 'request_problem_bank_snapshot' },
        });
        continue;
      }
      if (!truthSignal) {
        excluded.push({
          problemId,
          title,
          reason: '题库摘要没有明确命中 truth table / truth values 证据。',
          excerpt: problemBankSampleStrings(sample).join('；'),
          metadata: { source: 'request_problem_bank_snapshot' },
        });
        continue;
      }
    } else if (quantifierTarget) {
      if (!quantifierSignal || truthSignal) {
        excluded.push({
          problemId,
          title,
          reason: '题库摘要没有严格命中量词/谓词练习目标。',
          excerpt: problemBankSampleStrings(sample).join('；'),
          metadata: { source: 'request_problem_bank_snapshot' },
        });
        continue;
      }
    } else if (targetText && !sampleText.includes(targetText)) {
      excluded.push({
        problemId,
        title,
        reason: `题库摘要没有直接命中「${args.target}」。`,
        excerpt: problemBankSampleStrings(sample).join('；'),
        metadata: { source: 'request_problem_bank_snapshot' },
      });
      continue;
    }

    matches.push({
      problemId,
      title,
      score: truthSignal || quantifierSignal ? 72 : 52,
      reason: '从请求携带的题库摘要中保守命中；用于 local-first 课程的 server fallback。',
      excerpt: problemBankSampleStrings(sample).join('；'),
      notebookName: typeof sample.notebookName === 'string' ? sample.notebookName : null,
      tags,
      difficulty: typeof sample.difficulty === 'string' ? sample.difficulty : undefined,
      problemType: typeof sample.type === 'string' ? sample.type : undefined,
      metadata: { source: 'request_problem_bank_snapshot' },
    });
  }

  const limitedMatches = matches.slice(0, args.requestedCount);
  const gaps: string[] = [];
  if (limitedMatches.length < args.requestedCount) {
    gaps.push(
      `题库摘要严格命中「${args.target}」的题只有 ${limitedMatches.length} 道；没有为了凑数量混入相邻专题。`,
    );
  }
  if (args.searchError) {
    gaps.push(`题库全文检索未完成：${args.searchError}`);
  }
  if (samples.length < args.input.problemBank.activeCount) {
    gaps.push(
      `本次 API 请求只携带了 ${samples.length} 个题库摘要；完整 local-first 题库仍在浏览器本地。`,
    );
  }

  return {
    query: args.target,
    requestedCount: args.requestedCount,
    source: 'problem_bank_summary',
    strictTopic: truthTableTarget ? 'truth_table' : quantifierTarget ? 'quantifier' : null,
    matches: limitedMatches,
    excluded: excluded.slice(0, 8),
    rationale: [
      '题库全文检索不可用时，使用请求携带的题库摘要做保守 fallback。',
      '这个结果标记为 problem_bank_summary；它不是完整 RAG，但仍会排除明显相邻专题。',
    ],
    gaps,
    searchedAt: new Date().toISOString(),
  };
}

function semanticPracticeTarget(input: LearnTurnInput, output: LearnSemanticRouterOutput) {
  const planningDecision = output.planningDecision;
  const focusTopic = planningDecision?.focusTopics?.find((topic) => topic.trim().length > 0);
  const scopeLabel = planningDecision?.scopeResolution?.contentScope?.label?.trim();
  const explicitTarget = explicitPracticeTarget(input.question);
  const resolvedPrompt = planningDecision?.resolvedPrompt?.trim();
  return (
    focusTopic?.trim() || scopeLabel || explicitTarget || resolvedPrompt || input.question.trim()
  );
}

function problemBankIsConfirmedEmpty(input: LearnTurnInput): boolean {
  const status = input.resourceStates?.problems;
  if (status === 'empty') return true;
  if (status === 'idle' || status === 'loading' || status === 'error') return false;
  return !input.problemBank.available || input.problemBank.activeCount <= 0;
}

async function createProblemBankGapDecision(args: {
  ctx: LearnRunContext;
  recorder: LearnTraceRecorder;
  userEvidence: ReturnType<typeof questionEvidence>;
  target: string;
  requestedCount: number;
  reasonSummary: string;
  problemBankSearch?: LearnProblemBankSearchResult | null;
  searchError?: string;
}): Promise<LearnTurnDecision> {
  const input = args.ctx.input;
  await args.recorder.step({
    kind: 'select_evidence_plan',
    label: 'Problem-bank gap: no practice scheduled',
    reasonSummary: args.reasonSummary,
    evidence: [args.userEvidence],
    outputSummary: compactTraceValue({
      target: args.target,
      requestedCount: args.requestedCount,
      source: 'problem_bank',
      matchCount: args.problemBankSearch?.matches.length ?? 0,
      practiceScheduled: false,
    }),
    confidence: 0.92,
    metadata: {
      target: args.target,
      problemBankActiveCount: input.problemBank.activeCount,
      problemBankSearch: args.problemBankSearch ?? null,
    },
  });
  const decision = createLearnTurnDecision({
    answerMode: 'action_only',
    replyText: `我检查了题库，但没有找到足够严格匹配「${args.target}」且可直接打开的题目，所以这次不安排做题，也不会临时生成题目。你可以让我放宽检索范围，或先去题库查看现有题目。`,
    planningDecision: {
      intent: 'practice_plan',
      practiceMode: 'practice',
      scopeHint: 'explicit_topic',
      scopeResolution: {
        contentScope: {
          label: args.target,
          kind: 'explicit_topic',
          basis: 'user_explicit',
          eventIds: [],
          startDate: '',
          endDate: '',
          rationale:
            'The learner explicitly asked to practice this topic, but the bank-backed selection has no strict usable matches.',
          confidence: 0.9,
        },
        executionWindow: null,
        needsClarification: false,
        clarificationQuestion: '',
      },
      isFollowUpToPlan: false,
      shouldAskProgressFirst: false,
      useSyllabusAsDefaultScope: false,
      resolvedPrompt: input.question,
      focusTopics: [args.target],
      constraintsSummary:
        'Only schedule questions selected from the existing problem bank. Do not generate replacement questions when strict matches are unavailable.',
      reason: args.reasonSummary,
      confidence: 0.92,
      problemBankSearch: args.problemBankSearch ?? null,
    },
    proposals: [],
    reason: 'No strict actionable problem-bank match was available, so no practice was scheduled.',
    confidence: 0.92,
    trace: args.recorder.trace,
  });
  return args.recorder.finish(decision);
}

async function maybeResolveExplicitProblemBankPractice(args: {
  ctx: LearnRunContext;
  recorder: LearnTraceRecorder;
  userEvidence: ReturnType<typeof questionEvidence>;
  searchProblemBank?: DecideTeachingTurnOptions['searchProblemBank'];
}): Promise<LearnTurnDecision | null> {
  const input = args.ctx.input;
  const target = explicitPracticeTarget(input.question);
  if (!target) return null;
  const requestedCount = 5;

  if (problemBankIsConfirmedEmpty(input)) {
    return createProblemBankGapDecision({
      ...args,
      target,
      requestedCount: 3,
      reasonSummary:
        'The learner asked for targeted practice, but there are no active problem-bank questions. Do not generate replacements.',
    });
  }

  const tool = await args.recorder.toolStart({
    toolId: 'search_problem_bank',
    purpose: 'Retrieve bank-backed questions and problem metadata for targeted practice.',
    inputSummary: compactTraceValue({
      question: input.question,
      target,
      courseId: input.courseId,
      activeProblemCount: input.problemBank.activeCount,
      sampleCount: input.problemBank.samples.length,
      requestedCount,
    }),
    metadata: { selectedToolIds: ['search_problem_bank'] },
  });

  let problemBankSearch: LearnProblemBankSearchResult | null = null;
  let searchError = '';
  if (args.searchProblemBank) {
    try {
      problemBankSearch = await args.searchProblemBank({
        courseId: input.courseId,
        query: target,
        requestedCount,
      });
    } catch (error) {
      searchError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!problemBankSearch) {
    problemBankSearch = buildProblemBankSummarySearch({
      input,
      target,
      requestedCount,
      searchError,
    });
  }
  if (searchError && !problemBankSearch) {
    await args.recorder.toolEnd(tool, {
      status: 'failed',
      error: searchError,
      evidenceIds: [args.userEvidence.id],
      metadata: { selectedToolIds: ['search_problem_bank'] },
    });
  } else {
    await args.recorder.toolEnd(tool, {
      outputSummary: problemBankSearch
        ? `Retrieved ${problemBankSearch.matches.length} problem-bank matches for ${target}; excluded ${problemBankSearch.excluded.length}.`
        : 'No executable problem-bank search implementation was attached; client will use its local fallback.',
      evidenceIds: [args.userEvidence.id],
      metadata: {
        selectedToolIds: ['search_problem_bank'],
        resultCount: problemBankSearch?.matches.length ?? null,
        excludedCount: problemBankSearch?.excluded.length ?? null,
        gaps: problemBankSearch?.gaps ?? [],
        fallbackSource: problemBankSearch?.source === 'problem_bank_summary',
        searchError: searchError || undefined,
      },
    });
  }

  if (!problemBankSearch || problemBankSearch.matches.length === 0) {
    return createProblemBankGapDecision({
      ...args,
      target,
      requestedCount: 3,
      reasonSummary:
        'The learner asked for targeted practice, but the executed problem-bank search produced no strict usable matches. Do not generate replacements.',
      problemBankSearch,
      searchError,
    });
  }

  const problemEvidence =
    problemBankSearch?.matches.slice(0, 6).map((match, index) => ({
      id: `problem-bank-match-${index + 1}-${match.problemId}`,
      sourceType: 'problem_bank' as const,
      sourceId: match.problemId,
      title: match.title,
      quoteOrSummary: match.excerpt || match.reason,
      supports: match.reason,
      confidence: Math.max(0.45, Math.min(0.98, match.score / 100)),
      metadata: match.metadata || {},
    })) || [];

  await args.recorder.step({
    kind: 'select_evidence_plan',
    label: 'Problem-bank practice route',
    reasonSummary: problemBankSearch
      ? 'The latest learner turn explicitly asks for practice, so use executed problem-bank search results as the practice-plan evidence.'
      : 'The latest learner turn explicitly asks for practice, but no executable problem-bank search implementation was attached.',
    evidence: [args.userEvidence, ...problemEvidence],
    outputSummary: problemBankSearch
      ? compactTraceValue({
          target,
          resultCount: problemBankSearch.matches.length,
          excludedCount: problemBankSearch.excluded.length,
          gaps: problemBankSearch.gaps,
        })
      : `Select real problem-bank questions for ${target}.`,
    confidence: 0.96,
    metadata: {
      target,
      problemBankActiveCount: input.problemBank.activeCount,
      problemBankSearch,
    },
  });

  const decision = createLearnTurnDecision({
    answerMode: 'client_practice_plan',
    replyText: '',
    planningDecision: {
      intent: 'practice_plan',
      practiceMode: 'practice',
      scopeHint: 'explicit_topic',
      scopeResolution: {
        contentScope: {
          label: target,
          kind: 'explicit_topic',
          basis: 'user_explicit',
          eventIds: [],
          startDate: '',
          endDate: '',
          rationale:
            'The learner explicitly asked to practice this topic and a problem bank is available.',
          confidence: 0.96,
        },
        executionWindow: null,
        needsClarification: false,
        clarificationQuestion: '',
      },
      isFollowUpToPlan: false,
      shouldAskProgressFirst: false,
      useSyllabusAsDefaultScope: false,
      resolvedPrompt: input.question,
      focusTopics: [target],
      constraintsSummary: problemBankSearch
        ? `Use only the returned problemBankSearch.matches for ${target}; do not fill missing slots with adjacent topics.`
        : `Use real problem-bank questions for ${target}.`,
      reason: problemBankSearch
        ? 'Explicit practice request should use executed problem-bank search evidence.'
        : 'Explicit practice request should open bank-backed practice selection.',
      confidence: 0.96,
      problemBankSearch,
    },
    reason: 'Deterministically routed explicit practice request to problem-bank selection.',
    confidence: 0.96,
    trace: args.recorder.trace,
  });
  return args.recorder.finish(decision);
}

async function attachProblemBankSearchToSemanticPractice(args: {
  ctx: LearnRunContext;
  recorder: LearnTraceRecorder;
  userEvidence: ReturnType<typeof questionEvidence>;
  output: LearnSemanticRouterOutput;
  searchProblemBank?: DecideTeachingTurnOptions['searchProblemBank'];
}): Promise<LearnSemanticRouterOutput> {
  const input = args.ctx.input;
  const planningDecision = args.output.planningDecision;
  if (
    args.output.answerMode !== 'client_practice_plan' ||
    planningDecision?.intent !== 'practice_plan' ||
    planningDecision.problemBankSearch ||
    problemBankIsConfirmedEmpty(input)
  ) {
    return args.output;
  }

  const requestedCount = 5;
  const target = semanticPracticeTarget(input, args.output);
  const tool = await args.recorder.toolStart({
    toolId: 'search_problem_bank',
    purpose: 'Execute targeted problem-bank retrieval for the semantic practice plan.',
    inputSummary: compactTraceValue({
      question: input.question,
      target,
      courseId: input.courseId,
      activeProblemCount: input.problemBank.activeCount,
      requestedCount,
      routerReason: args.output.reason,
    }),
    metadata: { selectedToolIds: ['search_problem_bank'], route: 'semantic_practice_plan' },
  });

  let problemBankSearch: LearnProblemBankSearchResult | null = null;
  let searchError = '';
  if (args.searchProblemBank) {
    try {
      problemBankSearch = await args.searchProblemBank({
        courseId: input.courseId,
        query: target,
        requestedCount,
      });
    } catch (error) {
      searchError = error instanceof Error ? error.message : String(error);
    }
  }
  if (!problemBankSearch) {
    problemBankSearch = buildProblemBankSummarySearch({
      input,
      target,
      requestedCount,
      searchError,
    });
  }

  if (searchError && !problemBankSearch) {
    await args.recorder.toolEnd(tool, {
      status: 'failed',
      error: searchError,
      evidenceIds: [args.userEvidence.id],
      metadata: {
        selectedToolIds: ['search_problem_bank'],
        route: 'semantic_practice_plan',
      },
    });
    return args.output;
  }

  await args.recorder.toolEnd(tool, {
    outputSummary: problemBankSearch
      ? `Retrieved ${problemBankSearch.matches.length} problem-bank matches for ${target}; excluded ${problemBankSearch.excluded.length}.`
      : 'No executable problem-bank search implementation was attached; client will use its local fallback.',
    evidenceIds: [args.userEvidence.id],
    metadata: {
      selectedToolIds: ['search_problem_bank'],
      route: 'semantic_practice_plan',
      resultCount: problemBankSearch?.matches.length ?? null,
      excludedCount: problemBankSearch?.excluded.length ?? null,
      gaps: problemBankSearch?.gaps ?? [],
      fallbackSource: problemBankSearch?.source === 'problem_bank_summary',
      searchError: searchError || undefined,
    },
  });

  if (!problemBankSearch) return args.output;

  if (problemBankSearch.matches.length === 0) {
    const reasonSummary =
      'The semantic router selected a practice plan, but executed problem-bank search produced no strict usable matches. Do not generate replacements.';
    await args.recorder.step({
      kind: 'select_evidence_plan',
      label: 'Problem-bank gap: no practice scheduled',
      reasonSummary,
      evidence: [args.userEvidence],
      outputSummary: compactTraceValue({
        target,
        requestedCount,
        source: 'problem_bank',
        matchCount: 0,
        practiceScheduled: false,
      }),
      confidence: 0.9,
      metadata: {
        target,
        problemBankSearch,
      },
    });
    const selectedToolIds: LearnSemanticRouterOutput['selectedToolIds'] = Array.from(
      new Set<LearnSemanticRouterOutput['selectedToolIds'][number]>([
        ...args.output.selectedToolIds.filter((toolId) => toolId !== 'propose_practice_generation'),
        'search_problem_bank',
      ]),
    );
    const normalizedProblemBankSearch = learnProblemBankSearchResultSchema.parse(problemBankSearch);
    return {
      ...args.output,
      answerMode: 'action_only',
      replyText: `我检查了题库，但没有找到足够严格匹配「${target}」且可直接打开的题目，所以这次不安排做题，也不会临时生成题目。你可以让我放宽检索范围，或先去题库查看现有题目。`,
      directCalls: [],
      proposals: args.output.proposals.filter(
        (proposal) => proposal.kind !== 'practice.propose_generation',
      ),
      artifacts: [],
      selectedToolIds,
      planningDecision: {
        ...planningDecision,
        constraintsSummary:
          'Only schedule questions selected from the existing problem bank. Do not generate replacement questions when strict matches are unavailable.',
        reason: [planningDecision.reason, reasonSummary].filter(Boolean).join(' '),
        problemBankSearch: normalizedProblemBankSearch,
      },
      reason: reasonSummary,
      confidence: Math.max(0.9, args.output.confidence),
    };
  }

  const problemEvidence = problemBankSearch.matches.slice(0, 6).map((match, index) => ({
    id: `semantic-problem-bank-match-${index + 1}-${match.problemId}`,
    sourceType: 'problem_bank' as const,
    sourceId: match.problemId,
    title: match.title,
    quoteOrSummary: match.excerpt || match.reason,
    supports: match.reason,
    confidence: Math.max(0.45, Math.min(0.98, match.score / 100)),
    metadata: match.metadata || {},
  }));

  await args.recorder.step({
    kind: 'select_evidence_plan',
    label: 'Attach problem-bank retrieval to practice plan',
    reasonSummary:
      'The AI router selected a practice plan, so the platform executed problem-bank search before the client selects questions.',
    evidence: [args.userEvidence, ...problemEvidence],
    outputSummary: compactTraceValue({
      target,
      resultCount: problemBankSearch.matches.length,
      excludedCount: problemBankSearch.excluded.length,
      gaps: problemBankSearch.gaps,
    }),
    confidence: 0.94,
    metadata: {
      target,
      problemBankSearch,
    },
  });

  const selectedToolIds: LearnSemanticRouterOutput['selectedToolIds'] = Array.from(
    new Set<LearnSemanticRouterOutput['selectedToolIds'][number]>([
      ...args.output.selectedToolIds,
      'search_problem_bank',
    ]),
  );
  const normalizedProblemBankSearch = learnProblemBankSearchResultSchema.parse(problemBankSearch);
  return {
    ...args.output,
    selectedToolIds,
    planningDecision: {
      ...planningDecision,
      constraintsSummary: `Use only the returned problemBankSearch.matches for ${target}; do not fill missing slots with adjacent topics.`,
      reason: [
        planningDecision.reason,
        'Problem-bank question selection was resolved by executed search evidence.',
      ]
        .filter(Boolean)
        .join(' '),
      problemBankSearch: normalizedProblemBankSearch,
    },
  };
}

async function maybeResolveFixedReviewWorkflow(args: {
  ctx: LearnRunContext;
  recorder: LearnTraceRecorder;
  userEvidence: ReturnType<typeof questionEvidence>;
}): Promise<LearnTurnDecision | null> {
  const input = args.ctx.input;
  const workflow = resolveFixedReviewWorkflow({ query: input.question });
  if (workflow.workflowId !== 'review_mode_clarification') return null;

  const tool = await args.recorder.toolStart({
    toolId: 'resolve_fixed_review_workflow',
    purpose: 'Apply fixed review workflow before the AI router.',
    inputSummary: compactTraceValue({
      question: input.question,
      workflowId: workflow.workflowId,
      targetKind: workflow.targetKind,
      mode: workflow.mode,
    }),
  });
  await args.recorder.toolEnd(tool, {
    outputSummary: 'Review target is present but review mode is missing.',
    evidenceIds: [args.userEvidence.id],
    metadata: {
      selectedToolIds: ['resolve_fixed_review_workflow'],
      workflowId: workflow.workflowId,
      requiredEvidence: workflow.requiredEvidence,
    },
  });

  await args.recorder.step({
    kind: 'select_evidence_plan',
    label: 'Fixed review workflow',
    reasonSummary:
      'The learner named a review target but did not choose explanation, practice, or both, so the fixed workflow pauses for a mode choice.',
    evidence: [args.userEvidence],
    outputSummary: workflow.clarificationQuestion || 'Ask learner to choose review mode.',
    confidence: 0.95,
    metadata: {
      workflowId: workflow.workflowId,
      targetKind: workflow.targetKind,
      mode: workflow.mode,
    },
  });

  const decision = createLearnTurnDecision({
    answerMode: 'action_only',
    replyText: workflow.clarificationQuestion || '你这次更想听讲解、练题，还是两者都要？',
    planningDecision: {
      intent: 'review_plan',
      scopeHint: 'explicit_topic',
      scopeResolution: {
        contentScope: {
          label: input.question,
          kind: 'explicit_topic',
          basis: 'user_explicit',
          eventIds: [],
          startDate: '',
          endDate: '',
          rationale: 'The learner named a review target, but the review mode is missing.',
          confidence: 0.85,
        },
        executionWindow: null,
        needsClarification: true,
        clarificationQuestion:
          workflow.clarificationQuestion || '你这次更想听讲解、练题，还是两者都要？',
      },
      isFollowUpToPlan: false,
      shouldAskProgressFirst: false,
      useSyllabusAsDefaultScope: false,
      resolvedPrompt: input.question,
      focusTopics: [input.question],
      constraintsSummary: 'Awaiting review mode: explanation, practice, or both.',
      reason: 'Fixed review workflow requires an explicit review mode before planning.',
      confidence: 0.9,
    },
    proposals: [buildReviewModeChoiceAction(input)],
    reason: 'Fixed review workflow paused to ask for review mode before planning.',
    confidence: 0.95,
    trace: args.recorder.trace,
  });
  return args.recorder.finish(decision);
}

async function routeWithSemanticRouter(
  ctx: LearnRunContext,
  recorder: LearnTraceRecorder,
  semanticRouter?: DecideTeachingTurnOptions['semanticRouter'],
  searchProblemBank?: DecideTeachingTurnOptions['searchProblemBank'],
): Promise<LearnTurnDecision> {
  const input = ctx.input;
  const userEvidence = questionEvidence(input, 'latest learner request');

  await recorder.step({
    kind: 'observe_input',
    label: 'Observe learner turn',
    reasonSummary: 'Captured the current question and available platform context.',
    evidence: [userEvidence],
    metadata: {
      courseId: input.courseId,
      hasSyllabus: input.hasSyllabus,
      problemBankActiveCount: input.problemBank.activeCount,
      sourceUploadCount: input.sourceUploads.length,
      recentActivityCount: input.recentActivities.length,
    },
  });

  const reviewModeResolvedInput = resolveReviewModeChoiceInput(input);
  const reviewModeResolvedCtx =
    reviewModeResolvedInput === input
      ? ctx
      : {
          ...ctx,
          input: reviewModeResolvedInput,
        };

  const confirmedCalendarDecision = await maybeResolveConfirmedCalendarAdd({
    ctx: reviewModeResolvedCtx,
    recorder,
    userEvidence,
  });
  if (confirmedCalendarDecision) return confirmedCalendarDecision;

  const planCalendarDecision = await maybeResolvePlanCalendarFollowup({
    ctx: reviewModeResolvedCtx,
    recorder,
    userEvidence,
  });
  if (planCalendarDecision) return planCalendarDecision;

  const explicitPracticeDecision = await maybeResolveExplicitProblemBankPractice({
    ctx: reviewModeResolvedCtx,
    recorder,
    userEvidence,
    searchProblemBank,
  });
  if (explicitPracticeDecision) return explicitPracticeDecision;

  const fixedWorkflowDecision = await maybeResolveFixedReviewWorkflow({
    ctx,
    recorder,
    userEvidence,
  });
  if (fixedWorkflowDecision) return fixedWorkflowDecision;

  if (shouldUseDirectCourseAnswerFastPath(reviewModeResolvedInput)) {
    const tool = await recorder.toolStart({
      toolId: 'answer_course_question',
      purpose: 'Route a high-confidence teaching question directly to the course answerer.',
      inputSummary: compactTraceValue({
        question: reviewModeResolvedInput.question,
        courseId: reviewModeResolvedInput.courseId,
      }),
    });
    await recorder.toolEnd(tool, {
      outputSummary: 'Skipped semantic workflow planning for an ordinary course answer.',
      evidenceIds: [userEvidence.id],
      metadata: {
        selectedToolIds: ['search_memory', 'search_course_materials', 'answer_course_question'],
        routingMode: 'deterministic_direct_answer',
      },
    });
    await recorder.step({
      kind: 'model_routing',
      label: 'Direct course answer',
      reasonSummary:
        'The learner asked an ordinary teaching question with no planning or mutation workflow.',
      evidence: [userEvidence],
      outputSummary:
        'Continue to the trusted course answerer without a semantic-router model call.',
      confidence: 0.99,
      metadata: {
        selectedToolIds: ['search_memory', 'search_course_materials', 'answer_course_question'],
        routingMode: 'deterministic_direct_answer',
      },
    });
    await recorder.handoff({
      from: 'learn_core',
      to: 'course_answerer',
      intent: 'course_answer',
      reasonSummary:
        'This is a direct teaching question; answer from trusted course evidence and memory.',
      evidence: [userEvidence],
      requiredBehavior: [
        'Answer the learner question directly.',
        'Use trusted course materials and retrieved evidence when available.',
        'Explain reasoning, one useful example or check, and a likely misconception when relevant.',
      ],
      forbiddenBehavior: [
        'Do not turn an ordinary explanation into a calendar, plan, practice, classroom, image, or memory-write workflow unless the learner explicitly asks.',
        'Do not invent course-source claims or problem-bank items.',
      ],
      missingEvidence: [],
      resourceStates: reviewModeResolvedInput.resourceStates,
    });
    const decision = createLearnTurnDecision({
      answerMode: 'course_answer',
      reason: 'High-confidence ordinary teaching question routed directly to the course answerer.',
      confidence: 0.99,
      trace: recorder.trace,
    });
    return recorder.finish(decision);
  }

  const semanticRouterInput = reviewModeResolvedInput;
  const semanticRouterCtx =
    semanticRouterInput === input
      ? ctx
      : {
          ...ctx,
          input: semanticRouterInput,
        };

  const tool = await recorder.toolStart({
    toolId: 'semantic_router',
    purpose: 'Choose the next typed learning route with the AI semantic router.',
    inputSummary: compactTraceValue(
      {
        question: semanticRouterInput.question,
        originalQuestion: input.question,
        courseId: semanticRouterInput.courseId,
        courseCode: semanticRouterInput.courseCode,
        currentDate: ctx.currentDate,
      },
      900,
    ),
  });

  if (!semanticRouter) {
    await recorder.toolEnd(tool, {
      status: 'failed',
      error: 'AI semantic router is not configured.',
    });
    return emitValidationError(ctx, 'AI semantic router is not configured.');
  }

  let output: LearnSemanticRouterOutput | null = null;
  try {
    output = await semanticRouter(semanticRouterCtx);
    if (!output) {
      throw new Error('AI semantic router returned no decision.');
    }
    output = enforceExplicitExplanationRoute(semanticRouterInput, output);
    validateSemanticRouterOutput(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[learn-core] AI semantic router invalid decision:', message);
    await recorder.toolEnd(tool, {
      status: 'failed',
      error: message,
    });
    return emitValidationError(
      ctx,
      `AI semantic router failed to produce a valid decision: ${message}`,
      {
        error: message,
      },
    );
  }

  const selectedToolIds = selectedToolIdsForTrace(output);
  await recorder.toolEnd(tool, {
    outputSummary: `${output.answerMode} selected by AI semantic router.`,
    evidenceIds: [userEvidence.id],
    metadata: { selectedToolIds },
  });

  await recorder.step({
    kind: 'model_routing',
    label: 'AI semantic routing',
    reasonSummary: output.reason || 'AI semantic router returned a structured route.',
    evidence: [userEvidence],
    outputSummary: compactTraceValue(
      {
        answerMode: output.answerMode,
        selectedToolIds,
        planningIntent: output.planningDecision?.intent,
        directCalls: output.directCalls.map((action) => action.kind),
        proposals: output.proposals.map((action) => action.kind),
      },
      900,
    ),
    confidence: output.confidence,
    metadata: {
      selectedToolIds,
      hasHandoff: Boolean(output.handoff),
    },
  });

  output = await attachProblemBankSearchToSemanticPractice({
    ctx: semanticRouterCtx,
    recorder,
    userEvidence,
    output,
    searchProblemBank,
  });

  if (output.answerMode === 'course_answer') {
    const handoffArgs = handoffOutputToPacketArgs({
      output,
      evidence: [userEvidence],
      resourceStates: ctx.input.resourceStates,
    });
    if (!handoffArgs) {
      return emitValidationError(ctx, 'AI semantic router omitted a course_answer handoff.');
    }
    await recorder.handoff(handoffArgs);
  }

  const decision = coerceLearnTurnDecisionOutput(output, recorder.trace);
  return recorder.finish(decision);
}

export async function decideTeachingTurn(
  input: LearnTurnInput,
  options: DecideTeachingTurnOptions = {},
): Promise<LearnTurnDecision> {
  const ctx = createLearnRunContext({
    input,
    runId: options.runId,
    currentDate: options.currentDate,
    hooks: options.hooks,
  });
  await ctx.hooks?.emit?.({ type: 'turn_start', context: snapshotLearnRunContext(ctx) });

  const recorder = new LearnTraceRecorder(ctx);
  return routeWithSemanticRouter(ctx, recorder, options.semanticRouter, options.searchProblemBank);
}

export function learnTurnDecisionToResponse(decision: LearnTurnDecision) {
  return {
    answerMode: decision.answerMode,
    replyText: decision.replyText,
    planningDecision: decision.planningDecision,
    directCalls: decision.directCalls,
    proposals: decision.proposals,
    artifacts: decision.artifacts,
    reason: decision.reason,
    confidence: decision.confidence,
    trace: decision.trace,
  };
}
