import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { createJiti } from 'jiti';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

const require = createRequire(import.meta.url);
const jiti = createJiti(import.meta.url, {
  alias: { '@': process.cwd() },
  jsx: { runtime: 'automatic' },
});
const { calendarRegressionEvents } = await jiti.import('./verify-teacher-course-agent.ts');
const learnPath = 'components/learn/learn-page-client.tsx';
const learnText = readFileSync(learnPath, 'utf8');
const learnAst = ts.createSourceFile(
  learnPath,
  learnText,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const loopText = readFileSync('lib/chat/run-course-side-chat-loop.ts', 'utf8');
const loopAst = ts.createSourceFile('loop.ts', loopText, ts.ScriptTarget.Latest, true);
function functions(ast, names) {
  return names
    .map((name) => {
      const fn = ast.statements.find(
        (node) => ts.isFunctionDeclaration(node) && node.name?.text === name,
      );
      assert.ok(fn, `Missing ${name}`);
      return fn.getText(ast).replace(/^export /, '');
    })
    .join('\n');
}
function evaluate(code, bindings = {}) {
  const js = ts.transpileModule(code, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
    fileName: 'fixture.tsx',
  }).outputText;
  return new Function('require', 'exports', ...Object.keys(bindings), js)(
    require,
    {},
    ...Object.values(bindings),
  );
}
const { buildCourseReplyProgress } = await jiti.import('../lib/chat/course-reply-progress.ts');
const consume = evaluate(
  `${functions(loopAst, ['cloneMessages', 'toLearningActionKind', 'makeLearningAction', 'consumeOneResponse'])}\nreturn consumeOneResponse;`,
  {
    LEARNING_ACTION_KINDS: new Set([
      'calendar.propose_add',
      'calendar.propose_update',
      'calendar.propose_delete',
    ]),
    buildCourseReplyProgress,
    dispatchCourseReplyProgress: () => {},
    updateQueuedAiTask: () => {},
  },
);
const wire = calendarRegressionEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
const encoded = new TextEncoder().encode(wire);
const response = new Response(
  new ReadableStream({
    start(controller) {
      for (let i = 0; i < encoded.length; i += 31) controller.enqueue(encoded.slice(i, i + 31));
      controller.close();
    },
  }),
);
let streamMessages = [];
await consume(response, new AbortController().signal, [], (messages) => {
  streamMessages = messages;
});
const actionMessage = streamMessages.find((m) => m.metadata?.learningActions?.length);
assert.equal(actionMessage.metadata.learningActions[0].payload.items[0].start, '09:00');
assert.equal(actionMessage.metadata.learningActions[0].confirmation, 'required');

const helperCode = functions(learnAst, [
  'publicTraceFromCourseAnswererMessages',
  'streamedCourseAnswerFromMessages',
  'learnMessagesForCourseAnswerer',
]);
const messageText = (message) =>
  message.parts
    .filter((p) => p.type === 'text')
    .map((p) => p.text)
    .join('');
const helpers = evaluate(
  `${helperCode}\nreturn { streamedCourseAnswerFromMessages, learnMessagesForCourseAnswerer };`,
  { messageText },
);
// Execute the actual onMessages callback of the main send path, not a replica.
let callbacks = [];
let finalMessageNode;
let emptyGuard;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(learnAst) === 'askCourseOrchestrator') {
    const property = node.arguments[0]?.properties?.find(
      (p) => p.name?.getText(learnAst) === 'onMessages',
    );
    if (property) callbacks.push(property.initializer);
  }
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(learnAst) === 'answerMessage' &&
    node.initializer?.getText(learnAst).includes('currentTurnAnswer')
  )
    finalMessageNode = node.initializer;
  if (
    ts.isIfStatement(node) &&
    node.expression.getText(learnAst).startsWith('!currentTurnAnswer?.text.trim()')
  )
    emptyGuard = node;
  ts.forEachChild(node, visit);
}
visit(learnAst);
let pageMessages = [{ id: 'pending', role: 'assistant', text: '', transient: true, createdAt: 1 }];
const onMessages = evaluate(
  `let latestTeacherPublicTrace; return (${callbacks.at(-1).getText(learnAst)});`,
  {
    canCommitTurn: () => true,
    historicalAnswererMessageIds: new Set(),
    pendingWorkflowMessageId: 'pending',
    ...helpers,
    setMessages: (updater) => {
      pageMessages = updater(pageMessages);
    },
    replaceLearnMessage: (messages, id, replacement) =>
      messages.map((m) => (m.id === id ? replacement : m)),
  },
);
onMessages(streamMessages);
assert.equal(pageMessages[0].learningActions.length, 1, 'streaming page must retain the card');
const currentTurnAnswer = helpers.streamedCourseAnswerFromMessages(streamMessages, new Set());
const saved = evaluate(
  `${emptyGuard.getText(learnAst)}\nreturn (${finalMessageNode.getText(learnAst)});`,
  {
    currentTurnAnswer,
    pendingWorkflowMessageId: 'pending',
    latestTeacherPublicTrace: undefined,
    normalizeCourseAssistantAnswer: (text) => text,
    finalizePublicTraceSteps: (steps) => steps,
  },
);
assert.equal(
  saved.learningActions.length,
  1,
  'final action-only answer must be accepted and persisted',
);
const restored = JSON.parse(JSON.stringify(saved));
const history = helpers.learnMessagesForCourseAnswerer([restored]);
assert.equal(history[0].metadata.learningActions[0].payload.items[0].date, '2026-09-06');

