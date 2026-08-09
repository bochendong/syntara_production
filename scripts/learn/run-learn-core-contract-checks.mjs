#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const ROOT = process.cwd();
const DEFAULT_OUT_ROOT = path.join(ROOT, 'tmp', 'learn-core-contract-checks');

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseArgs(argv) {
  const options = { outDir: '' };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg.startsWith('--out=')) {
      options.outDir = path.resolve(ROOT, arg.slice('--out='.length));
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  options.outDir ||= path.join(DEFAULT_OUT_ROOT, timestampSlug());
  return options;
}

function printHelp() {
  console.log(`Usage:
  pnpm test:learn-core-contracts
  pnpm test:learn-core-contracts -- --out=tmp/learn-core-contract-checks/current

Directly exercises the AI-first learn-core decision chain without HTTP or LLM
calls. Checks hook emission, trace invariants, tool contracts, handoff packets,
structured actions, and that missing AI routing fails loudly instead of using a
hardcoded route.
`);
}

function installTypeScriptRequireHook() {
  const require = createRequire(import.meta.url);
  const ts = require('typescript');
  const previous = require.extensions['.ts'];
  require.extensions['.ts'] = function transpileTs(module, filename) {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
      fileName: filename,
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        moduleResolution: ts.ModuleResolutionKind.Node10,
        jsx: ts.JsxEmit.ReactJSX,
      },
    });
    module._compile(output.outputText, filename);
  };
  return { require, restore: () => (require.extensions['.ts'] = previous) };
}

function calendarFixture() {
  return [
    {
      id: 'contract-syllabus-1',
      title: '1.1 - Approximating Areas',
      kind: 'progress',
      date: '2026-05-04',
      origin: 'syllabus',
    },
    {
      id: 'contract-syllabus-2',
      title: '3.7 - Improper integrals',
      kind: 'progress',
      date: '2026-06-10',
      origin: 'syllabus',
    },
  ];
}

function validateCalendarBulkDeleteContract(require) {
  const failures = [];
  const { applyLearningCalendarDelete } = require(
    path.join(ROOT, 'features', 'learn-core', 'client-calendar-actions.ts'),
  );
  const events = [
    {
      id: 'calendar-bulk-1',
      title: '归纳法复习',
      kind: 'progress',
      date: '2026-07-25',
      sourceName: 'API contract test',
      createdAt: 1,
      origin: 'manual',
    },
    {
      id: 'calendar-bulk-2',
      title: '集合论作业',
      kind: 'assignment',
      date: '2026-07-26',
      sourceName: 'API contract test',
      createdAt: 2,
      origin: 'manual',
    },
    {
      id: 'calendar-bulk-3',
      title: 'MAT102 模拟测验',
      kind: 'exam',
      date: '2026-07-29',
      sourceName: 'API contract test',
      createdAt: 3,
      origin: 'manual',
    },
  ];
  const result = applyLearningCalendarDelete({
    events,
    action: {
      id: 'calendar-bulk-delete',
      kind: 'calendar.propose_delete',
      label: '清空模拟日历',
      payload: {
        eventIds: events.map((event) => event.id),
        requiresConfirmation: true,
      },
      confirmation: 'required',
    },
  });
  if (!result) {
    failures.push('eventIds bulk delete must resolve to an executable result');
  } else {
    if (result.events.length !== 0) {
      failures.push(`eventIds bulk delete must clear all events, got ${result.events.length}`);
    }
    if (result.deletedEvents.length !== events.length) {
      failures.push(
        `eventIds bulk delete must report ${events.length} deleted events, got ${result.deletedEvents.length}`,
      );
    }
  }

  const ambiguous = applyLearningCalendarDelete({
    events: [
      { ...events[0], id: 'calendar-ambiguous-1', title: 'MAT102 复习一' },
      { ...events[1], id: 'calendar-ambiguous-2', title: 'MAT102 复习二' },
    ],
    action: {
      id: 'calendar-ambiguous-delete',
      kind: 'calendar.propose_delete',
      label: '删除 MAT102',
      payload: { targets: ['MAT102'], requiresConfirmation: true },
      confirmation: 'required',
    },
  });
  if (ambiguous !== null) {
    failures.push('one ambiguous text target must not delete multiple calendar events');
  }
  return { id: 'calendar-event-ids-bulk-delete', failures };
}

function validateStreamingMathComparisonContract(require) {
  const failures = [];
  const { stripStreamingBlockquoteMarkers } = require(
    path.join(ROOT, 'lib', 'orchestration', 'text-delta-normalization.ts'),
  );
  const splitComparison = stripStreamingBlockquoteMarkers('>0$ 时应用归纳假设', '若 $r');
  if (splitComparison !== '>0$ 时应用归纳假设') {
    failures.push(`split math comparison must preserve >, got ${JSON.stringify(splitComparison)}`);
  }
  const initialBlockquote = stripStreamingBlockquoteMarkers('> 引用内容', '');
  if (initialBlockquote !== '引用内容') {
    failures.push(
      `initial blockquote marker should be stripped, got ${JSON.stringify(initialBlockquote)}`,
    );
  }
  const newlineBlockquote = stripStreamingBlockquoteMarkers('上一行\n> 引用内容', '前文');
  if (newlineBlockquote !== '上一行\n引用内容') {
    failures.push(
      `newline blockquote marker should be stripped, got ${JSON.stringify(newlineBlockquote)}`,
    );
  }
  return { id: 'streaming-math-comparison-preserved', failures };
}

function baseInput(question, overrides = {}) {
  return {
    question,
    recentMessages: [],
    attachments: [],
    courseId: 'mat136-local-fixture',
    courseName: 'Calculus II',
    courseCode: 'MAT 136',
    hasSyllabus: true,
    progressKnown: false,
    learnerSnapshot: { progressKnown: false, weakConcepts: [], nextConcepts: [] },
    calendarEvents: calendarFixture(),
    recentPlans: [],
    recentArtifacts: [],
    recentActions: [],
    recentActivities: [],
    problemBank: { available: false, activeCount: 0, samples: [] },
    sourceUploads: [],
    layeredMemorySummary: '',
    ...overrides,
  };
}

function asArray(value) {
  if (Array.isArray(value)) return value;
  return value == null ? [] : [value];
}

function actionKinds(decision, key) {
  return asArray(decision?.[key])
    .map((action) => (action && typeof action === 'object' ? action.kind : null))
    .filter(Boolean);
}

function artifactKinds(decision) {
  return asArray(decision?.artifacts)
    .map((artifact) => (artifact && typeof artifact === 'object' ? artifact.kind : null))
    .filter(Boolean);
}

function traceToolIds(decision) {
  return asArray(decision?.trace?.toolCalls)
    .map((call) => (call && typeof call === 'object' ? call.toolId : null))
    .filter(Boolean);
}

function traceSelectedToolIds(decision) {
  const selected = [];
  for (const call of asArray(decision?.trace?.toolCalls)) {
    selected.push(...asArray(call?.metadata?.selectedToolIds));
  }
  return selected.filter(Boolean);
}

function reviewModeFollowups(decision) {
  const followups = [];
  for (const action of asArray(decision?.proposals)) {
    if (action?.kind !== 'review_mode.request_choice') continue;
    for (const option of asArray(action?.payload?.options)) {
      if (option?.followupText) followups.push(String(option.followupText));
    }
  }
  return followups;
}

function traceStepKinds(decision) {
  return asArray(decision?.trace?.steps)
    .map((step) => (step && typeof step === 'object' ? step.kind : null))
    .filter(Boolean);
}

function traceHandoffTargets(decision) {
  return asArray(decision?.trace?.handoffs)
    .map((handoff) => (handoff && typeof handoff === 'object' ? handoff.to : null))
    .filter(Boolean);
}

function hasAll(actual, expected) {
  const set = new Set(actual);
  return asArray(expected).every((item) => set.has(item));
}

function hasNone(actual, forbidden) {
  const set = new Set(actual);
  return asArray(forbidden).every((item) => !set.has(item));
}

function collectEvidenceIds(trace) {
  const ids = new Set();
  for (const step of asArray(trace?.steps)) {
    for (const item of asArray(step?.evidence)) {
      if (item?.id) ids.add(item.id);
    }
  }
  for (const handoff of asArray(trace?.handoffs)) {
    for (const item of asArray(handoff?.evidence)) {
      if (item?.id) ids.add(item.id);
    }
  }
  return ids;
}

const REQUIRED_CONFIRMATION_ACTIONS = new Set([
  'calendar.propose_add',
  'calendar.propose_update',
  'calendar.propose_delete',
  'memory.propose_write',
  'review_mode.request_choice',
  'practice.propose_generation',
  'classroom.propose_temporary_explanation',
  'image.propose_generation',
]);

function routeOutput(overrides = {}) {
  return {
    answerMode: 'course_answer',
    replyText: '',
    planningDecision: null,
    directCalls: [],
    proposals: [],
    artifacts: [],
    selectedToolIds: ['semantic_router'],
    handoff: null,
    reason: 'AI semantic router fixture decision.',
    confidence: 0.9,
    ...overrides,
  };
}

function answerHandoff(reasonSummary, requiredBehavior = []) {
  return {
    reasonSummary,
    requiredBehavior: requiredBehavior.length
      ? requiredBehavior
      : ['Answer with course evidence and state any missing personalization evidence.'],
    forbiddenBehavior: ['Do not claim calendar, memory, or generation writes happened.'],
    missingEvidence: [],
  };
}

function explicitTopicPlan(topic) {
  return {
    intent: 'review_plan',
    practiceMode: null,
    scopeHint: 'explicit_topic',
    scopeResolution: {
      contentScope: {
        label: topic,
        kind: 'explicit_topic',
        basis: 'user_explicit',
        eventIds: [],
        startDate: '',
        endDate: '',
        rationale: 'The learner explicitly named the review topic.',
        confidence: 0.96,
      },
      executionWindow: {
        startDate: '2026-06-28',
        days: 1,
        minutesPerDay: 45,
        rationale: 'Draft a useful immediate review activity.',
      },
      needsClarification: false,
      clarificationQuestion: '',
    },
    isFollowUpToPlan: false,
    shouldAskProgressFirst: false,
    useSyllabusAsDefaultScope: false,
    resolvedPrompt: `安排一次 ${topic} 复习`,
    focusTopics: [topic],
    constraintsSummary: `显式复习主题：${topic}`,
    reason: 'Explicit topic review can be planned without progress confirmation.',
    confidence: 0.94,
  };
}

