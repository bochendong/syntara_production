#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';

const ROOT = process.cwd();
const COURSE_ID = 'cmpd5bird007v8ogmjuuiio03';
const COURSE_NAME = 'Introduction to Mathematical Proofs';
const COURSE_CODE = 'MAT 102';
const USER_ID = 'user-dongbochen1218-icloud-com';
const USER_EMAIL = 'dongbochen1218@icloud.com';
const ORCHESTRATOR_ID = 'course-orchestrator';
const ORCHESTRATOR_NAME = '课程总控Agent';
const DEFAULT_BASE_URL = process.env.MAT102_TEST_BASE_URL || 'http://localhost:3000';
const DEFAULT_MODEL =
  process.env.MAT102_TEST_MODEL || process.env.DEFAULT_MODEL || 'openai:gpt-5.6-terra';
const PUBLIC_API_KEY = process.env.SYNTARA_PUBLIC_API_KEY || '';
const RUN_STAMP = new Date().toISOString().replace(/[:.]/g, '-');

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    model: DEFAULT_MODEL,
    outDir: path.join(ROOT, 'tmp', 'mat102-api-journey', RUN_STAMP),
    answerLimit: Number.POSITIVE_INFINITY,
    resume: false,
    refreshProofAnswer: false,
    priorModels: [],
  };
  for (const arg of argv) {
    if (arg === '--') continue;
    if (arg.startsWith('--base-url=')) {
      options.baseUrl = arg.slice('--base-url='.length).replace(/\/$/, '');
    } else if (arg.startsWith('--model=')) {
      options.model = arg.slice('--model='.length);
    } else if (arg.startsWith('--out=')) {
      options.outDir = path.resolve(ROOT, arg.slice('--out='.length));
    } else if (arg.startsWith('--answer-limit=')) {
      options.answerLimit = Math.max(1, Number(arg.slice('--answer-limit='.length)) || 1);
    } else if (arg === '--resume') {
      options.resume = true;
    } else if (arg === '--refresh-proof-answer') {
      options.refreshProofAnswer = true;
    } else if (arg.startsWith('--prior-model=')) {
      options.priorModels.push(arg.slice('--prior-model='.length));
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage:
  pnpm exec dotenv -e .env.local -- node scripts/learn/run-mat102-api-journey.mjs
  ... --out=tmp/mat102-api-journey/manual --answer-limit=3
  ... --out=tmp/mat102-api-journey/manual --resume
  ... --out=tmp/mat102-api-journey/manual --resume --refresh-proof-answer
  ... --out=tmp/mat102-api-journey/manual --resume --prior-model=openai:gpt-4o-mini
`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!PUBLIC_API_KEY) {
  throw new Error(
    'SYNTARA_PUBLIC_API_KEY is required. Run this script through dotenv with .env.local.',
  );
}

fs.mkdirSync(options.outDir, { recursive: true });

const timings = [];
const checks = [];
const answers = [];
const createdConversationIds = [];
const resumedAnswers = new Map();
const modelsUsed = new Set([...options.priorModels, options.model]);

if (options.resume) {
  const fatalPath = path.join(options.outDir, 'fatal-error.json');
  const summaryPath = path.join(options.outDir, 'summary.json');
  const checkpointPath = fs.existsSync(fatalPath)
    ? fatalPath
    : fs.existsSync(summaryPath)
      ? summaryPath
      : null;
  if (checkpointPath) {
    const previous = JSON.parse(fs.readFileSync(checkpointPath, 'utf8'));
    timings.push(...(previous.timings || []));
    checks.push(...(previous.checks || []));
    createdConversationIds.push(...(previous.conversationIds || []));
    for (const model of previous.modelsUsed || [previous.model].filter(Boolean)) {
      modelsUsed.add(model);
    }
  }
  for (const filename of fs.readdirSync(options.outDir)) {
    if (!/^answer-.+\.json$/.test(filename)) continue;
    const record = JSON.parse(fs.readFileSync(path.join(options.outDir, filename), 'utf8'));
    if (!record?.id) continue;
    resumedAnswers.set(record.id, record);
    answers.push(record);
  }
}

function writeJson(name, value) {
  fs.writeFileSync(path.join(options.outDir, name), `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(name) {
  const filePath = path.join(options.outDir, name);
  return fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf8')) : null;
}

function checkPassed(id) {
  return checks.find((check) => check.id === id)?.passed === true;
}

function compactText(value, max = 500) {
  const text = String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function log(message) {
  process.stdout.write(`[MAT102 journey] ${message}\n`);
}

function addCheck(id, passed, detail, evidence = undefined) {
  const next = { id, passed: Boolean(passed), detail, evidence };
  const existingIndex = checks.findIndex((check) => check.id === id);
  if (existingIndex >= 0) {
    checks[existingIndex] = next;
  } else {
    checks.push(next);
  }
  log(`${passed ? 'PASS' : 'FAIL'} ${id}: ${detail}`);
}

async function timed(label, operation) {
  const startedAt = performance.now();
  log(`START ${label}`);
  try {
    const value = await operation();
    const durationMs = Math.round(performance.now() - startedAt);
    timings.push({ label, durationMs, status: 'completed' });
    log(`END ${label}: ${durationMs} ms`);
    return value;
  } catch (error) {
    const durationMs = Math.round(performance.now() - startedAt);
    timings.push({
      label,
      durationMs,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
    log(`ERROR ${label}: ${durationMs} ms`);
    throw error;
  }
}

async function api(pathname, init = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init.timeoutMs || 180_000);
  const isPublic = init.publicApi === true;
  const headers = {
    accept: 'application/json',
    ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...(isPublic
      ? { authorization: `Bearer ${PUBLIC_API_KEY}` }
      : {
          'x-user-id': USER_ID,
          'x-user-email': USER_EMAIL,
          'x-user-name': 'MAT102 API Journey',
        }),
    ...(options.model.startsWith('openai:') ? { 'x-model': options.model } : {}),
    ...(init.headers || {}),
  };
  try {
    const response = await fetch(`${options.baseUrl}${pathname}`, {
      method: init.method || (init.body === undefined ? 'GET' : 'POST'),
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let body = null;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = { raw };
    }
    if (!response.ok) {
      throw new Error(
        `${init.method || (init.body === undefined ? 'GET' : 'POST')} ${pathname} -> ${response.status}: ${compactText(raw, 1000)}`,
      );
    }
    return { status: response.status, headers: Object.fromEntries(response.headers), body };
  } finally {
    clearTimeout(timeout);
  }
}

async function createConversation(title) {
  const response = await api('/api/conversations', {
    body: {
      courseId: COURSE_ID,
      kind: 'agent',
      targetId: ORCHESTRATOR_ID,
      title,
      meta: {
        source: 'mat102-api-journey',
        runStamp: RUN_STAMP,
      },
    },
  });
  const id = response.body?.conversation?.id;
  if (!id) throw new Error('Conversation API did not return an id.');
  createdConversationIds.push(id);
  return id;
}

async function persistMessage(conversationId, role, text, meta = {}) {
  return api(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    body: {
      role,
      content: { type: 'text', text },
      plainText: text,
      meta: {
        source: 'mat102-api-journey',
        runStamp: RUN_STAMP,
        ...meta,
      },
    },
  });
}

async function getCourseFixtures() {
  const [courseResponse, problemResponse, sourceResponse] = await Promise.all([
    timed('fixture.course', () => api(`/api/courses/${COURSE_ID}`)),
    timed('fixture.problems', () => api(`/api/courses/${COURSE_ID}/problems?summary=1`)),
    timed('fixture.sources', () =>
      api(`/api/courses/${COURSE_ID}/source-uploads?includeText=1&includeArtifacts=0`),
    ),
  ]);
  const course = courseResponse.body?.course;
  const problems = problemResponse.body?.problems || [];
  const sources = sourceResponse.body?.uploads || [];
  if (!course || !problems.length) {
    throw new Error('MAT102 course fixture is missing course metadata or problem rows.');
  }
  return { course, problems, sources };
}

function recentMessages(chatMessages) {
  return chatMessages.slice(-10).map((message) => ({
    role: message.role,
    text: message.text,
  }));
}

function problemSamples(problems) {
  return problems
    .filter((problem) => problem.status !== 'archived')
    .slice(0, 12)
    .map((problem) => ({
      id: problem.id,
      title: problem.title,
      type: problem.type,
      status: problem.status,
      tags: problem.tags,
      difficulty: problem.difficulty,
      notebookId: problem.notebookId,
      notebookName: problem.notebookName,
      latestAttempt: problem.latestAttempt,
    }));
}

function sourceUploadSummaries(sources) {
  return sources.slice(0, 20).map((source) => ({
    sourceHash: source.sourceHash,
    title: source.title,
    kind: source.kind,
    topic: source.topic,
    ingestStatus: source.ingestStatus,
    indexStatus: source.indexStatus,
    allQuestionUpload: source.allQuestionUpload,
    notebookIds: source.notebookIds,
  }));
}

async function callLearnTurn(args) {
  return timed(`learn-turn.${args.id}`, () =>
    api('/api/learn/turn', {
      body: {
        question: args.question,
        recentMessages: recentMessages(args.chatMessages || []),
        courseId: COURSE_ID,
        courseName: COURSE_NAME,
        courseCode: COURSE_CODE,
        hasSyllabus: (args.calendarEvents || []).length > 0,
        progressKnown: Boolean(args.learnerSnapshot?.progressKnown),
        learnerSnapshot: args.learnerSnapshot || {},
        calendarEvents: args.calendarEvents || [],
        recentPlans: args.recentPlans || [],
        recentArtifacts: args.recentArtifacts || [],
        recentActions: args.recentActions || [],
        recentActivities: args.recentActivities || [],
        problemBank: {
          available: args.fixtures.problems.some((problem) => problem.status !== 'archived'),
          activeCount: args.fixtures.problems.filter((problem) => problem.status !== 'archived')
            .length,
          samples: problemSamples(args.fixtures.problems),
        },
        resourceStates: {
          notebooks: 'ready',
          problems: 'ready',
          sources: args.fixtures.sources.length ? 'ready' : 'empty',
        },
        sourceUploads: sourceUploadSummaries(args.fixtures.sources),
        layeredMemorySummary: compactText(args.layeredMemorySummary || '', 3800),
      },
    }),
  );
}

async function loadMemoryContext(question, conversationId, id) {
  const params = new URLSearchParams({
    targetType: 'course',
    targetId: COURSE_ID,
    message: question,
    ...(conversationId ? { conversationId } : {}),
  });
  const response = await timed(`memory-context.${id}`, () =>
    api(`/api/memory/context?${params.toString()}`),
  );
  return response.body;
}

function answererHandoff(turn) {
  const trace = turn?.trace;
  const handoff = trace?.handoffs?.find((item) => item?.to === 'course_answerer');
  if (!trace?.runId || !handoff) return undefined;
  return {
    runId: trace.runId,
    intent: handoff.intent || 'course_answer',
    reasonSummary: handoff.reasonSummary || turn.reason || 'Learn-core routed this turn.',
    evidence: (handoff.evidence || [])
      .map((item) => ({
        sourceType: item.sourceType || 'system',
        sourceId: item.sourceId,
        title: item.title,
        quoteOrSummary: item.quoteOrSummary || '',
        supports: item.supports || '',
        confidence: item.confidence,
      }))
      .filter((item) => item.quoteOrSummary || item.supports)
      .slice(0, 8),
    requiredBehavior: (handoff.requiredBehavior || []).filter(Boolean).slice(0, 8),
    forbiddenBehavior: (handoff.forbiddenBehavior || []).filter(Boolean).slice(0, 8),
    missingEvidence: (handoff.missingEvidence || []).filter(Boolean).slice(0, 8),
    resourceStates: handoff.resourceStates,
  };
}

function courseContext(args) {
  const sourceEvidence = args.memoryContext?.sourceEvidence || [];
  const notebooks = sourceEvidence.slice(0, 5).map((source, index) => ({
    id: source.notebookId || source.sourceId || source.id,
    name: source.metadata?.notebookName || source.title || `课程证据 ${index + 1}`,
    pages: [
      {
        id: source.id,
        order: index + 1,
        title: source.title || `课程证据 ${index + 1}`,
        digest: compactText(source.renderedText || source.originalText, 2600),
        sourceScore: Number(source.score || 0),
      },
    ],
    pagesState: { status: 'ready', itemCount: 1 },
    sourceScore: Number(source.score || 0),
  }));
  const analytics = args.memoryContext?.learnerAnalytics;
  return {
    course: {
      id: COURSE_ID,
      name: args.fixtures.course.name || COURSE_NAME,
      description: args.fixtures.course.description,
      language: args.fixtures.course.language || 'zh-CN',
      purpose: args.fixtures.course.purpose,
      tags: args.fixtures.course.tags || [],
      university: args.fixtures.course.university,
      courseCode: args.fixtures.course.courseCode || COURSE_CODE,
    },
    learner: {
      progressKnown: false,
      progressPercent: 0,
      attemptedProblemCount: analytics?.summary?.attemptedProblemCount || 0,
      totalProblemCount: args.fixtures.problems.length,
      dueReviewCount:
        (analytics?.summary?.failedCount || 0) + (analytics?.summary?.partialCount || 0),
      weakConcepts: (analytics?.weakTags || []).map((item) => item.tag),
      nextConcepts: [],
      recentQuestions: (analytics?.messages || []).slice(0, 8).map((item) => item.text),
      recentAttempts: (analytics?.attempts || []).slice(0, 8).map((item) => ({
        title: item.problemTitle,
        status: ['passed', 'partial', 'failed'].includes(item.status) ? item.status : 'partial',
        concepts: item.tags || [],
      })),
      activePlans: [],
    },
    target: {
      kind: 'orchestrator',
      id: ORCHESTRATOR_ID,
      name: ORCHESTRATOR_NAME,
      role: 'teacher',
    },
    notebooks,
    resourceStates: {
      notebooks: { status: 'ready', itemCount: notebooks.length },
      problems: {
        status: args.fixtures.problems.length ? 'ready' : 'empty',
        itemCount: args.fixtures.problems.length,
      },
      sources: {
        status: sourceEvidence.length ? 'ready' : 'empty',
        itemCount: sourceEvidence.length,
      },
    },
    layeredMemory: args.memoryContext,
    answererHandoff: answererHandoff(args.turn),
  };
}

function uiMessage(role, text, id) {
  return {
    id,
    role,
    parts: [{ type: 'text', text }],
    metadata: {
      senderName: role === 'user' ? '你' : ORCHESTRATOR_NAME,
      originalRole: role === 'user' ? 'user' : 'agent',
      createdAt: Date.now(),
    },
  };
}

function parseChatSse(raw) {
  const events = [];
  const messageText = new Map();
  const actions = [];
  for (const block of raw.split('\n\n')) {
    const line = block
      .split('\n')
      .map((item) => item.trim())
      .find((item) => item.startsWith('data: '));
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line.slice(6));
    } catch {
      continue;
    }
    events.push(event);
    if (event.type === 'text_delta') {
      const id = event.data.messageId || 'assistant';
      messageText.set(id, `${messageText.get(id) || ''}${event.data.content || ''}`);
    }
    if (event.type === 'action') actions.push(event.data);
    if (event.type === 'error') {
      throw new Error(`Chat SSE error: ${event.data?.message || 'unknown error'}`);
    }
  }
  return {
    answer: [...messageText.values()].join('\n').trim(),
    actions,
    events,
  };
}

async function callCourseChat(args) {
  return timed(`course-chat.${args.id}`, async () => {
    const response = await fetch(`${options.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': USER_ID,
        'x-user-email': USER_EMAIL,
        'x-user-name': 'MAT102 API Journey',
        ...(options.model.startsWith('openai:') ? { 'x-model': options.model } : {}),
      },
      body: JSON.stringify({
        messages: [
          ...(args.chatMessages || []).map((message, index) =>
            uiMessage(message.role, message.text, `history-${args.id}-${index + 1}`),
          ),
          uiMessage('user', args.question, `question-${args.id}`),
        ],
        storeState: {
          stage: null,
          scenes: [],
          currentSceneId: null,
          mode: 'playback',
          whiteboardOpen: false,
        },
        config: {
          agentIds: [ORCHESTRATOR_ID],
          sessionType: 'qa',
          surface: 'course-chat',
          agentConfigs: [
            {
              id: ORCHESTRATOR_ID,
              name: ORCHESTRATOR_NAME,
              avatar: '',
              role: 'teacher',
              persona:
                '你是课程总控老师。先判断用户的问题应该依据现有资料库正文回答、补充资料，还是综合多份课程来源完成；在直接回答时，要像耐心的课程导师一样讲清概念、步骤、例子和易错点。',
              color: '#7c3aed',
              allowedActions: [],
              priority: 100,
              isGenerated: false,
            },
          ],
        },
        courseContext: courseContext(args),
        userProfile: { nickname: 'MAT102 学生' },
        apiKey: '',
        model: options.model,
      }),
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(`POST /api/chat -> ${response.status}: ${compactText(raw, 1000)}`);
    }
    return parseChatSse(raw);
  });
}

function includesAllGroups(answer, groups) {
  const normalized = answer.normalize('NFKC').toLowerCase();
  return groups.every((group) =>
    group.some((token) => normalized.includes(token.normalize('NFKC').toLowerCase())),
  );
}

function looksComplete(answer) {
  const text = answer.trim();
  if (!text) return false;
  if (/[，,:：；;（(、]$/.test(text)) return false;
  if (/(?:而|并且|以及|但是|因此|所以|因为|则|and|but|because)$/i.test(text)) return false;
  return true;
}

function evaluateProofSanity(answer) {
  const normalized = answer.normalize('NFKC').replace(/\s+/g, ' ');
  const invokesTargetAsPremise =
    /(?:因为|由|根据|已知|利用).{0,30}(?:每个|任意|任何).{0,18}(?:正整数|自然数).{0,50}(?:二进制|2\s*的幂).{0,24}(?:表示|写成)/i.test(
      normalized,
    );
  const hasStrongHypothesis =
    /(?:归纳假设|induction hypothesis).{0,180}(?:(?:所有|任意|每个|every|all).{0,50}(?:小于|less than|<|≤|\\leq?)|1\s*(?:≤|<|\\leq?).{0,12}(?:≤|<|\\leq?)\s*[kn])/i.test(
      normalized,
    );
  const hasLargestPowerReduction =
    /(?:最大.{0,24}(?:2|二).{0,10}幂|largest.{0,24}power|2\s*\^\s*\{?m\}?)/i.test(normalized) &&
    /(?:(?:n|k\s*\+\s*1)\s*[-−]\s*2\s*\^|(?:n|k\s*\+\s*1)\s*=\s*2\s*\^.*\+\s*r|余数|remainder)/i.test(
      normalized,
    ) &&
    /(?:r\s*(?:<|\\lt)\s*2\s*\^|余数.{0,30}小于|remainder.{0,30}less than)/i.test(normalized);
  const hasEvenOddReduction =
    /(?:偶数|even).{0,80}(?:n\s*=\s*2|2m)/i.test(normalized) &&
    /(?:奇数|odd).{0,100}(?:n\s*=\s*2.*\+\s*1|2m\s*\+\s*1)/i.test(normalized) &&
    /(?:m\s*<\s*n|m.{0,20}小于\s*n)/i.test(normalized);
  const preservesDistinctness =
    /(?:不同|互异|不重复|distinct).{0,160}(?:小于|新增|加入|添加|指数|幂|preserv|less than|new)/i.test(
      normalized,
    ) ||
    /(?:小于|新增|加入|添加|指数|幂|preserv|less than|new).{0,160}(?:不同|互异|不重复|distinct)/i.test(
      normalized,
    );
  return {
    passed:
      !invokesTargetAsPremise &&
      hasStrongHypothesis &&
      (hasLargestPowerReduction || hasEvenOddReduction) &&
      preservesDistinctness,
    invokesTargetAsPremise,
    hasStrongHypothesis,
    hasLargestPowerReduction,
    hasEvenOddReduction,
    preservesDistinctness,
  };
}

function evaluateAnswer(testCase, result) {
  const answer = result.answer;
  const coverage = includesAllGroups(answer, testCase.keywordGroups);
  const complete = looksComplete(answer);
  const concise = answer.length <= (testCase.maxChars || 2600);
  const noInternalLeak = !/(hidden prompt|raw json|内部路由|system prompt|工具调用参数)/i.test(
    answer,
  );
  const evidenceCount = result.memoryContext?.counts?.sourceEvidence || 0;
  const grounded = evidenceCount > 0;
  const proofSanity =
    testCase.id === 'problem-explanation' ? evaluateProofSanity(answer) : undefined;
  const score = [coverage, complete, concise, noInternalLeak, grounded].filter(Boolean).length;
  return {
    coverage,
    complete,
    concise,
    noInternalLeak,
    grounded,
    evidenceCount,
    score,
    maxScore: 5,
    charCount: answer.length,
    ...(proofSanity ? { proofSanity } : {}),
  };
}

async function runAnswerCase(testCase, state) {
  const turnResponse = await callLearnTurn({
    ...testCase,
    fixtures: state.fixtures,
    chatMessages: state.chatMessages,
    calendarEvents: state.calendarEvents,
    layeredMemorySummary: state.layeredMemorySummary,
  });
  const turn = turnResponse.body;
  const memoryContext = await loadMemoryContext(
    testCase.question,
    state.conversationId,
    testCase.id,
  );
  const chat = await callCourseChat({
    ...testCase,
    fixtures: state.fixtures,
    turn,
    memoryContext,
    chatMessages: state.chatMessages,
  });
  await persistMessage(state.conversationId, 'user', testCase.question, {
    caseId: testCase.id,
    category: testCase.category,
  });
  await persistMessage(state.conversationId, 'assistant', chat.answer, {
    caseId: testCase.id,
    category: testCase.category,
    routeAnswerMode: turn.answerMode,
    sourceEvidenceCount: memoryContext?.counts?.sourceEvidence || 0,
  });
  state.chatMessages.push({ role: 'user', text: testCase.question });
  state.chatMessages.push({ role: 'assistant', text: chat.answer });
  state.layeredMemorySummary = compactText(memoryContext?.prompt || '', 3600);

  const evaluation = evaluateAnswer(testCase, {
    answer: chat.answer,
    memoryContext,
  });
  const record = {
    ...testCase,
    turn,
    memoryContext: {
      counts: memoryContext?.counts,
      searchIntent: memoryContext?.searchIntent,
      sourceEvidence: (memoryContext?.sourceEvidence || []).slice(0, 8),
      learnerAnalytics: memoryContext?.learnerAnalytics,
    },
    answer: chat.answer,
    actions: chat.actions,
    evaluation,
  };
  const answerIndex = answers.findIndex((answer) => answer.id === record.id);
  if (answerIndex >= 0) {
    answers[answerIndex] = record;
  } else {
    answers.push(record);
  }
  resumedAnswers.set(record.id, record);
  writeJson(`answer-${testCase.id}.json`, record);
  addCheck(
    `answer.${testCase.id}`,
    turn.answerMode === 'course_answer' &&
      evaluation.score >= 4 &&
      chat.answer.length > 0 &&
      evaluation.proofSanity?.passed !== false,
    `route=${turn.answerMode}, quality=${evaluation.score}/5, ${evaluation.charCount} chars`,
    { conversationId: state.conversationId },
  );
  if (evaluation.proofSanity) {
    addCheck(
      'answer.problem-explanation-proof-sanity',
      evaluation.proofSanity.passed,
      `circularPremise=${evaluation.proofSanity.invokesTargetAsPremise}; strongIH=${evaluation.proofSanity.hasStrongHypothesis}; largestPower=${evaluation.proofSanity.hasLargestPowerReduction}; evenOdd=${evaluation.proofSanity.hasEvenOddReduction}; distinctness=${evaluation.proofSanity.preservesDistinctness}`,
      { conversationId: state.conversationId },
    );
  }
  return record;
}

function reevaluateSavedAnswer(testCase, state, resumedRecord) {
  const memoryContext = resumedRecord.memoryContext || {};
  const evaluation = evaluateAnswer(testCase, {
    answer: resumedRecord.answer || '',
    memoryContext,
  });
  const record = {
    ...resumedRecord,
    evaluation,
    evaluatorRefresh: {
      checkedAt: new Date().toISOString(),
      reason: 'Accepted mathematically equivalent induction-variable notation.',
    },
  };
  const answerIndex = answers.findIndex((answer) => answer.id === record.id);
  if (answerIndex >= 0) answers[answerIndex] = record;
  resumedAnswers.set(record.id, record);
  writeJson(`answer-${testCase.id}.json`, record);
  addCheck(
    `answer.${testCase.id}`,
    record.turn?.answerMode === 'course_answer' &&
      evaluation.score >= 4 &&
      record.answer?.length > 0 &&
      evaluation.proofSanity?.passed === true,
    `route=${record.turn?.answerMode}, re-evaluated quality=${evaluation.score}/5, proofSanity=${evaluation.proofSanity?.passed === true}, ${evaluation.charCount} chars`,
    { conversationId: state.conversationId, evaluatorRefresh: true },
  );
  addCheck(
    'answer.problem-explanation-proof-sanity',
    evaluation.proofSanity?.passed === true,
    `circularPremise=${evaluation.proofSanity?.invokesTargetAsPremise}; strongIH=${evaluation.proofSanity?.hasStrongHypothesis}; largestPower=${evaluation.proofSanity?.hasLargestPowerReduction}; evenOdd=${evaluation.proofSanity?.hasEvenOddReduction}; distinctness=${evaluation.proofSanity?.preservesDistinctness}`,
    { conversationId: state.conversationId, evaluatorRefresh: true },
  );
  return record;
}

async function refreshSavedAnswer(testCase, state, resumedRecord) {
  const turnResponse = await callLearnTurn({
    ...testCase,
    fixtures: state.fixtures,
    chatMessages: state.chatMessages,
    calendarEvents: state.calendarEvents,
    layeredMemorySummary: state.layeredMemorySummary,
  });
  const turn = turnResponse.body;
  const memoryContext = {
    counts: resumedRecord.memoryContext?.counts,
    searchIntent: resumedRecord.memoryContext?.searchIntent,
    sourceEvidence: resumedRecord.memoryContext?.sourceEvidence || [],
    learnerAnalytics: resumedRecord.memoryContext?.learnerAnalytics,
  };
  const chat = await callCourseChat({
    ...testCase,
    fixtures: state.fixtures,
    turn,
    memoryContext,
    chatMessages: state.chatMessages,
  });
  await persistMessage(state.conversationId, 'user', testCase.question, {
    caseId: testCase.id,
    category: testCase.category,
    proofRefresh: true,
  });
  await persistMessage(state.conversationId, 'assistant', chat.answer, {
    caseId: testCase.id,
    category: testCase.category,
    routeAnswerMode: turn.answerMode,
    sourceEvidenceCount: memoryContext?.counts?.sourceEvidence || 0,
    proofRefresh: true,
  });
  const evaluation = evaluateAnswer(testCase, { answer: chat.answer, memoryContext });
  const record = {
    ...resumedRecord,
    ...testCase,
    turn,
    memoryContext,
    answer: chat.answer,
    actions: chat.actions,
    evaluation,
    proofRefresh: {
      checkedAt: new Date().toISOString(),
      model: options.model,
      reusedSavedEvidence: true,
      previousAnswer: resumedRecord.answer,
    },
  };
  const answerIndex = answers.findIndex((answer) => answer.id === record.id);
  if (answerIndex >= 0) answers[answerIndex] = record;
  else answers.push(record);
  resumedAnswers.set(record.id, record);
  writeJson(`answer-${testCase.id}.json`, record);
  addCheck(
    `answer.${testCase.id}`,
    turn.answerMode === 'course_answer' &&
      evaluation.score >= 4 &&
      chat.answer.length > 0 &&
      evaluation.proofSanity?.passed === true,
    `route=${turn.answerMode}, refreshed quality=${evaluation.score}/5, proofSanity=${evaluation.proofSanity?.passed === true}, ${evaluation.charCount} chars`,
    { conversationId: state.conversationId, proofRefresh: true },
  );
  addCheck(
    'answer.problem-explanation-proof-sanity',
    evaluation.proofSanity?.passed === true,
    `circularPremise=${evaluation.proofSanity?.invokesTargetAsPremise}; strongIH=${evaluation.proofSanity?.hasStrongHypothesis}; largestPower=${evaluation.proofSanity?.hasLargestPowerReduction}; evenOdd=${evaluation.proofSanity?.hasEvenOddReduction}; distinctness=${evaluation.proofSanity?.preservesDistinctness}`,
    { conversationId: state.conversationId, proofRefresh: true },
  );
  return record;
}

async function rerunAnswerRouteOnly(testCase, state, resumedRecord) {
  const turnResponse = await callLearnTurn({
    ...testCase,
    fixtures: state.fixtures,
    chatMessages: state.chatMessages,
    calendarEvents: state.calendarEvents,
    layeredMemorySummary: state.layeredMemorySummary,
  });
  const turn = turnResponse.body;
  const record = {
    ...resumedRecord,
    turn,
    routeRegression: {
      checkedAt: new Date().toISOString(),
      reusedSavedAnswer: true,
      reason:
        'The saved answer and source evidence already passed quality checks; only the corrected routing contract was re-executed.',
    },
  };
  const answerIndex = answers.findIndex((answer) => answer.id === record.id);
  if (answerIndex >= 0) answers[answerIndex] = record;
  resumedAnswers.set(record.id, record);
  writeJson(`answer-${testCase.id}.json`, record);
  addCheck(
    `answer.${testCase.id}`,
    turn.answerMode === 'course_answer' &&
      resumedRecord.evaluation?.score >= 4 &&
      resumedRecord.answer?.length > 0,
    `route=${turn.answerMode}, reused saved quality=${resumedRecord.evaluation?.score || 0}/5, ${resumedRecord.answer?.length || 0} chars`,
    { conversationId: state.conversationId, routeRegression: true },
  );
  return record;
}

async function runWeaknessRecall(state) {
  const conversationId = await createConversation(`MAT102 跨对话薄弱点验收 ${RUN_STAMP}`);
  const question =
    '请只根据我在 MAT102 其他对话里的提问和作答记录，判断我目前最可能的薄弱点。区分“有直接证据”和“仅推测”，不要把单纯提问当成已经做错。';
  await persistMessage(conversationId, 'user', question, { caseId: 'weakness-new-conversation' });
  const response = await timed('memory-search.weakness-new-conversation', () =>
    api('/api/memory/search', {
      body: {
        targetType: 'course',
        targetId: COURSE_ID,
        query: question,
        conversationId,
      },
    }),
  );
  const body = response.body;
  await persistMessage(conversationId, 'assistant', body.answer || '', {
    caseId: 'weakness-new-conversation',
    source: 'memory-search',
  });
  const messages = body?.learnerAnalytics?.messages || [];
  const previousConversationSeen = messages.some(
    (message) => message.conversationId === state.conversationId,
  );
  const cautious = /(证据|提问|不能|不足|推测|尚不能|不等于)/.test(body.answer || '');
  const inductionSeen = /(归纳|P\\(k\\)|P\\(k\\+1\\))/i.test(body.answer || '');
  const record = {
    conversationId,
    question,
    answer: body.answer,
    intent: body.intent,
    counts: body.counts,
    previousConversationSeen,
    sourceConversationId: state.conversationId,
    learnerAnalytics: body.learnerAnalytics,
  };
  writeJson('weakness-new-conversation.json', record);
  addCheck(
    'memory.cross-conversation-weakness',
    previousConversationSeen && cautious && inductionSeen,
    `previousConversationSeen=${previousConversationSeen}, cautious=${cautious}, inductionSeen=${inductionSeen}`,
    { conversationId },
  );
  return record;
}

function selectedProblemButtons(search) {
  return (search?.matches || []).map((match) => ({
    type: 'problem_button',
    problemId: match.problemId,
    label: match.title,
    href: `/course/${encodeURIComponent(COURSE_ID)}/problem-bank/${encodeURIComponent(
      match.problemId,
    )}`,
    reason: match.reason,
    difficulty: match.difficulty,
    tags: match.tags,
  }));
}

async function verifyProblemButtons(buttons) {
  const results = [];
  for (const button of buttons) {
    const response = await timed(`problem-detail.${button.problemId}`, () =>
      api(`/api/courses/${COURSE_ID}/problems/${encodeURIComponent(button.problemId)}`),
    );
    results.push({
      ...button,
      httpStatus: response.status,
      actualTitle: response.body?.problem?.title,
      exists: response.body?.problem?.id === button.problemId,
    });
  }
  return results;
}

async function runPracticeSelection(state, weakness) {
  const question =
    '我想练题目：数学归纳法，优先检验我刚才暴露出的归纳假设与归纳步骤混淆。请只用真实题库题，并说明每题为什么适合。';
  const response = await callLearnTurn({
    id: 'practice-induction',
    question,
    fixtures: state.fixtures,
    chatMessages: [
      { role: 'user', text: weakness.question },
      { role: 'assistant', text: weakness.answer || '' },
    ],
    calendarEvents: state.calendarEvents,
    layeredMemorySummary: weakness.answer || '',
  });
  const turn = response.body;
  const search = turn?.planningDecision?.problemBankSearch;
  const buttons = selectedProblemButtons(search);
  const verifiedButtons = await verifyProblemButtons(buttons);
  const hasReasons = verifiedButtons.every((button) => Boolean(button.reason?.trim()));
  const allReal = verifiedButtons.length > 0 && verifiedButtons.every((button) => button.exists);
  const topicRelevant = verifiedButtons.some((button) =>
    /归纳|induction|binary|递归|structural/i.test(
      `${button.label} ${(button.tags || []).join(' ')} ${button.reason}`,
    ),
  );
  const record = {
    question,
    turn,
    apiShape: {
      answerMode: turn.answerMode,
      planningIntent: turn?.planningDecision?.intent,
      search,
      buttons: verifiedButtons,
      frontendRendering:
        'The API returns problemId/title/reason; the frontend maps each item to a clickable problem button/card using href.',
    },
  };
  writeJson('practice-induction.json', record);
  addCheck(
    'practice.real-buttons-with-reasons',
    turn.answerMode === 'client_practice_plan' &&
      search?.source === 'problem_bank_full_text' &&
      allReal &&
      hasReasons &&
      topicRelevant,
    `${verifiedButtons.length} verified real problems; reasons=${hasReasons}; topicRelevant=${topicRelevant}`,
  );
  return record;
}

async function runNoMatchPractice(state) {
  const question = '我想练题目：测度论中的 Radon-Nikodym 定理';
  const response = await callLearnTurn({
    id: 'practice-no-match',
    question,
    fixtures: state.fixtures,
    chatMessages: [],
    calendarEvents: [],
    layeredMemorySummary: '',
  });
  const turn = response.body;
  const matches = turn?.planningDecision?.problemBankSearch?.matches || [];
  const noInventedAction =
    !(turn.proposals || []).some((action) => action.kind === 'practice.propose_generation') &&
    turn.answerMode === 'action_only';
  writeJson('practice-no-match.json', { question, turn });
  addCheck(
    'practice.no-invented-out-of-scope-question',
    matches.length === 0 && noInventedAction,
    `matches=${matches.length}, answerMode=${turn.answerMode}, noProposal=${noInventedAction}`,
  );
}

async function publicReviewPlan(id, query, conversationId, scheduleEvents) {
  const response = await timed(`review-plan.${id}`, () =>
    api('/api/v1/review-plans', {
      publicApi: true,
      body: {
        target_type: 'course',
        target_id: COURSE_ID,
        query,
        conversation_id: conversationId,
        schedule_events: scheduleEvents.map((event) => ({
          id: event.id,
          title: event.title,
          date: event.date,
          kind: event.kind,
          source_name: event.source_name || event.sourceName,
          notes: event.raw_text || event.rawText,
        })),
        constraints: {
          total_minutes: 60,
          question_count: 4,
          max_tasks: 4,
          today: '2026-07-24',
        },
      },
    }),
  );
  return response.body?.data;
}

function reviewArtifact(planData) {
  const output = planData?.decision?.output;
  return {
    kind: 'review_plan',
    id: planData?.id || `review-plan-${RUN_STAMP}`,
    title: 'MAT102 三天复习计划',
    learningGoal: output?.summary,
    tasks: (output?.tasks || []).map((task) => ({
      title: task.title,
      concepts: task.concepts,
      minutes: task.minutes,
      reason: task.reason,
    })),
    calendarDraftItems: (output?.tasks || []).map((task, index) => ({
      id: `calendar-draft-${index + 1}`,
      title: task.title,
      date: `2026-07-${String(25 + Math.min(index, 2)).padStart(2, '0')}`,
      durationMinutes: task.minutes,
      courseId: COURSE_ID,
      reason: task.reason,
    })),
    focusPoints: (planData?.decision?.targetConcepts || []).slice(0, 4).map((concept) => ({
      title: concept,
    })),
    selfChecks: [],
    practiceBridge: {
      title: '真实题库练习',
      summary: output?.summary,
      problemIds: (output?.questionCandidates || []).map((item) => item.problemId),
      generatedPrompts: [],
    },
    nextSteps: ['完成后根据错题重新评估薄弱点。'],
  };
}

function reviewEvidenceItems(planData) {
  const evidence = planData?.decision?.evidence;
  if (Array.isArray(evidence)) return evidence;
  if (Array.isArray(evidence?.items)) return evidence.items;
  if (Array.isArray(evidence?.selected)) return evidence.selected;
  return [];
}

async function executeCalendarProposal(calendar, rawProposal, id) {
  const proposal = {
    id: rawProposal.id || `calendar-proposal-${id}-${RUN_STAMP}`,
    kind: rawProposal.kind,
    label: rawProposal.label,
    summary: rawProposal.summary || '',
    payload: rawProposal.payload || {},
    confirmation: 'required',
  };
  const preview = await timed(`calendar.${id}.preview`, () =>
    api('/api/v1/calendars/commands', {
      publicApi: true,
      body: { proposal, confirm: false, calendar },
    }),
  );
  const previewData = preview.body?.data;
  const unchangedBeforeConfirmation =
    JSON.stringify(previewData?.calendar?.events || []) === JSON.stringify(calendar.events || []);
  const execution = await timed(`calendar.${id}.confirm`, () =>
    api('/api/v1/calendars/commands', {
      publicApi: true,
      body: { proposal, confirm: true, calendar },
    }),
  );
  return {
    preview: previewData,
    execution: execution.body?.data,
    unchangedBeforeConfirmation,
  };
}

async function runPlanAndCalendar(state, weakness) {
  const query =
    '根据我最近关于归纳假设、强归纳和结构归纳的提问，制定未来三天的 MAT102 复习计划，包含真实题库题目并说明理由。';
  const before = await publicReviewPlan(
    'before-calendar',
    query,
    weakness.conversationId,
    state.calendarEvents,
  );
  writeJson('review-plan-before-calendar.json', before);
  const beforeQuestions = before?.decision?.output?.questionCandidates || [];
  const beforeReal = (
    await verifyProblemButtons(
      beforeQuestions.map((question) => ({
        type: 'problem_button',
        problemId: question.problemId,
        label: question.title,
        href: question.href,
        reason: question.reason,
        difficulty: question.difficulty,
        tags: question.tags,
      })),
    )
  ).every((item) => item.exists && item.reason);
  const conversationEvidence = reviewEvidenceItems(before).some(
    (item) => item.sourceType === 'conversation',
  );
  const weaknessRelevant =
    beforeQuestions.length > 0 &&
    beforeQuestions.every((question) =>
      /归纳|induction|binary|recursive|postage|powers of 2/i.test(
        `${question.title} ${(question.tags || []).join(' ')} ${question.reason}`,
      ),
    );
  addCheck(
    'plan.evidence-and-real-questions',
    beforeQuestions.length > 0 && beforeReal && conversationEvidence && weaknessRelevant,
    `${beforeQuestions.length} questions; allReal=${beforeReal}; conversationEvidence=${conversationEvidence}; weaknessRelevant=${weaknessRelevant}`,
  );

  const artifact = reviewArtifact(before);
  const addTurnResponse = await callLearnTurn({
    id: 'plan-followup-add-calendar',
    question: '把刚才这份三天复习计划添加到学习日历。',
    fixtures: state.fixtures,
    chatMessages: [
      { role: 'user', text: query },
      { role: 'assistant', text: before?.decision?.output?.summary || '已生成复习计划。' },
    ],
    recentArtifacts: [artifact],
    calendarEvents: state.calendarEvents,
    layeredMemorySummary: weakness.answer || '',
  });
  const addTurn = addTurnResponse.body;
  const addProposal = [...(addTurn.proposals || []), ...(addTurn.directCalls || [])].find(
    (action) => action.kind === 'calendar.propose_add',
  );
  writeJson('plan-followup-add-calendar-turn.json', addTurn);
  addCheck(
    'plan.followup-calendar-proposal',
    Boolean(addProposal && addProposal.confirmation === 'required'),
    addProposal
      ? `${addProposal.kind}; confirmation=${addProposal.confirmation}`
      : 'No calendar.propose_add action returned.',
  );

  if (!addProposal) {
    return { before, artifact, calendarAfterPlan: state.calendarEvents, addTurn };
  }
  const planCalendar = await executeCalendarProposal(
    {
      id: 'mat102-api-journey',
      timezone: 'Asia/Shanghai',
      events: state.calendarEvents,
    },
    addProposal,
    'add-plan',
  );
  state.calendarEvents = planCalendar.execution?.calendar?.events || [];
  writeJson('calendar-add-plan.json', planCalendar);
  addCheck(
    'calendar.plan-add-confirmation-safety',
    planCalendar.unchangedBeforeConfirmation && state.calendarEvents.length > 0,
    `unchangedBeforeConfirmation=${planCalendar.unchangedBeforeConfirmation}; added=${state.calendarEvents.length}`,
  );
  return { before, artifact, calendarAfterPlan: state.calendarEvents, addTurn };
}

async function clearCalendar(state) {
  const eventIds = state.calendarEvents.map((event) => event.id);
  if (eventIds.length === 0) {
    addCheck(
      'calendar.api-clear',
      false,
      'No calendar events existed after the plan add, so no destructive empty-target request was sent.',
    );
    return;
  }
  const result = await executeCalendarProposal(
    {
      id: 'mat102-api-journey',
      timezone: 'Asia/Shanghai',
      events: state.calendarEvents,
    },
    {
      kind: 'calendar.propose_delete',
      label: '清空 MAT102 API 测试日历',
      summary: `删除当前 ${eventIds.length} 个模拟事件。`,
      payload: { eventIds, requiresConfirmation: true },
    },
    'clear',
  );
  state.calendarEvents = result.execution?.calendar?.events || [];
  writeJson('calendar-clear.json', result);
  addCheck(
    'calendar.api-clear',
    eventIds.length > 0 &&
      result.unchangedBeforeConfirmation &&
      result.execution?.changed_events?.length === eventIds.length &&
      state.calendarEvents.length === 0,
    `before=${eventIds.length}, changed=${result.execution?.changed_events?.length || 0}, after=${state.calendarEvents.length}`,
  );
}

async function naturalLanguageCalendarAdd(state) {
  const instruction =
    '请把这些模拟安排加入日历：2026-07-25 10:00 看牙医 60 分钟；2026-07-26 14:00 到 18:00 兼职；2026-07-28 MAT102 归纳法作业截止；2026-07-30 19:00 到 21:00 家庭聚会。这些都是模拟数据。';
  const calendar = {
    id: 'mat102-api-journey',
    timezone: 'Asia/Shanghai',
    events: state.calendarEvents,
  };
  const proposalResponse = await timed('calendar.natural-language-add.propose', () =>
    api('/api/v1/calendars/commands', {
      publicApi: true,
      body: {
        instruction,
        course_id: COURSE_ID,
        course_name: COURSE_NAME,
        calendar,
      },
      timeoutMs: 150_000,
    }),
  );
  const proposalData = proposalResponse.body?.data;
  const proposal = proposalData?.proposal;
  const unchangedBeforeConfirmation =
    JSON.stringify(proposalData?.calendar?.events || []) === JSON.stringify(calendar.events);
  if (!proposal) throw new Error('Natural-language calendar add did not return a proposal.');
  const executionResponse = await timed('calendar.natural-language-add.confirm', () =>
    api('/api/v1/calendars/commands', {
      publicApi: true,
      body: {
        proposal,
        confirm: true,
        calendar,
      },
    }),
  );
  const execution = executionResponse.body?.data;
  state.calendarEvents = execution?.calendar?.events || [];
  const record = { instruction, proposal: proposalData, execution, unchangedBeforeConfirmation };
  writeJson('calendar-natural-language-add.json', record);
  const titles = state.calendarEvents.map((event) => event.title).join(' ');
  addCheck(
    'calendar.natural-language-add',
    unchangedBeforeConfirmation && state.calendarEvents.length >= 3 && /MAT102|归纳/.test(titles),
    `unchangedBeforeConfirmation=${unchangedBeforeConfirmation}; after=${state.calendarEvents.length}; titles=${compactText(titles, 300)}`,
  );
  return record;
}

async function replanAgainstCalendar(state, beforePlan, weakness) {
  const query =
    '请根据我当前的新日历重新安排未来一周的 MAT102 复习；优先解决归纳假设与归纳步骤的混淆，并避开看牙、兼职和家庭聚会。';
  const after = await publicReviewPlan(
    'after-calendar',
    query,
    weakness.conversationId,
    state.calendarEvents,
  );
  writeJson('review-plan-after-calendar.json', after);
  const output = after?.decision?.output;
  const beforeOutput = beforePlan?.decision?.output;
  const hasScheduleEvidence = reviewEvidenceItems(after).some(
    (item) => item.sourceType === 'schedule',
  );
  const mentionsSchedule =
    Boolean(output?.scheduleSummary) &&
    /(MAT102|归纳|兼职|牙医|家庭|截止|安排)/.test(
      `${output.scheduleSummary} ${(output.rationale || []).join(' ')}`,
    );
  const changed =
    JSON.stringify({
      schedule: output?.scheduleSummary,
      rationale: output?.rationale,
      targets: after?.decision?.targetConcepts,
    }) !==
    JSON.stringify({
      schedule: beforeOutput?.scheduleSummary,
      rationale: beforeOutput?.rationale,
      targets: beforePlan?.decision?.targetConcepts,
    });
  addCheck(
    'plan.replanned-against-new-calendar',
    hasScheduleEvidence && mentionsSchedule && changed,
    `scheduleEvidence=${hasScheduleEvidence}; mentionsSchedule=${mentionsSchedule}; changed=${changed}; summary=${compactText(output?.scheduleSummary, 240)}`,
  );
  return after;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
}

function markdownReport(summary) {
  const lines = [
    '# MAT102 API 全链路验收报告',
    '',
    `- Run: \`${RUN_STAMP}\``,
    `- Course: \`${COURSE_ID}\` — ${COURSE_NAME}`,
    `- User: \`${USER_ID}\``,
    `- Models used: ${summary.modelsUsed.map((model) => `\`${model}\``).join(', ')}`,
    `- Timed operations recorded across resumable run: ${summary.timings.length}`,
    `- Checks: ${summary.passed}/${summary.total} passed`,
    '',
    '## 检查结果',
    '',
    '| 检查 | 结果 | 说明 |',
    '|---|---:|---|',
    ...checks.map(
      (check) =>
        `| ${check.id} | ${check.passed ? 'PASS' : 'FAIL'} | ${String(check.detail).replace(/\|/g, '\\|')} |`,
    ),
    '',
    '## 回答质量',
    '',
    '| 用例 | 类别 | 质量 | 字数 | 完整 | 有原始证据 |',
    '|---|---|---:|---:|---:|---:|',
    ...answers.map(
      (answer) =>
        `| ${answer.id} | ${answer.category} | ${answer.evaluation.score}/${answer.evaluation.maxScore} | ${answer.evaluation.charCount} | ${answer.evaluation.complete ? '是' : '否'} | ${answer.evaluation.grounded ? `是 (${answer.evaluation.evidenceCount})` : '否'} |`,
    ),
    '',
    '## 耗时',
    '',
    `- Median: ${summary.latency.medianMs} ms`,
    `- P90: ${summary.latency.p90Ms} ms`,
    `- Max: ${summary.latency.maxMs} ms`,
    '',
    '| 调用 | 状态 | 耗时 ms |',
    '|---|---:|---:|',
    ...timings.map((timing) => `| ${timing.label} | ${timing.status} | ${timing.durationMs} |`),
    '',
    '## 持久化验收对话',
    '',
    ...createdConversationIds.map((id) => `- \`${id}\``),
    '',
    '完整请求、响应、题目按钮、计划证据和日历状态见同目录 JSON 文件。',
    '',
  ];
  return lines.join('\n');
}

async function main() {
  log(`Output: ${options.outDir}`);
  const cachedFixtures = options.resume ? readJson('fixtures-data.json') : null;
  const fixtures = cachedFixtures || (await getCourseFixtures());
  if (cachedFixtures) {
    log('SKIP fixtures: loaded from resume artifacts');
  } else {
    writeJson('fixtures-data.json', fixtures);
  }
  writeJson('fixtures-summary.json', {
    course: fixtures.course,
    problemCount: fixtures.problems.length,
    problemStatusCounts: Object.groupBy
      ? Object.fromEntries(
          Object.entries(Object.groupBy(fixtures.problems, (problem) => problem.status)).map(
            ([status, rows]) => [status, rows.length],
          ),
        )
      : fixtures.problems.reduce((counts, problem) => {
          counts[problem.status] = (counts[problem.status] || 0) + 1;
          return counts;
        }, {}),
    sourceCount: fixtures.sources.length,
  });
  addCheck(
    'fixture.live-mat102',
    fixtures.course.id === COURSE_ID && fixtures.problems.length > 0,
    `${fixtures.problems.length} real problem rows and ${fixtures.sources.length} source uploads`,
  );

  const resumedConversationId = checks.find(
    (check) => check.id.startsWith('answer.') && check.evidence?.conversationId,
  )?.evidence?.conversationId;
  const conversationId =
    resumedConversationId || (await createConversation(`MAT102 全链路问答验收 ${RUN_STAMP}`));
  const state = {
    fixtures,
    conversationId,
    chatMessages: [],
    layeredMemorySummary: '',
    calendarEvents: [],
  };

  const answerCases = [
    {
      id: 'knowledge-ordinary-induction',
      category: 'knowledge',
      question:
        '用不超过 500 字解释普通数学归纳法中的“归纳假设”是什么，以及它和“归纳步骤”有什么区别。不要把 P(k) 与 P(k+1) 混为一谈。',
      keywordGroups: [['归纳假设'], ['归纳步', '归纳步骤'], ['P(k)'], ['P(k+1)']],
      maxChars: 1800,
    },
    {
      id: 'knowledge-structural-induction',
      category: 'knowledge',
      question:
        '解释结构归纳法为什么适合递归定义的对象，并给出一个 MAT102 风格的小例子。请明确基础对象和构造规则。',
      keywordGroups: [['结构归纳'], ['递归'], ['基础'], ['构造']],
      maxChars: 2200,
    },
    {
      id: 'knowledge-equivalence-relation',
      category: 'knowledge',
      question:
        '解释等价关系的自反、对称、传递分别在等价类划分中起什么作用，并指出缺少其中任意一条会发生什么。',
      keywordGroups: [['自反'], ['对称'], ['传递'], ['等价类', '划分']],
      maxChars: 2400,
    },
    {
      id: 'question-misconception',
      category: 'question',
      question:
        '我认为归纳假设就是先假设 P(k+1) 成立，再倒推 P(k)，这样理解对吗？请直接判断并解释错误发生在哪里。',
      keywordGroups: [['不对', '错误', '不是'], ['P(k)'], ['P(k+1)'], ['归纳假设']],
      maxChars: 1800,
    },
    {
      id: 'question-postage',
      category: 'question',
      question:
        '在 3 分和 5 分邮票的强归纳证明中，为什么要验证 8、9、10 三个基础情形，而不是只验证 8？',
      keywordGroups: [['8'], ['9'], ['10'], ['3', '减去 3', '模 3']],
      maxChars: 2200,
    },
    {
      id: 'question-injective-preimage',
      category: 'question',
      question:
        '若 f:A→B 是单射，为什么对每个 S⊆A 都有 f⁻¹(f(S))=S？如果只知道 f 满射，这个等式还成立吗？',
      keywordGroups: [['单射'], ['满射'], ['包含', '⊆'], ['原像', 'f⁻¹']],
      maxChars: 2400,
    },
  ].slice(0, options.answerLimit);

  for (const testCase of answerCases) {
    const resumed = resumedAnswers.get(testCase.id);
    if (!resumed) continue;
    state.chatMessages.push({ role: 'user', text: resumed.question });
    state.chatMessages.push({ role: 'assistant', text: resumed.answer });
    state.layeredMemorySummary = compactText(
      resumed.memoryContext?.sourceEvidence
        ?.map((item) => item.renderedText || item.originalText || item.title)
        .filter(Boolean)
        .join('\n') || state.layeredMemorySummary,
      3600,
    );
  }

  for (const testCase of answerCases) {
    if (resumedAnswers.has(testCase.id)) {
      log(`SKIP answer.${testCase.id}: loaded from resume artifacts`);
      continue;
    }
    await runAnswerCase(testCase, state);
  }

  const problemExplanationCase = {
    id: 'problem-explanation',
    category: 'problem_explanation',
    question: '',
    keywordGroups: [['强归纳', 'strong induction'], ['归纳假设'], ['较小', '缩小', 'k'], ['证明']],
    maxChars: 2600,
  };
  if (options.resume && resumedAnswers.has('problem-explanation')) {
    const resumed = resumedAnswers.get('problem-explanation');
    reevaluateSavedAnswer(
      {
        ...problemExplanationCase,
        question: resumed.question,
      },
      state,
      resumed,
    );
  }
  if (options.refreshProofAnswer && resumedAnswers.has('problem-explanation')) {
    const resumed = resumedAnswers.get('problem-explanation');
    await refreshSavedAnswer(
      {
        ...problemExplanationCase,
        question: resumed.question,
      },
      state,
      resumed,
    );
  } else if (options.resume && checkPassed('answer.problem-explanation')) {
    log('SKIP answer.problem-explanation: loaded from resume artifacts');
  } else if (options.resume && resumedAnswers.has('problem-explanation')) {
    const resumed = resumedAnswers.get('problem-explanation');
    await rerunAnswerRouteOnly(
      {
        ...problemExplanationCase,
        question: resumed.question,
      },
      state,
      resumed,
    );
  } else {
    const inductionProblem =
      fixtures.problems.find((problem) => problem.id === 'cmrytbx1n00057z87y6cdl2dj') ||
      fixtures.problems.find((problem) => /binary representation/i.test(problem.title)) ||
      fixtures.problems.find((problem) => /归纳|induction/i.test(problem.title));
    if (!inductionProblem) throw new Error('No induction problem is available for explanation.');
    const detailResponse = await timed('problem-explanation.fixture', () =>
      api(`/api/courses/${COURSE_ID}/problems/${inductionProblem.id}`),
    );
    const problemTitle = detailResponse.body?.problem?.title || inductionProblem.title;
    await runAnswerCase(
      {
        ...problemExplanationCase,
        question: `请讲解真实题库题「${problemTitle}」的证明思路。先解释为什么适合强归纳，再说明归纳步骤怎样把目标缩小；不要只给最终结论。`,
      },
      state,
    );
  }

  const resumedWeakness =
    options.resume && checkPassed('memory.cross-conversation-weakness')
      ? readJson('weakness-new-conversation.json')
      : null;
  const weakness = resumedWeakness || (await runWeaknessRecall(state));
  if (resumedWeakness) log('SKIP memory.cross-conversation-weakness: loaded from resume artifacts');

  const resumedPractice =
    options.resume && checkPassed('practice.real-buttons-with-reasons')
      ? readJson('practice-induction.json')
      : null;
  const practice = resumedPractice || (await runPracticeSelection(state, weakness));
  if (resumedPractice) log('SKIP practice.real-buttons-with-reasons: loaded from resume artifacts');

  if (options.resume && checkPassed('practice.no-invented-out-of-scope-question')) {
    log('SKIP practice.no-invented-out-of-scope-question: loaded from resume artifacts');
  } else {
    await runNoMatchPractice(state);
  }
  const canResumePlan =
    options.resume &&
    checkPassed('plan.evidence-and-real-questions') &&
    checkPassed('plan.followup-calendar-proposal') &&
    checkPassed('calendar.plan-add-confirmation-safety');
  let planState;
  if (canResumePlan) {
    const before = readJson('review-plan-before-calendar.json');
    const addTurn = readJson('plan-followup-add-calendar-turn.json');
    const planCalendar = readJson('calendar-add-plan.json');
    state.calendarEvents = planCalendar?.execution?.calendar?.events || [];
    planState = {
      before,
      artifact: reviewArtifact(before),
      calendarAfterPlan: state.calendarEvents,
      addTurn,
    };
    log('SKIP plan and calendar add: loaded from resume artifacts');
  } else {
    planState = await runPlanAndCalendar(state, weakness);
  }

  if (options.resume && checkPassed('calendar.api-clear')) {
    state.calendarEvents = [];
    log('SKIP calendar.api-clear: loaded from resume artifacts');
  } else {
    await clearCalendar(state);
  }

  const resumedNaturalCalendar =
    options.resume && checkPassed('calendar.natural-language-add')
      ? readJson('calendar-natural-language-add.json')
      : null;
  if (resumedNaturalCalendar) {
    state.calendarEvents = resumedNaturalCalendar?.execution?.calendar?.events || [];
    log('SKIP calendar.natural-language-add: loaded from resume artifacts');
  } else {
    await naturalLanguageCalendarAdd(state);
  }

  const replanned =
    options.resume && checkPassed('plan.replanned-against-new-calendar')
      ? readJson('review-plan-after-calendar.json')
      : await replanAgainstCalendar(state, planState.before, weakness);
  if (options.resume && checkPassed('plan.replanned-against-new-calendar')) {
    log('SKIP plan.replanned-against-new-calendar: loaded from resume artifacts');
  }

  const durationValues = timings.map((timing) => timing.durationMs);
  const summary = {
    runStamp: RUN_STAMP,
    courseId: COURSE_ID,
    userId: USER_ID,
    model: options.model,
    modelsUsed: [...modelsUsed],
    outputDir: options.outDir,
    total: checks.length,
    passed: checks.filter((check) => check.passed).length,
    failed: checks.filter((check) => !check.passed).length,
    checks,
    answers: answers.map((answer) => ({
      id: answer.id,
      category: answer.category,
      evaluation: answer.evaluation,
    })),
    latency: {
      medianMs: percentile(durationValues, 0.5),
      p90Ms: percentile(durationValues, 0.9),
      maxMs: Math.max(0, ...durationValues),
    },
    timings,
    conversationIds: createdConversationIds,
    practiceButtonCount: practice.apiShape.buttons.length,
    calendarEventCount: state.calendarEvents.length,
    replanScheduleSummary: replanned?.decision?.output?.scheduleSummary,
  };
  writeJson('summary.json', summary);
  fs.writeFileSync(path.join(options.outDir, 'report.md'), markdownReport(summary));
  const fatalPath = path.join(options.outDir, 'fatal-error.json');
  if (fs.existsSync(fatalPath)) fs.unlinkSync(fatalPath);
  log(`DONE ${summary.passed}/${summary.total} checks passed`);
  log(`Report: ${path.join(options.outDir, 'report.md')}`);
  if (summary.failed > 0) process.exitCode = 2;
}

main().catch((error) => {
  writeJson('fatal-error.json', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
    timings,
    checks,
    conversationIds: createdConversationIds,
  });
  console.error(error);
  process.exitCode = 1;
});