// Render the real confirmation-card component and invoke its actual callback.
const Button = (props) => createElement('button', props);
const cardFunctions = functions(learnAst, [
  'learnActionTitle',
  'learnActionButtonLabel',
  'memoryActionDetailRows',
  'LearnLearningActionCards',
]);
const cardPresentation = await jiti.import('../components/learn/learn-confirmation-card.tsx');
const Card = evaluate(`${cardFunctions}\nreturn LearnLearningActionCards;`, {
  ...cardPresentation,
  Button,
  Sparkles: () => null,
  cn: (...values) => values.filter(Boolean).join(' '),
});
let confirmed;
const element = Card({
  actions: restored.learningActions,
  onConfirm: (action) => {
    confirmed = action;
  },
  onCancel: () => {},
});
const html = renderToStaticMarkup(element);
assert.match(html, /确认添加/);
assert.match(html, /考试/);
function clickConfirm(element) {
  if (!element || typeof element !== 'object') return;
  if (element.type === Button && element.props.children === '确认添加') element.props.onClick();
  for (const child of [element.props?.children, element.props?.actions].flat(Infinity))
    clickConfirm(child);
}
clickConfirm(element);
assert.deepEqual(confirmed.payload.items, restored.learningActions[0].payload.items);
const completedHtml = renderToStaticMarkup(
  Card({
    actions: [{ ...confirmed, status: 'completed' }],
    onConfirm: () => {},
    onCancel: () => {},
  }),
);
assert.match(completedHtml, /已完成/);
assert.match(completedHtml, /disabled/);
console.log(
  'PASS SDK tool -> chunked SSE -> main page streaming -> action-only save -> reload -> rendered confirmation and exact payload',
);

const { applyTopicProfile, practiceTopicAliases } = await jiti.import(
  '../lib/server/problem-bank-practice-search.ts',
);
const packet = (id, title) => ({
  id,
  sourceId: id,
  title,
  sourceType: 'problem',
  renderedText: title,
  originalText: title,
  metadata: {},
  score: 1,
});
const candidates = [
  packet('dict', 'N-gram Dictionary Value'),
  packet('nested', 'Nested List Row Extraction'),
  packet('sort', 'One Pass of Selection Sort'),
];
const matching = applyTopicProfile({ matches: candidates, profile: null, query: '字典、嵌套列表' });
assert.deepEqual(
  matching.accepted.map((m) => m.problemId),
  ['dict', 'nested'],
);
assert.deepEqual(
  matching.excluded.map((m) => m.problemId),
  ['sort'],
);
assert.ok(practiceTopicAliases('字典与嵌套列表').includes('dictionary'));
assert.ok(practiceTopicAliases('字典与嵌套列表').includes('nested list'));
assert.deepEqual(
  applyTopicProfile({
    matches: [packet('zh', '字典键值查找')],
    profile: null,
    query: 'dictionary',
  }).accepted.map((m) => m.problemId),
  ['zh'],
);
console.log(
  'PASS bilingual topic retrieval vocabulary and strict filter agree without admitting unrelated sorting',
);

// Real search results -> SSE -> persisted chat card -> existing solver session.
const { practiceCardFromSearch } = await jiti.import('../features/chat/server/practice-card.ts');
const fixture = {
  id: 'practice-fixture',
  userId: 'student',
  courseId: 'course',
  courseName: 'Python',
  now: 1,
  result: {
    query: 'dictionary',
    gaps: [],
    matches: [
      { problemId: 'p1', title: 'Dictionary Key', difficulty: 'easy', reason: '字典', tags: [] },
      { problemId: 'p2', title: 'Dictionary Values', difficulty: 'medium', tags: [] },
      { problemId: 'p1', title: 'Dictionary Key', difficulty: 'easy', tags: [] },
    ],
  },
};
const plan = practiceCardFromSearch(fixture);
assert.deepEqual(plan.problemIds, ['p1', 'p2']);
assert.equal(plan.questions[0].href, '/course/course/problem-bank/p1');
assert.equal(
  practiceCardFromSearch({ ...fixture, result: { ...fixture.result, matches: [] } }),
  null,
);
const cardWire = [
  {
    type: 'agent_start',
    data: { messageId: 'practice-answer', agentId: 'student-helper', agentName: '课程助理' },
  },
  { type: 'practice_plan', data: { messageId: 'practice-answer', plan } },
]
  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
  .join('');