function validateDecision({ id, decision, events, expect, getLearnCoreTool }) {
  const failures = [];
  const trace = decision.trace || {};
  const toolIds = traceToolIds(decision);
  const selectedToolIds = traceSelectedToolIds(decision);
  const stepKinds = traceStepKinds(decision);
  const handoffTargets = traceHandoffTargets(decision);

  if (decision.answerMode !== expect.answerMode) {
    failures.push(`expected answerMode ${expect.answerMode}, got ${decision.answerMode}`);
  }
  if (!trace.runId || !trace.startedAt || !trace.endedAt) {
    failures.push('trace must include runId, startedAt, and endedAt');
  }
  if (!events.length || events[0].type !== 'turn_start') {
    failures.push('first hook event must be turn_start');
  }
  if (!events.length || events[events.length - 1].type !== 'turn_end') {
    failures.push('last hook event must be turn_end');
  }
  const startContext = events.find((event) => event.type === 'turn_start')?.context;
  if (!startContext?.currentDate) failures.push('turn_start hook must include run context date');
  if (!hasAll(asArray(startContext?.enabledToolIds), ['semantic_router'])) {
    failures.push('enabled tool ids must include semantic_router');
  }

  if (!hasAll(toolIds, expect.toolsInclude)) {
    failures.push(
      `missing trace tools ${JSON.stringify(expect.toolsInclude)}, got ${JSON.stringify(toolIds)}`,
    );
  }
  if (!hasNone(toolIds, ['legacy_semantic_planner'])) {
    failures.push('trace must not include legacy_semantic_planner');
  }
  if (!hasAll(selectedToolIds, expect.selectedToolsInclude)) {
    failures.push(
      `missing selected tools ${JSON.stringify(expect.selectedToolsInclude)}, got ${JSON.stringify(selectedToolIds)}`,
    );
  }
  if (!hasAll(stepKinds, expect.stepsInclude)) {
    failures.push(
      `missing trace steps ${JSON.stringify(expect.stepsInclude)}, got ${JSON.stringify(stepKinds)}`,
    );
  }
  if (!hasNone(stepKinds, ['fallback'])) failures.push('trace must not include fallback step');
  if (!hasAll(handoffTargets, expect.handoffsTo)) {
    failures.push(
      `missing handoff targets ${JSON.stringify(expect.handoffsTo)}, got ${JSON.stringify(handoffTargets)}`,
    );
  }
  const handoffRequiredBehaviorText = asArray(trace.handoffs)
    .flatMap((handoff) => asArray(handoff?.requiredBehavior))
    .map((item) => String(item || ''))
    .join('\n');
  for (const requiredHandoffText of asArray(expect.handoffRequiredBehaviorIncludes)) {
    if (!handoffRequiredBehaviorText.includes(requiredHandoffText)) {
      failures.push(`handoff requiredBehavior must include ${requiredHandoffText}`);
    }
  }
  if (!hasAll(actionKinds(decision, 'directCalls'), expect.directCallsInclude)) {
    failures.push(
      `missing direct calls ${JSON.stringify(expect.directCallsInclude)}, got ${JSON.stringify(actionKinds(decision, 'directCalls'))}`,
    );
  }
  if (!hasAll(actionKinds(decision, 'proposals'), expect.proposalsInclude)) {
    failures.push(
      `missing proposals ${JSON.stringify(expect.proposalsInclude)}, got ${JSON.stringify(actionKinds(decision, 'proposals'))}`,
    );
  }
  if (!hasNone(actionKinds(decision, 'proposals'), expect.proposalsExclude)) {
    failures.push(
      `forbidden proposals ${JSON.stringify(expect.proposalsExclude)}, got ${JSON.stringify(actionKinds(decision, 'proposals'))}`,
    );
  }
  for (const requiredText of asArray(expect.replyTextIncludes)) {
    if (!String(decision.replyText || '').includes(requiredText)) {
      failures.push(`replyText must include ${requiredText}`);
    }
  }
  if (!hasAll(artifactKinds(decision), expect.artifactsInclude)) {
    failures.push(
      `missing artifacts ${JSON.stringify(expect.artifactsInclude)}, got ${JSON.stringify(artifactKinds(decision))}`,
    );
  }
  if (!hasNone(artifactKinds(decision), expect.artifactsExclude)) {
    failures.push(
      `forbidden artifacts ${JSON.stringify(expect.artifactsExclude)}, got ${JSON.stringify(artifactKinds(decision))}`,
    );
  }
  if (expect.planningIntent && decision.planningDecision?.intent !== expect.planningIntent) {
    failures.push(
      `expected planning intent ${expect.planningIntent}, got ${decision.planningDecision?.intent}`,
    );
  }
  if (expect.scopeHint && decision.planningDecision?.scopeHint !== expect.scopeHint) {
    failures.push(
      `expected planning scopeHint ${expect.scopeHint}, got ${decision.planningDecision?.scopeHint}`,
    );
  }
  if (
    expect.resolvedPrompt &&
    String(decision.planningDecision?.resolvedPrompt || '') !== expect.resolvedPrompt
  ) {
    failures.push(
      `expected resolvedPrompt ${expect.resolvedPrompt}, got ${decision.planningDecision?.resolvedPrompt}`,
    );
  }
  if (
    expect.shouldAskProgressFirst != null &&
    decision.planningDecision?.shouldAskProgressFirst !== expect.shouldAskProgressFirst
  ) {
    failures.push(
      `expected shouldAskProgressFirst ${expect.shouldAskProgressFirst}, got ${decision.planningDecision?.shouldAskProgressFirst}`,
    );
  }
  if (!hasAll(asArray(decision.planningDecision?.focusTopics), expect.focusTopicsInclude)) {
    failures.push(
      `missing focus topics ${JSON.stringify(expect.focusTopicsInclude)}, got ${JSON.stringify(asArray(decision.planningDecision?.focusTopics))}`,
    );
  }
  if (expect.problemBankSearchMatchIdsInclude?.length) {
    const matchIds = asArray(decision.planningDecision?.problemBankSearch?.matches).map((match) =>
      String(match?.problemId || ''),
    );
    if (!hasAll(matchIds, expect.problemBankSearchMatchIdsInclude)) {
      failures.push(
        `missing problem bank search matches ${JSON.stringify(expect.problemBankSearchMatchIdsInclude)}, got ${JSON.stringify(matchIds)}`,
      );
    }
  }
  if (expect.problemBankSearchExcludedTitlesInclude?.length) {
    const excludedTitles = asArray(decision.planningDecision?.problemBankSearch?.excluded).map(
      (candidate) => String(candidate?.title || ''),
    );
    if (!hasAll(excludedTitles, expect.problemBankSearchExcludedTitlesInclude)) {
      failures.push(
        `missing problem bank excluded candidates ${JSON.stringify(expect.problemBankSearchExcludedTitlesInclude)}, got ${JSON.stringify(excludedTitles)}`,
      );
    }
  }
  if (expect.practiceGenerationSource) {
    const practiceGenerationActions = [
      ...asArray(decision.proposals),
      ...asArray(decision.directCalls),
    ].filter((action) => action?.kind === 'practice.propose_generation');
    const sources = practiceGenerationActions.map((action) =>
      String(action?.payload?.source || ''),
    );
    if (!sources.includes(expect.practiceGenerationSource)) {
      failures.push(
        `expected practice generation source ${expect.practiceGenerationSource}, got ${JSON.stringify(sources)}`,
      );
    }
  }
  if (expect.practiceGenerationPersistToProblemBank != null) {
    const practiceGenerationActions = [
      ...asArray(decision.proposals),
      ...asArray(decision.directCalls),
    ].filter((action) => action?.kind === 'practice.propose_generation');
    const hasPersist = practiceGenerationActions.some(
      (action) =>
        action?.payload?.persistToProblemBank === expect.practiceGenerationPersistToProblemBank,
    );
    if (!hasPersist) {
      failures.push(
        `expected practice generation persistToProblemBank ${expect.practiceGenerationPersistToProblemBank}`,
      );
    }
  }
  if (!hasAll(reviewModeFollowups(decision), expect.reviewModeFollowupsInclude)) {
    failures.push(
      `missing review mode followups ${JSON.stringify(expect.reviewModeFollowupsInclude)}, got ${JSON.stringify(reviewModeFollowups(decision))}`,
    );
  }

  const evidenceIds = collectEvidenceIds(trace);
  for (const tool of asArray(trace.toolCalls)) {
    if (!getLearnCoreTool(tool.toolId)) failures.push(`tool ${tool.toolId} has no contract`);
    if (tool.status === 'started') failures.push(`tool ${tool.toolId} did not finish`);
    if (!tool.endedAt) failures.push(`tool ${tool.toolId} is missing endedAt`);
    for (const evidenceId of asArray(tool.evidenceIds)) {
      if (!evidenceIds.has(evidenceId)) {
        failures.push(`tool ${tool.toolId} references unknown evidence ${evidenceId}`);
      }
    }
  }

  const toolStartCount = events.filter((event) => event.type === 'tool_start').length;
  const toolEndCount = events.filter((event) => event.type === 'tool_end').length;
  if (toolStartCount !== asArray(trace.toolCalls).length) {
    failures.push(`tool_start hook count ${toolStartCount} does not match trace tool count`);
  }
  if (toolEndCount !== asArray(trace.toolCalls).length) {
    failures.push(`tool_end hook count ${toolEndCount} does not match trace tool count`);
  }
  const handoffHookCount = events.filter((event) => event.type === 'handoff').length;
  if (handoffHookCount !== asArray(trace.handoffs).length) {
    failures.push(`handoff hook count ${handoffHookCount} does not match trace handoff count`);
  }
  for (const handoff of asArray(trace.handoffs)) {
    if (!handoff.reasonSummary || !handoff.to || !handoff.from) {
      failures.push('handoff must include from, to, and reasonSummary');
    }
    if (!asArray(handoff.requiredBehavior).length) {
      failures.push('handoff must include requiredBehavior');
    }
  }

  for (const action of [...asArray(decision.proposals), ...asArray(decision.directCalls)]) {
    if (REQUIRED_CONFIRMATION_ACTIONS.has(action.kind) && action.confirmation !== 'required') {
      failures.push(`${action.kind} must require confirmation`);
    }
    if (!REQUIRED_CONFIRMATION_ACTIONS.has(action.kind) && action.confirmation === 'required') {
      failures.push(`${action.kind} should not require confirmation`);
    }
  }

  return {
    id,
    failures,
    decision: {
      answerMode: decision.answerMode,
      reason: decision.reason,
      directCalls: actionKinds(decision, 'directCalls'),
      proposals: actionKinds(decision, 'proposals'),
      artifacts: artifactKinds(decision),
      planningDecision: decision.planningDecision || null,
      tools: toolIds,
      selectedTools: selectedToolIds,
      steps: stepKinds,
      handoffs: handoffTargets,
    },
    hookTypes: events.map((event) => event.type),
  };
}

async function validateMissingRouterFailure(decideTeachingTurn) {
  const events = [];
  try {
    await decideTeachingTurn(baseInput('我有点迷茫，先陪我把这门课下一步想清楚。'), {
      runId: 'contract-ai-router-required',
      currentDate: '2026-06-28',
      hooks: {
        emit(event) {
          events.push(JSON.parse(JSON.stringify(event)));
        },
      },
    });
    return { id: 'ai-router-required', failures: ['expected missing semantic router to fail'] };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failures = [];
    if (!/AI semantic router/.test(message)) {
      failures.push(`expected AI semantic router error, got ${message}`);
    }
    if (!events.some((event) => event.type === 'validation_error')) {
      failures.push('missing router failure must emit validation_error');
    }
    if (events.some((event) => event.type === 'turn_end')) {
      failures.push('missing router failure must not emit turn_end');
    }
    return {
      id: 'ai-router-required',
      failures,
      error: message,
      hookTypes: events.map((event) => event.type),
    };
  }
}