let cardMessages;
await consume(new Response(cardWire), new AbortController().signal, [], (messages) => {
  cardMessages = messages;
});
assert.equal(cardMessages[0].metadata.practicePlan.id, plan.id);
onMessages(cardMessages);
assert.deepEqual(pageMessages[0].plan.problemIds, plan.problemIds);
const cardAnswer = helpers.streamedCourseAnswerFromMessages(cardMessages, new Set());
const savedCard = evaluate(
  `${emptyGuard.getText(learnAst)}\nreturn (${finalMessageNode.getText(learnAst)});`,
  {
    currentTurnAnswer: cardAnswer,
    pendingWorkflowMessageId: 'pending',
    latestTeacherPublicTrace: undefined,
    normalizeCourseAssistantAnswer: (text) => text,
    finalizePublicTraceSteps: (steps) => steps,
  },
);
const restoredCard = JSON.parse(JSON.stringify(savedCard));
assert.deepEqual(restoredCard.plan.problemIds, ['p1', 'p2']);
assert.match(
  messageText(helpers.learnMessagesForCourseAnswerer([restoredCard])[0]),
  /Dictionary Key/,
);
const PracticeCard = evaluate(
  `${functions(learnAst, ['PlanActionCard', 'practiceSessionPlanMeta'])}\nreturn PlanActionCard;`,
  {
    ...cardPresentation,
    isProblemSelectionPlan: () => true,
    practicePlanDisplayRationale: () => [],
    learnAssistantActionCardWidthClassName: '',
    cn: (...values) => values.filter(Boolean).join(' '),
    Button,
    BookOpenCheck: () => null,
    Play: () => null,
    ChevronRight: () => null,
  },
);
let picked;
const tree = PracticeCard({
  plan,
  problemsState: { status: 'ready' },
  onStart: (p, id) => {
    picked = id;
  },
});
const markup = renderToStaticMarkup(tree);
assert.ok(!markup.includes('/course/'));
assert.ok(!markup.includes('0 分钟'));
function clickQuestion(node) {
  if (!node || typeof node !== 'object') return;
  if (node.type === 'button' && node.key === 'p2') node.props.onClick();
  for (const child of [node.props?.children].flat(Infinity)) clickQuestion(child);
}
clickQuestion(tree);
assert.equal(picked, 'p2');
const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
    removeItem: (key) => storage.delete(key),
  },
};
const sessions = await jiti.import('../lib/learning/practice-session.ts');
const plans = await jiti.import('../lib/learning/course-learner-state.ts');
let openNode;
function findOpen(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(learnAst) === 'openPracticePlan')
    openNode = node.initializer.arguments[0];
  ts.forEachChild(node, findOpen);
}
findOpen(learnAst);
let popup;
const openPlan = evaluate(`return (${openNode.getText(learnAst)});`, {
  ...sessions,
  savePracticePlan: plans.savePracticePlan,
  localUserId: 'student',
  activeCourseId: 'course',
  toast: {
    error: () => {
      throw new Error('Unexpected rejection');
    },
  },
  syncPracticeSessionState: () => {},
  setPracticeHeaderState: () => {},
  setPracticeProblemHelp: () => {},
  setPracticeProblemHelpTabProblemId: () => {},
  setPracticeProblemHelpTabActive: () => {},
  setPracticePopupSessionId: (id) => {
    popup = id;
  },
});
openPlan(restoredCard.plan, picked);
assert.equal(sessions.loadPracticeSession(popup).currentProblemId, 'p2');
sessions.updatePracticeSessionAnswerDraft(popup, 'p2', { code: 'print({})' });
sessions.recordPracticeSessionAttempt({
  sessionId: popup,
  problemId: 'p2',
  status: 'passed',
  score: 1,
});
sessions.pausePracticeSession(popup);
openPlan(restoredCard.plan);
const resumed = sessions.loadPracticeSession(popup);
assert.equal(resumed.currentProblemId, 'p2');
assert.equal(resumed.problemStates.p2.answer.code, 'print({})');
assert.equal(resumed.problemStates.p2.latestAttemptStatus, 'passed');
assert.equal(plans.loadPracticePlan(plan.id).questions[1].title, 'Dictionary Values');
delete globalThis.window;
console.log(
  'PASS practice card SSE, text-free completion, history, actual card click and popup callback, draft and progress restore',
);