async function validateConfirmedCalendarAdd(decideTeachingTurn, require) {
  const item = {
    title: 'MAT 136 期末复习',
    kind: 'progress',
    date: '2026-08-17',
    startTime: '19:00',
    durationMinutes: 120,
  };
  const events = [];
  const decision = await decideTeachingTurn(
    baseInput('确认添加', {
      recentActions: [
        {
          id: 'calendar-proposal-fixture',
          kind: 'calendar.propose_add',
          label: '确认加入日历',
          summary: '确认后加入 MAT 136 期末复习日程。',
          status: 'proposed',
          confirmation: 'required',
          payload: { items: [item] },
        },
      ],
    }),
    {
      runId: 'contract-confirmed-calendar-add',
      currentDate: '2026-08-09',
      hooks: {
        emit(event) {
          events.push(JSON.parse(JSON.stringify(event)));
        },
      },
    },
  );
  const directCall = decision.directCalls[0];
  const actualItem = directCall?.payload?.items?.[0];
  const failures = [];
  if (decision.answerMode !== 'action_only') {
    failures.push(`expected action_only, got ${decision.answerMode}`);
  }
  if (directCall?.kind !== 'calendar.propose_add') {
    failures.push(`expected calendar.propose_add direct call, got ${directCall?.kind || 'none'}`);
  }
  if (decision.proposals.length !== 0) {
    failures.push('confirmed calendar add must not emit another proposal');
  }
  if (JSON.stringify(actualItem) !== JSON.stringify(item)) {
    failures.push('confirmed calendar add must preserve the exact pending item payload');
  }
  const { learningActionCalendarEvents } = require(
    path.join(ROOT, 'features/learn-core/client-calendar-actions.ts'),
  );
  const executableEvents = learningActionCalendarEvents({
    ...directCall,
    id: 'confirmed-calendar-add-client-action',
  });
  if (executableEvents[0]?.start !== item.startTime) {
    failures.push(
      `confirmed calendar add must preserve start time ${item.startTime}, got ${executableEvents[0]?.start || 'none'}`,
    );
  }
  if (events.filter((event) => event.type === 'turn_end').length !== 1) {
    failures.push('confirmed calendar add must emit exactly one turn_end event');
  }
  return {
    id: 'confirmed-calendar-add-executes-without-second-confirmation',
    failures,
    decision: {
      answerMode: decision.answerMode,
      directCalls: actionKinds(decision, 'directCalls'),
      proposals: actionKinds(decision, 'proposals'),
      payload: directCall?.payload || null,
    },
    hookTypes: events.map((event) => event.type),
  };
}

async function validateShallowReviewPlanFailure(
  decideTeachingTurn,
  learnSemanticRouterOutputSchema,
) {
  const events = [];
  try {
    await decideTeachingTurn(
      baseInput('我想讲解和练题都有：我需要复习 linked list', {
        courseId: 'csc148-local-fixture',
        courseName: 'Introduction to Computer Science',
        courseCode: 'CSC 148',
      }),
      {
        runId: 'contract-shallow-review-plan-rejected',
        currentDate: '2026-06-28',
        hooks: {
          emit(event) {
            events.push(JSON.parse(JSON.stringify(event)));
          },
        },
        semanticRouter: async () =>
          learnSemanticRouterOutputSchema.parse(
            routeOutput({
              answerMode: 'client_activity_plan',
              replyText: '我先给你安排一个复习计划。',
              planningDecision: explicitTopicPlan('linked list'),
              selectedToolIds: ['semantic_router', 'plan_review'],
              artifacts: [
                {
                  kind: 'review_plan',
                  id: 'shallow-review-plan',
                  title: 'Linked list 复习计划',
                  tasks: [
                    {
                      title: '回顾 linked list 的核心结构与术语',
                      concepts: ['linked list'],
                      minutes: 15,
                    },
                  ],
                },
              ],
              reason: 'Fixture intentionally omits review-session content.',
            }),
          ),
      },
    );
    return {
      id: 'shallow-review-plan-rejected',
      failures: ['expected shallow review_plan to fail validation'],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const validationError = events.find((event) => event.type === 'validation_error');
    const validationMetadataError = String(validationError?.metadata?.error || '');
    const failures = [];
    if (
      !/AI semantic router failed to produce a valid decision/.test(message) ||
      !/review_plan must include learningGoal/.test(validationMetadataError)
    ) {
      failures.push(
        `expected review_plan quality error, got message=${message}, metadata=${validationMetadataError}`,
      );
    }
    if (!validationError) {
      failures.push('shallow review_plan failure must emit validation_error');
    }
    if (events.some((event) => event.type === 'turn_end')) {
      failures.push('shallow review_plan failure must not emit turn_end');
    }
    return {
      id: 'shallow-review-plan-rejected',
      failures,
      error: message,
      hookTypes: events.map((event) => event.type),
    };
  }
}

async function validateMissingReviewPlanArtifactFailure(
  decideTeachingTurn,
  learnSemanticRouterOutputSchema,
) {
  const events = [];
  try {
    await decideTeachingTurn(
      baseInput('我想讲解和练题都有：我需要复习 linked list', {
        courseId: 'csc148-local-fixture',
        courseName: 'Introduction to Computer Science',
        courseCode: 'CSC 148',
      }),
      {
        runId: 'contract-review-plan-intent-requires-artifact',
        currentDate: '2026-06-28',
        hooks: {
          emit(event) {
            events.push(JSON.parse(JSON.stringify(event)));
          },
        },
        semanticRouter: async () =>
          learnSemanticRouterOutputSchema.parse(
            routeOutput({
              answerMode: 'none',
              replyText: '',
              planningDecision: explicitTopicPlan('linked list'),
              selectedToolIds: ['semantic_router', 'plan_review'],
              artifacts: [],
              reason: 'Fixture intentionally returns a half-built planning decision.',
            }),
          ),
      },
    );
    return {
      id: 'review-plan-intent-requires-artifact',
      failures: ['expected review_plan intent without artifact to fail validation'],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const validationError = events.find((event) => event.type === 'validation_error');
    const validationMetadataError = String(validationError?.metadata?.error || '');
    const failures = [];
    if (
      !/AI semantic router failed to produce a valid decision/.test(message) ||
      !/review_plan must include a displayable plan artifact/.test(validationMetadataError)
    ) {
      failures.push(
        `expected missing review_plan artifact error, got message=${message}, metadata=${validationMetadataError}`,
      );
    }
    if (!validationError) {
      failures.push('missing review_plan artifact failure must emit validation_error');
    }
    if (events.some((event) => event.type === 'turn_end')) {
      failures.push('missing review_plan artifact failure must not emit turn_end');
    }
    return {
      id: 'review-plan-intent-requires-artifact',
      failures,
      error: message,
      hookTypes: events.map((event) => event.type),
    };
  }
}

function validateConversationMergeContracts(require) {
  const Module = require('node:module');
  const originalLoad = Module._load;
  Module._load = function loadWithBackendStub(request, parent, isMain) {
    if (request === '@/lib/utils/backend-api') {
      return {
        backendJson() {
          throw new Error('backendJson is not available in conversation merge contracts');
        },
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };

  let mergeMessages;
  try {
    ({ mergeRemoteLearnConversationMessages: mergeMessages } = require(
      path.join(ROOT, 'features', 'learn-conversations', 'client', 'remote-conversation-api.ts'),
    ));
  } finally {
    Module._load = originalLoad;
  }

  const baseMessage = {
    id: 'message-base',
    role: 'assistant',
    text: '请选择',
    createdAt: 100,
    learningActions: [{ id: 'action-1', kind: 'memory.search', label: '查找', status: 'proposed' }],
  };
  const remoteNewMessage = {
    id: 'message-remote',
    role: 'user',
    text: '另一个标签页的新消息',
    createdAt: 200,
  };
  const localNewMessage = {
    id: 'message-local',
    role: 'user',
    text: '本标签页的新消息',
    createdAt: 300,
  };

  const additions = mergeMessages([], [remoteNewMessage], [localNewMessage]);
  const additionFailures = [];
  if (!additions.some((message) => message.id === remoteNewMessage.id)) {
    additionFailures.push('remote-only message must survive a concurrent add');
  }
  if (!additions.some((message) => message.id === localNewMessage.id)) {
    additionFailures.push('local-only message must survive a concurrent add');
  }

  const localActionUpdate = {
    ...baseMessage,
    learningActions: [
      {
        ...baseMessage.learningActions[0],
        status: 'completed',
        result: { status: 'completed', summary: '已完成' },
      },
    ],
  };
  const updated = mergeMessages(
    [baseMessage],
    [baseMessage, remoteNewMessage],
    [localActionUpdate],
  );
  const updatedAction = updated.find((message) => message.id === baseMessage.id)
    ?.learningActions?.[0];
  const updateFailures = [];
  if (updatedAction?.status !== 'completed' || updatedAction?.result?.summary !== '已完成') {
    updateFailures.push('local same-id action/result update must survive a remote concurrent add');
  }
  if (!updated.some((message) => message.id === remoteNewMessage.id)) {
    updateFailures.push('remote concurrent add must survive a local same-id update');
  }

  const deletion = mergeMessages([baseMessage], [baseMessage, remoteNewMessage], []);
  const deletionFailures = [];
  if (deletion.some((message) => message.id === baseMessage.id)) {
    deletionFailures.push('a locally deleted base message must not be resurrected');
  }
  if (!deletion.some((message) => message.id === remoteNewMessage.id)) {
    deletionFailures.push('remote concurrent add must survive a local deletion');
  }

  const truncatedCache = mergeMessages([baseMessage], [baseMessage, remoteNewMessage], [], {
    inferLocalDeletions: false,
  });
  const truncatedCacheFailures = [];
  if (!truncatedCache.some((message) => message.id === baseMessage.id)) {
    truncatedCacheFailures.push('a missing entry in a persisted cache must not imply deletion');
  }

  const queuedSecondMessage = {
    id: 'message-queued-second',
    role: 'user',
    text: '同一标签页排队的第二次更新',
    createdAt: 400,
  };
  const queueRebase = mergeMessages(
    [],
    [localNewMessage, remoteNewMessage],
    [localNewMessage, queuedSecondMessage],
  );
  const queueRebaseFailures = [];
  for (const requiredId of [localNewMessage.id, remoteNewMessage.id, queuedSecondMessage.id]) {
    if (!queueRebase.some((message) => message.id === requiredId)) {
      queueRebaseFailures.push(`queue rebase must retain ${requiredId}`);
    }
  }

  const remoteAttachmentMessage = {
    id: 'message-remote-attachment',
    role: 'user',
    text: '请结合这张图继续解释',
    createdAt: 500,
    attachments: [
      {
        id: 'attachment-contract-1',
        name: 'integral-step.png',
        mimeType: 'image/png',
        size: 2048,
        width: 800,
        height: 600,
      },
    ],
  };
  const attachmentMerge = mergeMessages([], [remoteAttachmentMessage], []);
  const mergedAttachment = attachmentMerge.find(
    (message) => message.id === remoteAttachmentMessage.id,
  )?.attachments?.[0];
  const attachmentMergeFailures = [];
  for (const [field, expected] of Object.entries(remoteAttachmentMessage.attachments[0])) {
    if (mergedAttachment?.[field] !== expected) {
      attachmentMergeFailures.push(
        `attachment reference field ${field} must survive conversation merge`,
      );
    }
  }

  return [
    { id: 'conversation-merge-concurrent-additions', failures: additionFailures },
    { id: 'conversation-merge-same-id-action-update', failures: updateFailures },
    { id: 'conversation-merge-deletion-wins', failures: deletionFailures },
    { id: 'conversation-cache-truncation-is-not-deletion', failures: truncatedCacheFailures },
    { id: 'conversation-queued-sync-rebases', failures: queueRebaseFailures },
    { id: 'conversation-attachment-reference-merge', failures: attachmentMergeFailures },
  ];
}

function validateConversationRevisionSourceContract() {
  const failures = [];
  const routeSource = fs.readFileSync(
    path.join(ROOT, 'app', 'api', 'learn', 'conversations', 'route.ts'),
    'utf8',
  );
  const repositorySource = fs.readFileSync(
    path.join(
      ROOT,
      'features',
      'learn-conversations',
      'server',
      'course-conversation-repository.ts',
    ),
    'utf8',
  );
  const clientSource = fs.readFileSync(
    path.join(ROOT, 'features', 'learn-conversations', 'client', 'remote-conversation-api.ts'),
    'utf8',
  );
  const pageSource = fs.readFileSync(
    path.join(ROOT, 'components', 'learn', 'learn-page-client.tsx'),
    'utf8',
  );
  const localCacheSource = fs.readFileSync(
    path.join(ROOT, 'features', 'learn-conversations', 'client', 'local-session-cache.ts'),
    'utf8',
  );
  const getStart = routeSource.indexOf('export async function GET');
  const postStart = routeSource.indexOf('export async function POST');
  const getReadSource =
    getStart >= 0 && postStart > getStart ? routeSource.slice(getStart, postStart) : '';
  const postEnd = routeSource.indexOf('export async function DELETE', postStart);
  const postSource =
    postStart >= 0 && postEnd > postStart ? routeSource.slice(postStart, postEnd) : '';
  const deleteSource = postEnd >= 0 ? routeSource.slice(postEnd) : '';
  for (const [label, source, pattern] of [
    [
      'server base revision equality check',
      repositorySource,
      /"CourseConversation"\."revision" = \$6::bigint/,
    ],
    [
      'legacy overwrite rejection after revision zero',
      repositorySource,
      /\$6::bigint IS NOT NULL[\s\S]{0,100}"CourseConversation"\."revision" = \$6::bigint/,
    ],
    ['per-conversation transaction lock', repositorySource, /pg_advisory_xact_lock/],
    [
      'single-statement bounded conversation detail read',
      repositorySource,
      /loadCourseConversationSnapshot[\s\S]{0,500}\$queryRawUnsafe/,
    ],
    ['thirty-message default window', repositorySource, /DEFAULT_COURSE_MESSAGE_PAGE_LIMIT = 30/],
    [
      'opaque older-message cursor',
      repositorySource,
      /encodeCourseMessagePageCursor[\s\S]{0,300}base64url/,
    ],
    ['dedicated detail repository boundary', getReadSource, /loadCourseConversationSnapshot/],
    ['dedicated list repository boundary', getReadSource, /listCourseConversationPage/],
    [
      'session GET response fields',
      getReadSource,
      /session:[\s\S]*messages:[\s\S]*messagePage:[\s\S]*summary:[\s\S]*currentRevision:/,
    ],
    [
      'session-list GET response fields',
      getReadSource,
      /sessions:[\s\S]*hasMore,[\s\S]*nextCursor:[\s\S]*totalCount/,
    ],
    ['POST write transaction preserved', postSource, /\$transaction/],
    ['DELETE write transaction preserved', deleteSource, /\$transaction/],
    ['foreign message ids rejected before insert', repositorySource, /write_candidates/],
    [
      'foreign message-id conflict is typed',
      repositorySource,
      /CourseConversationRepositoryError\([\s\S]{0,120}'message_conflict'/,
    ],
    ['bounded conflict retries', clientSource, /MAX_CONVERSATION_SYNC_ATTEMPTS = 3/],
    ['client base revision write', clientSource, /baseRevision: baseSnapshot\.revision/],
    ['queued desired snapshot rebase', clientSource, /callBaseSnapshot/],
    ['per-tab persisted merge base', localCacheSource, /sessionStorage\.setItem/],
    ['explicit message tombstones', pageSource, /rememberDeletedLearnMessageId/],
    ['persisted cache does not imply deletion', pageSource, /inferLocalDeletions: false/],
    [
      'untrusted persisted cache cannot overwrite same-id remote state',
      pageSource,
      /: mergeRemoteAuthoritativeLearnMessages\(remoteMessages, latestLocalMessages\)/,
    ],
    [
      'message actions stay disabled until the local session is restored',
      pageSource,
      /disabled=\{!conversationInteractive\}/,
    ],
    [
      'learning action handler rechecks visible-session ownership',
      pageSource,
      /activeMessageStoreKeyRef\.current === actionStoreKey/,
    ],
    ['session owner scoping', clientSource, /ownerScope/],
    [
      'dedicated storage does not read generic conversation tables',
      repositorySource,
      /FROM "CourseConversation"/,
    ],
  ]) {
    if (!pattern.test(source)) failures.push(`missing ${label}`);
  }
  if (/\$transaction|RepeatableRead/.test(getReadSource)) {
    failures.push('GET read path must not open an interactive Prisma transaction');
  }
  if (/FROM "Conversation"|FROM "Message"/.test(repositorySource)) {
    failures.push('dedicated repository must not fall back to generic conversation tables');
  }
  return { id: 'conversation-revision-cas-contract', failures };
}

function validateCourseResourceTruthSourceContract() {
  const failures = [];
  const promptSource = fs.readFileSync(
    path.join(ROOT, 'lib', 'orchestration', 'prompt-builder.ts'),
    'utf8',
  );
  const contextSource = fs.readFileSync(
    path.join(ROOT, 'lib', 'chat', 'course-chat-context.ts'),
    'utf8',
  );
  const adapterSource = fs.readFileSync(
    path.join(ROOT, 'features', 'learn-core', 'client-adapters.ts'),
    'utf8',
  );
  const pageSource = fs.readFileSync(
    path.join(ROOT, 'components', 'learn', 'learn-page-client.tsx'),
    'utf8',
  );
  const resourceLibrarySource = fs.readFileSync(
    path.join(ROOT, 'components', 'courses', 'course-resource-library-page-client.tsx'),
    'utf8',
  );
  for (const [label, source, pattern] of [
    [
      'strict prompt rule that only terminal empty permits an absence claim',
      promptSource,
      /Only a status of empty is permission to say/,
    ],
    [
      'unresolved prompt rule for loading error and unknown',
      promptSource,
      /loading, error, and unknown mean unresolved, never empty/,
    ],
    ['course source text loader', contextSource, /listCourseSourceUploads/],
    ['course source loader includes text', contextSource, /includeText:\s*true/],
    ['idle handoff normalization to unknown', adapterSource, /status === 'idle' \? 'unknown'/],
    ['course-scoped upload queue', pageSource, /item\.courseId === activeCourseId/],
    ['course-scoped persisted source library', pageSource, /upload\.courseId === activeCourseId/],
    ['source text learning materials', pageSource, /sourceUploadsToLearningMaterials/],
    ['resource library source text request', resourceLibrarySource, /includeText:\s*true/],
    ['resource library source text rendering', resourceLibrarySource, /upload\.textSections/],
    ['course-scoped memory history', pageSource, /taskHistoryBelongsToCourse/],
  ]) {
    if (!pattern.test(source)) failures.push(`missing ${label}`);
  }
  for (const [label, source, pattern] of [
    ['course chat notebook-list request', contextSource, /listStagesByCourseOrThrow/],
    ['course chat notebook-content request', contextSource, /loadStageDataOrThrow/],
    ['learn page notebook-list request', pageSource, /listStagesByCourseOrThrow/],
    ['learn page notebook-content endpoint', pageSource, /\/api\/notebooks\//],
    ['resource library notebook-list request', resourceLibrarySource, /listStagesByCourse/],
    ['resource library notebook tab', resourceLibrarySource, /TabsTrigger value=["']notebooks["']/],
  ]) {
    if (pattern.test(source)) failures.push(`unexpected ${label}`);
  }
  return { id: 'course-resource-truth-contract', failures };
}

function sourceWindow(source, startMarker, endMarker, fallbackLength = 40_000) {
  const start = source.indexOf(startMarker);
  if (start < 0) return '';
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : -1;
  return source.slice(start, end >= 0 ? end : start + fallbackLength);
}

function validateLearnTurnTransportSchemaContract(require) {
  const failures = [];
  const { learnTurnRequestSchema } = require(
    path.join(ROOT, 'features', 'learn-core', 'server', 'schemas.ts'),
  );
  const recentMessages = [
    { role: 'user', text: '我上一轮问的是反常积分的定义。' },
    { role: 'assistant', text: '我们已经把无穷区间改写成极限。' },
  ];
  const attachments = [
    {
      id: 'learn-turn-image-contract-1',
      name: 'improper-integral-step.png',
      mimeType: 'image/png',
      size: 4096,
    },
  ];
  const parsed = learnTurnRequestSchema.safeParse(
    baseInput('那图里的第二步为什么成立？', { recentMessages, attachments }),
  );
  if (!parsed.success) {
    failures.push(`learn-turn transport fixture must parse: ${parsed.error.message}`);
    return { id: 'learn-turn-multiturn-image-transport-schema', failures };
  }
  if (JSON.stringify(parsed.data.recentMessages) !== JSON.stringify(recentMessages)) {
    failures.push('learn-turn schema must preserve recentMessages for follow-up routing');
  }
  if (JSON.stringify(parsed.data.attachments) !== JSON.stringify(attachments)) {
    failures.push('learn-turn schema must preserve image attachment metadata for routing');
  }
  return { id: 'learn-turn-multiturn-image-transport-schema', failures };
}

function validateCourseChatFirstBatchSourceContract() {
  const failures = [];
  const pageSource = fs.readFileSync(
    path.join(ROOT, 'components', 'learn', 'learn-page-client.tsx'),
    'utf8',
  );
  const orchestratorSource = fs.readFileSync(
    path.join(ROOT, 'lib', 'chat', 'ask-course-orchestrator.ts'),
    'utf8',
  );
  const courseChatLoopSource = fs.readFileSync(
    path.join(ROOT, 'lib', 'chat', 'run-course-side-chat-loop.ts'),
    'utf8',
  );
  const domainSource = fs.readFileSync(
    path.join(ROOT, 'features', 'learn-core', 'domain', 'types.ts'),
    'utf8',
  );
  const semanticRouterSource = fs.readFileSync(
    path.join(ROOT, 'features', 'learn-core', 'server', 'semantic-router.ts'),
    'utf8',
  );
  const chatTypesSource = fs.readFileSync(path.join(ROOT, 'lib', 'types', 'chat.ts'), 'utf8');
  const attachmentStorePath = path.join(ROOT, 'lib', 'utils', 'learn-chat-attachment-storage.ts');
  const attachmentStoreSource = fs.existsSync(attachmentStorePath)
    ? fs.readFileSync(attachmentStorePath, 'utf8')
    : '';
  const sendSource = sourceWindow(
    pageSource,
    'const sendMessage = useCallback',
    'const sourceBackedNotebookIds',
  );
  const plannerSource = sourceWindow(
    pageSource,
    'async function planLearnTurn',
    'function classifyLearnTurnPlannerError',
  );
  const learnTurnInputSource = sourceWindow(
    domainSource,
    'export type LearnTurnInput =',
    'export type LearnEvidenceSourceType',
    8_000,
  );
  const attachmentReferenceSource = sourceWindow(
    attachmentStoreSource,
    'export type LearnChatAttachmentReference',
    'export type',
    2_000,
  );
  const answerEvidenceSource = sourceWindow(
    pageSource,
    'function answerEvidenceArtifactFromCourseContext',
    'function practicePlanCalendarDraftItems',
    10_000,
  );

  const requirePattern = (label, source, pattern) => {
    if (!pattern.test(source)) failures.push(`missing ${label}`);
  };

  requirePattern(
    'LearnTurnInput attachment metadata',
    learnTurnInputSource,
    /attachments(?:\?)?\s*:\s*(?:Array<[^>]+>|[^;\n]*\[\])/,
  );
  requirePattern(
    'planner request attachment forwarding',
    plannerSource,
    /attachments\s*:\s*(?:args\.attachments|\(args\.attachments\s*\|\|\s*\[\]\))/,
  );
  requirePattern(
    'nullable course code omitted from planner request',
    plannerSource,
    /courseCode\s*:\s*args\.course\.courseCode\s*\|\|\s*undefined/,
  );
  requirePattern(
    'semantic router current attachment context',
    semanticRouterSource,
    /Current message attachments:[^`]*\$\{compactJson\(input\.attachments,/,
  );
  requirePattern(
    'semantic router recent conversation context',
    semanticRouterSource,
    /formatRecentMessages\(input\.recentMessages\)/,
  );
  requirePattern(
    'send flow attachment forwarding into planLearnTurn',
    sendSource,
    /planLearnTurn\s*\(\s*\{[\s\S]*?attachments\s*:\s*outgoingAttachments/,
  );
  if (
    /if\s*\(\s*!hasAttachments\s*\)\s*\{[\s\S]{0,1500}?learnTurn\s*=\s*await\s+planLearnTurn/.test(
      sendSource,
    )
  ) {
    failures.push('image messages must not bypass planLearnTurn');
  }
  if (/pendingWorkflowMessageId\s*=\s*hasAttachments\s*\?/.test(sendSource)) {
    failures.push('image messages must receive the same pending workflow state as text messages');
  }

  requirePattern(
    'course answerer conversation option',
    orchestratorSource,
    /conversation\?\s*:\s*UIMessage<ChatMessageMetadata>\[\]/,
  );
  requirePattern(
    'course answerer prior-message prepend',
    orchestratorSource,
    /\.\.\.\(options\.conversation\s*\|\|\s*\[\]\)/,
  );
  requirePattern(
    'learn-message to course-answerer conversation adapter',
    pageSource,
    /function\s+learnMessagesForCourseAnswerer\s*\(/,
  );
  requirePattern(
    'prior conversation passed to course answerer',
    sendSource,
    /(?:conversation\s*:\s*learnMessagesForCourseAnswerer\(\s*messages\s*\)|answererConversation\s*=\s*learnMessagesForCourseAnswerer\(\s*messages\s*\)[\s\S]*?conversation\s*:\s*answererConversation)/,
  );
  requirePattern('course answer stream callback', sendSource, /onMessages\s*:/);
  const streamCallbackSource = sourceWindow(sendSource, 'onMessages:', '});', 5_000);
  if (
    !/progressOnly/.test(streamCallbackSource) &&
    !/courseStreamToPendingLearnMessage/.test(streamCallbackSource) &&
    !/streamedCourseAnswerFromMessages/.test(streamCallbackSource)
  ) {
    failures.push('course answer stream must filter progressOnly updates into the pending message');
  }
  requirePattern(
    'streamed pending message replacement',
    streamCallbackSource,
    /replaceLearnMessage|courseStreamToPendingLearnMessage/,
  );
  requirePattern('transient pending message state', sendSource, /transient\s*:\s*true/);

  requirePattern('stopSending callback', pageSource, /const\s+stopSending\s*=\s*useCallback/);
  const stopSource = sourceWindow(pageSource, 'const stopSending', 'const sendMessage', 4_000);
  requirePattern(
    'user stop aborts active controller',
    stopSource,
    /sendRequestRef\.current[\s\S]*?controller\.abort/,
  );
  requirePattern('user stop state', stopSource, /stoppedByUser/);
  requirePattern('visible stop action', pageSource, /停止生成/);
  requirePattern(
    'active SSE reader abort cancellation',
    courseChatLoopSource,
    /const\s+cancelReader\s*=\s*\(\)\s*=>\s*\{[\s\S]{0,200}?reader\.cancel\(/,
  );
  requirePattern(
    'stop action wired to SSE reader cancellation',
    courseChatLoopSource,
    /signal\.addEventListener\(\s*'abort'\s*,\s*cancelReader/,
  );
  requirePattern(
    'sendMessage attachment override for retry',
    sendSource,
    /async\s*\(\s*textOverride\?\s*:\s*string\s*,\s*attachmentOverride\?/,
  );
  requirePattern('visible retry action', pageSource, /重新发送上一条/);
  requirePattern(
    'empty terminal route remains visible and retryable',
    sendSource,
    /const\s+emptyTerminalRoute[\s\S]{0,1800}?setRetryTurn\([\s\S]{0,400}?replaceLearnMessage\(/,
  );
  requirePattern(
    'retry reuses prior text and attachment references',
    pageSource,
    /sendMessage\s*\(\s*[\s\S]{0,120}?\.text\s*,\s*[\s\S]{0,120}?\.attachments\s*\)/,
  );

  if (!attachmentStoreSource) {
    failures.push('missing scoped learn chat attachment store');
  } else {
    for (const exportName of [
      'saveLearnChatAttachment',
      'readLearnChatAttachment',
      'deleteLearnChatAttachment',
      'clearLearnChatMessageAttachments',
      'clearLearnChatSessionAttachments',
      'pruneLearnChatAttachments',
    ]) {
      requirePattern(
        `attachment store export ${exportName}`,
        attachmentStoreSource,
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${exportName}\\b`),
      );
    }
    for (const scopeField of ['ownerId', 'courseId', 'sessionId', 'messageId']) {
      requirePattern(
        `attachment scope field ${scopeField}`,
        attachmentStoreSource,
        new RegExp(`\\b${scopeField}\\b`),
      );
    }
    if (!attachmentReferenceSource) {
      failures.push('missing LearnChatAttachmentReference type');
    } else if (/\b(?:dataUrl|objectUrl|blob)\b/.test(attachmentReferenceSource)) {
      failures.push('persisted attachment references must not contain dataUrl, objectUrl, or blob');
    }
  }

  const serializableSource = sourceWindow(
    pageSource,
    'function serializableLearnMessages',
    'function writeLearnSessionMessages',
    4_000,
  );
  if (/attachments\s*:\s*undefined/.test(serializableSource)) {
    failures.push('serializable learn messages must retain durable attachment references');
  }
  requirePattern(
    'runtime attachment fields stripped from local conversation JSON',
    serializableSource,
    /attachments\s*:\s*message\.attachments\?\.map\(learnAttachmentReference\)/,
  );
  const remoteRestoreSource = sourceWindow(
    pageSource,
    'function remoteMessageToLearnMessage',
    'function learnMessageToRemotePayload',
    6_000,
  );
  requirePattern(
    'remote attachment reference restoration',
    remoteRestoreSource,
    /attachments\s*:\s*message\.attachments/,
  );
  const remotePayloadSource = sourceWindow(
    pageSource,
    'function learnMessageToRemotePayload',
    'async function hydrateLearnMessageAttachments',
    6_000,
  );
  requirePattern(
    'runtime attachment fields stripped from remote conversation JSON',
    remotePayloadSource,
    /attachments\s*:\s*settledMessage\.attachments\?\.map\(learnAttachmentReference\)/,
  );
  requirePattern(
    'attachment save integration',
    pageSource,
    /\bsaveLearnChatAttachment(?:DataUrl)?\s*\(/,
  );
  requirePattern(
    'attachment hydration integration',
    pageSource,
    /\breadLearnChatAttachment\s*\(|\bhydrateLearnChat\w*\s*\(/,
  );
  requirePattern(
    'attachment deletion cleanup integration',
    pageSource,
    /\bclearLearnChatMessageAttachments\s*\(|\bclearLearnChatSessionAttachments\s*\(/,
  );
  requirePattern(
    'knowledge cache source entity type',
    chatTypesSource,
    /knowledgeCache\?\s*:\s*Array<\{[\s\S]{0,800}?sourceId\?\s*:\s*string/,
  );
  requirePattern(
    'knowledge cache evidence preserves source entity id',
    answerEvidenceSource,
    /sourceId\s*:\s*cache\.sourceId/,
  );
  requirePattern(
    'knowledge cache problem variants route to problem bank',
    answerEvidenceSource,
    /cache\.sourceType\s*===\s*'problem'[\s\S]{0,160}?cache\.sourceType\s*===\s*'problem_bank'[\s\S]{0,160}?\?\s*'problem_bank'/,
  );
  requirePattern(
    'original problem evidence routes to problem bank',
    answerEvidenceSource,
    /sourceType\s*:\s*source\.sourceType\s*===\s*'problem'\s*\?\s*'problem_bank'\s*:\s*'source'/,
  );
  requirePattern(
    'course id forwarded to evidence cards',
    pageSource,
    /<LearnArtifactCards[\s\S]{0,300}?courseId=\{activeCourse\?\.id\}/,
  );

  return { id: 'course-chat-first-batch-p0-source-contract', failures };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { require, restore } = installTypeScriptRequireHook();
  const { decideTeachingTurn } = require(
    path.join(ROOT, 'features', 'learn-core', 'server', 'decision-chain.ts'),
  );
  const { LEARN_CORE_TOOL_CONTRACTS, getLearnCoreTool } = require(
    path.join(ROOT, 'features', 'learn-core', 'server', 'tool-registry.ts'),
  );
  const { learnSemanticRouterOutputSchema } = require(
    path.join(ROOT, 'features', 'learn-core', 'server', 'semantic-router.ts'),
  );

  const contractFailures = [];
  const contractIds = LEARN_CORE_TOOL_CONTRACTS.map((tool) => tool.id);
  const uniqueContractIds = new Set(contractIds);
  if (uniqueContractIds.size !== contractIds.length) {
    contractFailures.push('tool contract ids must be unique');
  }
  if (!contractIds.includes('semantic_router')) {
    contractFailures.push('tool contracts must include semantic_router');
  }
  if (contractIds.includes('legacy_semantic_planner')) {
    contractFailures.push('tool contracts must not include legacy_semantic_planner');
  }
  const semanticRouterContract = getLearnCoreTool('semantic_router');
  if (!semanticRouterContract?.sideEffects?.includes('llm')) {
    contractFailures.push('semantic_router contract must declare llm side effect');
  }
  if (!semanticRouterContract?.writesTo?.includes('decision')) {
    contractFailures.push('semantic_router contract must write a decision');
  }

  const learnCoreIndexSource = fs.readFileSync(
    path.join(ROOT, 'features', 'learn-core', 'index.ts'),
    'utf8',
  );
  if (/legacy-/.test(learnCoreIndexSource)) {
    contractFailures.push('features/learn-core/index.ts must not export legacy planner modules');
  }

  const decisionChainSource = fs.readFileSync(
    path.join(ROOT, 'features', 'learn-core', 'server', 'decision-chain.ts'),
    'utf8',
  );
  for (const forbiddenDecisionChainSource of [
    './pipeline',
    'runLearnDecisionPipeline',
    'semanticPlanner',
    'legacy_semantic_planner',
    'Defaulted to course answer',
    'tracedHandoffToAnswerer',
    "kind: 'fallback'",
  ]) {
    if (decisionChainSource.includes(forbiddenDecisionChainSource)) {
      contractFailures.push(
        `decision-chain must be AI-first and not include ${forbiddenDecisionChainSource}`,
      );
    }
  }
  if (!decisionChainSource.includes('AI semantic router is not configured')) {
    contractFailures.push('decision-chain must fail loudly when semantic router is unavailable');
  }
  if (!decisionChainSource.includes('validateSemanticRouterOutput')) {
    contractFailures.push('decision-chain must validate AI router output before continuing');
  }

  const semanticRouterSource = fs.readFileSync(
    path.join(ROOT, 'features', 'learn-core', 'server', 'semantic-router.ts'),
    'utf8',
  );
  const fixedWorkflowSource = fs.readFileSync(
    path.join(ROOT, 'features', 'teaching-orchestrator', 'domain', 'fixed-workflows.ts'),
    'utf8',
  );
  for (const requiredSemanticRouterContract of [
    'learnSemanticRouterOutputSchema',
    'handoff',
    'selectedToolIds',
    'explicit topic to review',
    'Explanation-only concept review is a course_answer handoff',
    'shouldAskProgressFirst=false',
    'Do not use keyword-only routing',
    'learningGoal',
    'focusPoints',
    'selfChecks',
    'walk through the example before code',
    'teachingWorkflowPromptSections',
    'Fixed review workflows',
    'Fixed memory extraction workflows',
  ]) {
    if (
      !semanticRouterSource.includes(requiredSemanticRouterContract) &&
      !fixedWorkflowSource.includes(requiredSemanticRouterContract)
    ) {
      contractFailures.push(`semantic-router must include ${requiredSemanticRouterContract}`);
    }
  }
  if (/minimal concept-review artifact is enough/.test(semanticRouterSource)) {
    contractFailures.push('semantic-router must not accept shallow review artifacts');
  }

  const toolRegistrySource = fs.readFileSync(
    path.join(ROOT, 'features', 'learn-core', 'server', 'tool-registry.ts'),
    'utf8',
  );
  if (/isLegacySemanticPlannerEnabled|legacy_semantic_planner/.test(toolRegistrySource)) {
    contractFailures.push('tool-registry must not expose legacy semantic planner switches');
  }

  const semanticRouterRuntimeSource = fs.readFileSync(
    path.join(ROOT, 'features', 'learn-core', 'server', 'semantic-router-runtime.ts'),
    'utf8',
  );
  if (!/generateObject/.test(semanticRouterRuntimeSource)) {
    contractFailures.push('semantic-router-runtime must use schema-native generateObject');
  }
  if (/generateText/.test(semanticRouterRuntimeSource)) {
    contractFailures.push('semantic-router-runtime must not parse freeform generateText output');
  }

  const routeFiles = [
    'app/api/learn/turn/route.ts',
    'app/api/learn/action-planner/route.ts',
    'app/api/learn/planning-intent/route.ts',
  ];
  for (const routeFile of routeFiles) {
    const source = fs.readFileSync(path.join(ROOT, routeFile), 'utf8');
    const topLevelImports = source
      .split('\n')
      .filter((line) => /^import\s/.test(line) || /^\s+\w*Legacy\w*/.test(line))
      .join('\n');
    if (/from 'ai'|from "ai"/.test(topLevelImports)) {
      contractFailures.push(`${routeFile} must not top-level import ai/generateText`);
    }
    if (/resolve-model/.test(topLevelImports)) {
      contractFailures.push(`${routeFile} must not top-level import resolveModelFromHeaders`);
    }
    if (/isLegacySemanticPlannerEnabled|legacy-semantic-planner|semanticPlanner/.test(source)) {
      contractFailures.push(`${routeFile} must use the AI semantic router, not legacy planners`);
    }
    if (!source.includes('createRequestSemanticRouter')) {
      contractFailures.push(`${routeFile} must use createRequestSemanticRouter`);
    }
  }

  const cases = [
    {
      id: 'explicit-topic-review-mode-choice',
      input: baseInput('我需要复习 linked list', {
        courseId: 'csc148-local-fixture',
        courseName: 'Introduction to Computer Science',
        courseCode: 'CSC 148',
        hasSyllabus: false,
        progressKnown: false,
        calendarEvents: [],
        problemBank: {
          available: true,
          activeCount: 2,
          samples: [
            { id: 'csc148-linked-list-1', title: 'Linked list recursion trace' },
            { id: 'csc148-linked-list-2', title: 'Linked list insert cases' },
          ],
        },
      }),
      routerOutput: routeOutput({
        answerMode: 'client_activity_plan',
        replyText:
          'This router output should not be used because the fixed workflow asks mode first.',
        planningDecision: explicitTopicPlan('linked list'),
        selectedToolIds: ['semantic_router', 'plan_review'],
        reason: 'Unused fixture.',
      }),
      expect: {
        answerMode: 'action_only',
        toolsInclude: ['resolve_fixed_review_workflow'],
        selectedToolsInclude: ['resolve_fixed_review_workflow'],
        stepsInclude: ['observe_input', 'select_evidence_plan'],
        proposalsInclude: ['review_mode.request_choice'],
        planningIntent: 'review_plan',
        scopeHint: 'explicit_topic',
        focusTopicsInclude: ['我需要复习 linked list'],
        reviewModeFollowupsInclude: [
          '我想听讲解：我需要复习 linked list',
          '我想练题目：我需要复习 linked list',
          '我想讲解和练题都有：我需要复习 linked list',
        ],
        shouldAskProgressFirst: false,
      },
    },
    {
      id: 'explicit-topic-explanation-review-handoff',
      input: baseInput('我想听讲解：我需要复习 linked list', {
        courseId: 'csc148-local-fixture',
        courseName: 'Introduction to Computer Science',
        courseCode: 'CSC 148',
        hasSyllabus: false,
        progressKnown: false,
        calendarEvents: [],
        problemBank: {
          available: true,
          activeCount: 2,
          samples: [
            { id: 'csc148-linked-list-1', title: 'Linked list recursion trace' },
            { id: 'csc148-linked-list-2', title: 'Linked list insert cases' },
          ],
        },
      }),
      routerOutput: routeOutput({
        answerMode: 'course_answer',
        selectedToolIds: [
          'semantic_router',
          'search_memory',
          'search_course_materials',
          'answer_course_question',
        ],
        planningDecision: {
          ...explicitTopicPlan('linked list'),
          intent: 'none',
          resolvedPrompt: '我想听讲解：我需要复习 linked list',
        },
        handoff: answerHandoff('The learner chose explanation-only concept review.', [
          'Teach linked list directly in chat instead of creating a review plan artifact.',
          'Use Chinese with this internal teaching rhythm: plain intuition -> concrete tiny walk-through -> main operation/state change -> likely confusion -> one short check question.',
          'For code or data-structure topics, walk through the example before code.',
          'Do not expose internal labels such as 核心心智模型 or 状态追踪.',
        ]),
        reason:
          'Explanation-only concept review should be handled by the course answerer, not by a review plan card.',
      }),
      expect: {
        answerMode: 'course_answer',
        selectedToolsInclude: [
          'search_memory',
          'search_course_materials',
          'answer_course_question',
        ],
        handoffsTo: ['course_answerer'],
        artifactsExclude: ['review_plan', 'activity_plan', 'calendar_draft'],
        scopeHint: 'explicit_topic',
        resolvedPrompt: '我想听讲解：我需要复习 linked list',
        focusTopicsInclude: ['linked list'],
        handoffRequiredBehaviorIncludes: [
          'walk through the example before code',
          'one short check question',
          'Do not expose internal labels',
        ],
        shouldAskProgressFirst: false,
      },
    },
    {
      id: 'explicit-problem-explanation-repairs-missing-handoff',
      input: baseInput(
        '请讲解真实题库题「Binary representation by distinct powers of 2」的证明思路，不要只给结论。',
        {
          courseId: 'mat102-local-fixture',
          courseName: 'Introduction to Mathematical Proofs',
          courseCode: 'MAT 102',
        },
      ),
      routerOutput: routeOutput({
        answerMode: 'course_answer',
        selectedToolIds: ['semantic_router'],
        handoff: null,
        reason: 'Fixture intentionally omits the required handoff.',
      }),
      expect: {
        answerMode: 'course_answer',
        selectedToolsInclude: [
          'search_memory',
          'search_course_materials',
          'answer_course_question',
        ],
        handoffsTo: ['course_answerer'],
        artifactsExclude: ['review_plan', 'activity_plan', 'calendar_draft'],
      },
    },
    {
      id: 'plan-calendar-followup-reuses-artifact',
      input: baseInput('把刚才这份三天复习计划添加到学习日历。', {
        courseId: 'mat102-local-fixture',
        courseName: 'Introduction to Mathematical Proofs',
        courseCode: 'MAT 102',
        recentArtifacts: [
          {
            kind: 'review_plan',
            id: 'review-plan-fixture',
            title: 'MAT102 三天复习计划',
            calendarDraftItems: [
              {
                id: 'calendar-draft-1',
                title: '复习数学归纳法',
                date: '2026-07-25',
                durationMinutes: 30,
              },
              {
                id: 'calendar-draft-2',
                title: '练习强归纳法',
                date: '2026-07-26',
                durationMinutes: 30,
              },
            ],
          },
        ],
      }),
      routerOutput: routeOutput({
        answerMode: 'none',
        reason: 'This router fixture must not run because the artifact follow-up is deterministic.',
      }),
      expect: {
        answerMode: 'action_only',
        toolsInclude: ['propose_calendar_change'],
        stepsInclude: ['observe_input', 'propose_writeback'],
        proposalsInclude: ['calendar.propose_add'],
        artifactsExclude: ['review_plan', 'activity_plan', 'calendar_draft'],
      },
    },
    {
      id: 'explicit-topic-practice-request-uses-bank-selection',
      input: baseInput('我想练题目：我需要复习 truth table', {
        courseId: 'mat102-local-fixture',
        courseName: 'Mathematical Proofs',
        courseCode: 'MAT 102',
        hasSyllabus: false,
        progressKnown: false,
        problemBank: {
          available: true,
          activeCount: 3,
          samples: [
            { id: 'mat102-truth-table-1', title: 'Truth table for implication' },
            { id: 'mat102-truth-table-2', title: 'Logical equivalence by truth table' },
            { id: 'mat102-truth-table-3', title: 'Tautology and contradiction' },
          ],
        },
      }),
      routerOutput: () => {
        throw new Error('semantic router should not run for explicit bank-backed practice request');
      },
      searchProblemBank: async ({ query, requestedCount }) => {
        if (query !== 'truth table') {
          throw new Error(`expected cleaned truth table search query, got ${query}`);
        }
        return {
          query,
          requestedCount,
          source: 'problem_bank_full_text',
          strictTopic: 'truth_table',
          matches: [
            {
              problemId: 'mat102-truth-table-1',
              title: 'Truth table for implication',
              score: 92,
              reason: 'The problem asks for a truth table of a compound proposition.',
              excerpt: 'Construct a truth table for p -> q.',
              tags: ['truth table', 'propositional logic'],
              difficulty: 'basic',
              problemType: 'practice',
              attemptStatus: 'not_started',
            },
          ],
          excluded: [
            {
              problemId: 'mat102-quantifier-1',
              title: '"并非所有猫都是邪恶"的谓词公式表达',
              reason: 'Quantifier/predicate expression is not a truth-table exercise.',
              excerpt: 'Translate the sentence using predicates and quantifiers.',
            },
          ],
          rationale: ['Matched by full problem text, not only tags.'],
          gaps: [
            '严格命中「truth table / truth values」的题只有 1 道；没有为了凑数量混入相邻专题。',
          ],
          searchedAt: '2026-06-28T00:00:00.000Z',
        };
      },
      expect: {
        answerMode: 'client_practice_plan',
        toolsInclude: ['search_problem_bank'],
        selectedToolsInclude: ['search_problem_bank'],
        stepsInclude: ['observe_input', 'select_evidence_plan'],
        artifactsExclude: ['review_plan', 'activity_plan', 'calendar_draft'],
        planningIntent: 'practice_plan',
        scopeHint: 'explicit_topic',
        resolvedPrompt: '我想练题目：我需要复习 truth table',
        focusTopicsInclude: ['truth table'],
        problemBankSearchMatchIdsInclude: ['mat102-truth-table-1'],
        problemBankSearchExcludedTitlesInclude: ['"并非所有猫都是邪恶"的谓词公式表达'],
        shouldAskProgressFirst: false,
      },
    },
    {
      id: 'explicit-topic-practice-with-empty-bank-reports-gap-without-generation',
      input: baseInput('我想练题目：我需要复习 truth table', {
        courseId: 'mat102-local-fixture',
        courseName: 'Mathematical Proofs',
        courseCode: 'MAT 102',
        hasSyllabus: false,
        progressKnown: false,
        problemBank: {
          available: false,
          activeCount: 0,
          samples: [],
        },
      }),
      routerOutput: () => {
        throw new Error('semantic router should not run when explicit practice has an empty bank');
      },
      expect: {
        answerMode: 'action_only',
        toolsInclude: [],
        stepsInclude: ['observe_input', 'select_evidence_plan'],
        proposalsExclude: ['practice.propose_generation'],
        artifactsExclude: ['review_plan', 'activity_plan', 'calendar_draft'],
        planningIntent: 'practice_plan',
        scopeHint: 'explicit_topic',
        resolvedPrompt: '我想练题目：我需要复习 truth table',
        focusTopicsInclude: ['truth table'],
        replyTextIncludes: ['不会临时生成题目'],
        shouldAskProgressFirst: false,
      },
    },
    {
      id: 'loading-problem-bank-is-not-treated-as-empty',
      input: baseInput('我想练题目：truth table', {
        courseId: 'mat102-local-fixture',
        courseName: 'Mathematical Proofs',
        courseCode: 'MAT 102',
        hasSyllabus: false,
        progressKnown: false,
        resourceStates: {
          notebooks: 'ready',
          problems: 'loading',
          sources: 'ready',
        },
        problemBank: {
          available: false,
          activeCount: 0,
          samples: [],
        },
      }),
      routerOutput: () => {
        throw new Error('semantic router should not run for explicit practice request');
      },
      searchProblemBank: async ({ query, requestedCount }) => ({
        query,
        requestedCount,
        source: 'problem_bank_full_text',
        strictTopic: 'truth_table',
        matches: [
          {
            problemId: 'mat102-truth-table-live-1',
            title: 'Truth table live lookup',
            score: 95,
            reason: 'The completed server-side lookup found a strict truth-table exercise.',
            excerpt: 'Build the truth table for the proposition.',
            tags: ['truth table'],
          },
        ],
        excluded: [],
        rationale: ['The loading client snapshot was not treated as an empty bank.'],
        gaps: [],
        searchedAt: '2026-06-28T00:00:00.000Z',
      }),
      expect: {
        answerMode: 'client_practice_plan',
        toolsInclude: ['search_problem_bank'],
        selectedToolsInclude: ['search_problem_bank'],
        stepsInclude: ['observe_input', 'select_evidence_plan'],
        proposalsExclude: ['practice.propose_generation'],
        artifactsExclude: ['review_plan', 'activity_plan', 'calendar_draft'],
        planningIntent: 'practice_plan',
        scopeHint: 'explicit_topic',
        focusTopicsInclude: ['truth table'],
        problemBankSearchMatchIdsInclude: ['mat102-truth-table-live-1'],
        shouldAskProgressFirst: false,
      },
    },
    {
      id: 'semantic-practice-plan-executes-problem-bank-search',
      input: baseInput('出一组能检查我是否会 truth table 的题', {
        courseId: 'mat102-local-fixture',
        courseName: 'Mathematical Proofs',
        courseCode: 'MAT 102',
        hasSyllabus: false,
        progressKnown: false,
        problemBank: {
          available: true,
          activeCount: 4,
          samples: [
            { id: 'mat102-truth-table-1', title: 'Truth table for implication' },
            { id: 'mat102-truth-table-2', title: 'Truth values of logical statements' },
            { id: 'mat102-quantifier-1', title: '"并非所有猫都是邪恶"的谓词公式表达' },
          ],
        },
      }),
      routerOutput: routeOutput({
        answerMode: 'client_practice_plan',
        planningDecision: {
          ...explicitTopicPlan('truth table'),
          intent: 'practice_plan',
          practiceMode: 'practice',
          resolvedPrompt: '出一组能检查我是否会 truth table 的题',
          focusTopics: ['truth table'],
          constraintsSummary: 'Router selected a practice plan; question selection is unresolved.',
          reason: 'The learner asks for a truth table practice check.',
        },
        selectedToolIds: ['semantic_router'],
        reason: 'Route to client-side practice plan.',
      }),
      searchProblemBank: async ({ query, requestedCount }) => {
        if (query !== 'truth table') {
          throw new Error(`expected truth table search query, got ${query}`);
        }
        return {
          query,
          requestedCount,
          source: 'problem_bank_full_text',
          strictTopic: 'truth_table',
          matches: [
            {
              problemId: 'mat102-truth-table-1',
              title: 'Truth table for implication',
              score: 91,
              reason: 'The problem asks for a truth table of a compound proposition.',
              excerpt: 'Construct a truth table for p -> q and identify when it is false.',
              tags: ['truth table', 'propositional logic'],
              difficulty: 'basic',
              problemType: 'practice',
              attemptStatus: 'not_started',
            },
            {
              problemId: 'mat102-truth-table-2',
              title: 'Truth values of logical statements',
              score: 86,
              reason: 'The prompt asks for truth values of propositional statements.',
              excerpt: 'Evaluate truth values for compound logical statements.',
              tags: ['truth value', 'logic'],
              difficulty: 'medium',
              problemType: 'practice',
              attemptStatus: 'draft',
            },
          ],
          excluded: [
            {
              problemId: 'mat102-quantifier-1',
              title: '"并非所有猫都是邪恶"的谓词公式表达',
              reason:
                'Contains quantifier/predicate-formula signals rather than truth-table signals.',
              excerpt: 'Translate "not all cats are evil" using predicates and quantifiers.',
            },
          ],
          rationale: [
            'Matched by full problem text and grading metadata, not only visible tags.',
            'Quantifier-only candidates are excluded from a strict truth table set.',
          ],
          gaps: [
            '严格命中「truth table / truth values」的题只有 2 道；没有为了凑数量混入相邻专题。',
          ],
          searchedAt: '2026-06-28T00:00:00.000Z',
        };
      },
      expect: {
        answerMode: 'client_practice_plan',
        toolsInclude: ['semantic_router', 'search_problem_bank'],
        selectedToolsInclude: ['search_problem_bank'],
        stepsInclude: ['observe_input', 'model_routing', 'select_evidence_plan'],
        artifactsExclude: ['review_plan', 'activity_plan', 'calendar_draft'],
        planningIntent: 'practice_plan',
        scopeHint: 'explicit_topic',
        resolvedPrompt: '出一组能检查我是否会 truth table 的题',
        focusTopicsInclude: ['truth table'],
        problemBankSearchMatchIdsInclude: ['mat102-truth-table-1', 'mat102-truth-table-2'],
        problemBankSearchExcludedTitlesInclude: ['"并非所有猫都是邪恶"的谓词公式表达'],
        shouldAskProgressFirst: false,
      },
    },
    {
      id: 'explicit-topic-review-plan-after-mode-choice',
      input: baseInput('我想讲解和练题都有：我需要复习 linked list', {
        courseId: 'csc148-local-fixture',
        courseName: 'Introduction to Computer Science',
        courseCode: 'CSC 148',
        hasSyllabus: false,
        progressKnown: false,
        calendarEvents: [],
        problemBank: {
          available: true,
          activeCount: 2,
          samples: [
            { id: 'csc148-linked-list-1', title: 'Linked list recursion trace' },
            { id: 'csc148-linked-list-2', title: 'Linked list insert cases' },
          ],
        },
      }),
      routerOutput: routeOutput({
        answerMode: 'client_activity_plan',
        replyText: '可以，我会只按 linked list 做一次复习活动，不扩展到课程起始范围。',
        planningDecision: explicitTopicPlan('linked list'),
        selectedToolIds: ['semantic_router', 'plan_review', 'search_problem_bank'],
        artifacts: [
          {
            kind: 'review_plan',
            id: 'review-linked-list',
            title: 'Linked list 复习',
            learningGoal: '把 linked list 的节点关系、常见操作和边界情况复习到能马上做小题。',
            tasks: [
              {
                title: '用图复述 node、head、tail、next 指针如何组成链表',
                concepts: ['linked list'],
                minutes: 12,
                reason: 'Start from the structure before operations.',
              },
              {
                title: '比较头部插入、尾部插入、删除节点和遍历的复杂度',
                concepts: ['linked list', 'time complexity'],
                minutes: 15,
                reason: 'The learner explicitly asked for linked list review.',
              },
            ],
            focusPoints: [
              {
                title: 'Node reference model',
                explanation:
                  'A linked list stores sequence order through references between nodes rather than contiguous array indexes.',
                checkQuestion: '如果只有 head，为什么访问第 k 个节点通常要从头走过去？',
              },
              {
                title: 'Edge cases around insertion and deletion',
                explanation:
                  'Empty lists, one-node lists, head updates, and tail updates are where most implementation mistakes happen.',
                checkQuestion: '删除 head 和删除中间节点时，哪一个指针更新最容易漏掉？',
              },
            ],
            selfChecks: [
              {
                question: '为什么 singly linked list 头部插入通常是 O(1)？',
                expectedAnswer: '只需要创建新节点，让它指向旧 head，再把 head 更新成新节点。',
                concept: 'head insertion',
                difficulty: 'warmup',
              },
              {
                question: '如果没有 tail 指针，尾部插入为什么通常是 O(n)？',
                expectedAnswer:
                  '需要从 head 遍历到最后一个节点，才能把最后节点的 next 接上新节点。',
                concept: 'tail insertion',
                difficulty: 'core',
              },
            ],
            practiceBridge: {
              title: '接到题库练习',
              summary: '题库里已有 linked list 样例，可在概念自检后抽题。',
              problemIds: ['csc148-linked-list-1', 'csc148-linked-list-2'],
              generatedPrompts: [],
            },
            nextSteps: ['如果自检答错，回到节点图示；如果答对，进入题库练习。'],
          },
        ],
        reason: 'The learner explicitly asked to review linked list, so plan that topic directly.',
        confidence: 0.94,
      }),
      expect: {
        answerMode: 'client_activity_plan',
        selectedToolsInclude: ['plan_review', 'search_problem_bank'],
        planningIntent: 'review_plan',
        scopeHint: 'explicit_topic',
        focusTopicsInclude: ['linked list'],
        shouldAskProgressFirst: false,
      },
    },
    {
      id: 'review-mode-short-reply-uses-target',
      input: baseInput('练题目', {
        courseId: 'csc148-local-fixture',
        courseName: 'Introduction to Computer Science',
        courseCode: 'CSC 148',
        recentActions: [
          {
            id: 'learn-action-review-mode',
            kind: 'review_mode.request_choice',
            label: '选择复习方式',
            summary: '你这次更想听讲解、练题，还是两者都要？',
            status: 'proposed',
            confirmation: 'required',
            payload: {
              targetText: '我需要复习 linked list',
            },
          },
        ],
        problemBank: {
          available: true,
          activeCount: 2,
          samples: [
            { id: 'csc148-linked-list-1', title: 'Linked list recursion trace' },
            { id: 'csc148-linked-list-2', title: 'Linked list insert cases' },
          ],
        },
      }),
      routerOutput(ctx) {
        throw new Error(
          `semantic router should not run for short bank-backed practice reply; got ${ctx.input.question}`,
        );
      },
      expect: {
        answerMode: 'client_practice_plan',
        toolsInclude: ['search_problem_bank'],
        selectedToolsInclude: ['search_problem_bank'],
        stepsInclude: ['observe_input', 'select_evidence_plan'],
        artifactsExclude: ['review_plan', 'activity_plan', 'calendar_draft'],
        planningIntent: 'practice_plan',
        scopeHint: 'explicit_topic',
        resolvedPrompt: '我想练题目：我需要复习 linked list',
        focusTopicsInclude: ['linked list'],
        shouldAskProgressFirst: false,
      },
    },
    {
      id: 'review-mode-short-both-reply-uses-target',
      input: baseInput('都有', {
        courseId: 'csc148-local-fixture',
        courseName: 'Introduction to Computer Science',
        courseCode: 'CSC 148',
        recentActions: [
          {
            id: 'learn-action-review-mode',
            kind: 'review_mode.request_choice',
            label: '选择复习方式',
            summary: '你这次更想听讲解、练题，还是两者都要？',
            status: 'proposed',
            confirmation: 'required',
            payload: {
              targetText: '我需要复习 linked list',
            },
          },
        ],
        problemBank: {
          available: true,
          activeCount: 2,
          samples: [
            { id: 'csc148-linked-list-1', title: 'Linked list recursion trace' },
            { id: 'csc148-linked-list-2', title: 'Linked list insert cases' },
          ],
        },
      }),
      routerOutput(ctx) {
        const got = ctx.input.question;
        return routeOutput({
          answerMode: 'client_activity_plan',
          replyText:
            got === '我想讲解和练题都有：我需要复习 linked list'
              ? '可以，我按 linked list 安排讲解和练题。'
              : `bad rewrite: ${got}`,
          planningDecision: {
            ...explicitTopicPlan('linked list'),
            resolvedPrompt: got,
          },
          selectedToolIds: ['semantic_router', 'plan_review', 'search_problem_bank'],
          artifacts: [
            {
              kind: 'review_plan',
              id: 'review-linked-list-both',
              title: 'Linked list 讲解 + 练题',
              learningGoal: '先讲清 linked list 的节点关系和指针更新，再接到题库小题。',
              tasks: [
                {
                  title: '讲解 linked list 的节点结构、head/tail 和 next 指针',
                  concepts: ['linked list'],
                  minutes: 12,
                  reason: 'The learner chose explanation plus practice.',
                },
                {
                  title: '用题库小题检查插入、删除和遍历边界',
                  concepts: ['linked list', 'edge cases'],
                  minutes: 18,
                  reason: 'Practice should follow the explanation immediately.',
                  problemIds: ['csc148-linked-list-1', 'csc148-linked-list-2'],
                },
              ],
              focusPoints: [
                {
                  title: 'Reference chain',
                  explanation:
                    'Linked lists encode order by node references, not by contiguous indexes.',
                  checkQuestion: '为什么访问第 k 个节点通常要从 head 开始走？',
                },
                {
                  title: 'Pointer rewiring',
                  explanation:
                    'Insertion and deletion mainly test whether next references are updated in the right order.',
                  checkQuestion: '删除中间节点时，前一个节点的 next 应该指向哪里？',
                },
              ],
              selfChecks: [
                {
                  question: '头部插入为什么是 O(1)？',
                  expectedAnswer: '只改新节点的 next 和 head，不需要遍历整条链。',
                  concept: 'head insertion',
                  difficulty: 'warmup',
                },
                {
                  question: '没有 tail 时尾部插入为什么通常是 O(n)？',
                  expectedAnswer: '必须从 head 走到最后一个节点才能接上新节点。',
                  concept: 'tail insertion',
                  difficulty: 'core',
                },
              ],
              practiceBridge: {
                title: '题库练习',
                summary: '讲解后抽 linked list 题库题检查边界情况。',
                problemIds: ['csc148-linked-list-1', 'csc148-linked-list-2'],
                generatedPrompts: [],
              },
              nextSteps: ['先看两分钟结构图，再做题库题；答错再回到指针更新。'],
            },
          ],
          reason:
            got === '我想讲解和练题都有：我需要复习 linked list'
              ? 'Short both reply was resolved from recent action target.'
              : `Short both reply was not resolved, got ${got}`,
          confidence: got === '我想讲解和练题都有：我需要复习 linked list' ? 0.95 : 0.1,
        });
      },
      expect: {
        answerMode: 'client_activity_plan',
        selectedToolsInclude: ['plan_review', 'search_problem_bank'],
        artifactsInclude: ['review_plan'],
        planningIntent: 'review_plan',
        scopeHint: 'explicit_topic',
        resolvedPrompt: '我想讲解和练题都有：我需要复习 linked list',
        focusTopicsInclude: ['linked list'],
        shouldAskProgressFirst: false,
      },
    },
    {
      id: 'source-evidence-answer-handoff',
      input: baseInput('上传的 benchmark 表格里关键数字是什么？请按原文证据回答。', {
        sourceUploads: [
          {
            id: 'source-contract',
            title: 'Benchmark table',
            kind: 'pdf',
            ragEntryIds: ['rag-contract'],
          },
        ],
      }),
      routerOutput: routeOutput({
        answerMode: 'course_answer',
        selectedToolIds: ['semantic_router', 'search_course_materials', 'answer_course_question'],
        artifacts: [
          {
            kind: 'answer_evidence',
            query: 'benchmark 表格关键数字',
            requiredLookup: 'uploaded_source',
            mustCite: true,
          },
        ],
        handoff: answerHandoff('The learner requested uploaded-source numeric evidence.', [
          'Retrieve uploaded source passages before answering.',
          'Cite the exact table evidence or state that the source evidence is missing.',
        ]),
        reason: 'This is a source-grounded course answer, not a planner or calendar action.',
      }),
      expect: {
        answerMode: 'course_answer',
        selectedToolsInclude: ['search_course_materials', 'answer_course_question'],
        artifactsInclude: ['answer_evidence'],
        handoffsTo: ['course_answerer'],
      },
    },
    {
      id: 'external-current-lookup',
      input: baseInput('帮我查一下现在 Python 最新稳定版是什么。'),
      routerOutput: routeOutput({
        answerMode: 'action_only',
        directCalls: [
          {
            kind: 'web.search',
            label: 'Search current Python release',
            summary: 'Find the latest stable Python release from current external sources.',
            payload: { query: 'latest stable Python release' },
            confirmation: 'none',
          },
        ],
        selectedToolIds: ['semantic_router'],
        reason: 'The learner asked for current external information, so use read-only web search.',
      }),
      expect: {
        answerMode: 'action_only',
        directCallsInclude: ['web.search'],
      },
    },
    {
      id: 'calendar-update-proposal',
      input: baseInput('我今天只有 20 分钟，把原计划压缩一下；如果要改日历，请先让我确认。'),
      routerOutput: routeOutput({
        answerMode: 'action_only',
        proposals: [
          {
            kind: 'calendar.propose_update',
            label: 'Propose compressed calendar activity',
            summary: 'Draft a calendar update for confirmation before changing the schedule.',
            payload: { minutesAvailable: 20 },
            confirmation: 'required',
          },
        ],
        selectedToolIds: ['semantic_router', 'propose_calendar_change'],
        reason:
          'The learner requested a calendar-changing update and explicitly asked for confirmation.',
      }),
      expect: {
        answerMode: 'action_only',
        selectedToolsInclude: ['propose_calendar_change'],
        proposalsInclude: ['calendar.propose_update'],
      },
    },
    {
      id: 'memory-write-proposal',
      input: baseInput(
        '其实我不是完全不会 linked list，我只是分不清什么时候该改 next pointer。请先总结成可确认的薄弱点。',
      ),
      routerOutput: routeOutput({
        answerMode: 'action_only',
        proposals: [
          {
            kind: 'memory.propose_write',
            label: 'Propose linked-list weakness memory',
            summary: 'Record the refined weakness after learner confirmation.',
            payload: {
              memoryType: 'correction',
              weakness: 'Knows linked list basics but confuses next-pointer update timing.',
              nextTeachingMove: 'Contrast insertion/deletion pointer rewiring cases.',
            },
            confirmation: 'required',
          },
        ],
        selectedToolIds: ['semantic_router', 'propose_memory_write'],
        reason:
          'The learner corrected the teaching-control memory and asked for confirmation first.',
      }),
      expect: {
        answerMode: 'action_only',
        selectedToolsInclude: ['propose_memory_write'],
        proposalsInclude: ['memory.propose_write'],
      },
    },
    {
      id: 'ordinary-course-question',
      input: baseInput('我不懂 improper integral 为什么要转成 limit。'),
      routerOutput: routeOutput({
        answerMode: 'course_answer',
        selectedToolIds: ['semantic_router', 'search_course_materials', 'answer_course_question'],
        handoff: answerHandoff('The learner asked a normal course concept question.', [
          'Explain improper integrals using course notation and learner context.',
          'State any missing course-material evidence before using generic explanation.',
        ]),
        reason: 'This should be answered by the course answerer with course evidence.',
      }),
      expect: {
        answerMode: 'course_answer',
        selectedToolsInclude: ['search_course_materials', 'answer_course_question'],
        handoffsTo: ['course_answerer'],
      },
    },
  ];

  fs.mkdirSync(options.outDir, { recursive: true });
  const jsonlPath = path.join(options.outDir, 'results.jsonl');
  fs.writeFileSync(jsonlPath, '');

  const records = [];
  if (contractFailures.length) {
    records.push({ id: 'ai-router-contract-registry', failures: contractFailures });
  }
  records.push(await validateMissingRouterFailure(decideTeachingTurn));
  records.push(await validateConfirmedCalendarAdd(decideTeachingTurn, require));
  records.push(
    await validateShallowReviewPlanFailure(decideTeachingTurn, learnSemanticRouterOutputSchema),
  );
  records.push(
    await validateMissingReviewPlanArtifactFailure(
      decideTeachingTurn,
      learnSemanticRouterOutputSchema,
    ),
  );
  records.push(...validateConversationMergeContracts(require));
  records.push(validateConversationRevisionSourceContract());
  records.push(validateCourseResourceTruthSourceContract());
  records.push(validateLearnTurnTransportSchemaContract(require));
  records.push(validateCourseChatFirstBatchSourceContract());
  records.push(validateCalendarBulkDeleteContract(require));
  records.push(validateStreamingMathComparisonContract(require));

  for (const item of cases) {
    const events = [];
    const decision = await decideTeachingTurn(item.input, {
      runId: `contract-${item.id}`,
      currentDate: '2026-06-28',
      hooks: {
        emit(event) {
          events.push(JSON.parse(JSON.stringify(event)));
        },
      },
      semanticRouter: async (ctx) =>
        learnSemanticRouterOutputSchema.parse(
          typeof item.routerOutput === 'function' ? item.routerOutput(ctx) : item.routerOutput,
        ),
      searchProblemBank: item.searchProblemBank,
    });
    records.push(
      validateDecision({
        id: item.id,
        decision,
        events,
        expect: {
          toolsInclude: ['semantic_router'],
          selectedToolsInclude: [],
          stepsInclude: ['observe_input', 'model_routing'],
          handoffsTo: [],
          directCallsInclude: [],
          proposalsInclude: [],
          artifactsInclude: [],
          focusTopicsInclude: [],
          ...item.expect,
        },
        getLearnCoreTool,
      }),
    );
  }

  for (const record of records) {
    fs.appendFileSync(jsonlPath, `${JSON.stringify(record)}\n`);
    console.log(
      `${record.id}: ${record.failures?.length ? `FAIL ${record.failures.join('; ')}` : 'ok'}`,
    );
  }

  const failureCount = records.filter((record) => record.failures?.length).length;
  const summary = {
    checkCount: records.length,
    failureCount,
    outputs: {
      jsonl: path.relative(ROOT, jsonlPath),
    },
  };
  fs.writeFileSync(
    path.join(options.outDir, 'summary.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  console.log(JSON.stringify(summary, null, 2));
  restore();
  if (failureCount > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
