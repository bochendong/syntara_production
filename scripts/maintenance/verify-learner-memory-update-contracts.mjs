#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = process.cwd();
const contractPath = path.join(root, 'features/memory/domain/learner-memory-update.ts');
const source = fs.readFileSync(contractPath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: contractPath,
}).outputText;
const compiled = { exports: {} };
new Function('require', 'module', 'exports', transpiled)(require, compiled, compiled.exports);

const {
  applyCourseAnswerContractMemorySignal,
  normalizeQuestionMemoryDiagnosis,
  normalizeAttemptMemoryDiagnosis,
} = compiled.exports;
const checks = [];
function check(name, operation) {
  operation();
  checks.push({ name, passed: true });
}

function question(raw, studentMessage, extra = {}) {
  return normalizeQuestionMemoryDiagnosis({
    raw,
    studentMessage,
    hasCourseSource: true,
    ...extra,
  });
}

check('definition questions only overwrite short-term state', () => {
  const result = question(
    {
      category: 'definition',
      courseRelevant: true,
      knowledgePoint: 'Representation Invariants',
      masteredSignal: '学生掌握 RI',
      stuckPoint: '不清楚 RI 的作用',
      cause: null,
      nextTeachingMove: '用一个非法对象反例讲解。',
      confidence: 'high',
      evidenceFromMessage: ['RI到底是啥'],
      workingMemoryAction: 'update',
      durableMemoryAction: 'create',
      durableMemoryReason: 'model requested create',
    },
    'RI到底是啥',
  );
  assert.equal(result.workingMemoryAction, 'update');
  assert.equal(result.durableMemoryAction, 'skip');
  assert.equal(result.layerRouting.shortTerm, 'overwrite');
  assert.equal(result.layerRouting.controlFacts, 'read_only');
  assert.equal(result.masteredSignal, null);
  assert.equal(result.cause, null);
});

check('ambiguous questions write neither short nor long term', () => {
  const result = question(
    {
      category: 'clarification',
      courseRelevant: true,
      knowledgePoint: 'tree recursion',
      nextTeachingMove: '追问',
      confidence: 'high',
      evidenceFromMessage: ['这块还是没懂'],
      durableMemoryAction: 'create',
    },
    '这块还是没懂',
  );
  assert.equal(result.workingMemoryAction, 'skip');
  assert.equal(result.durableMemoryAction, 'skip');
  assert.equal(result.stuckPoint, null);
});

check('conversation context can resolve an otherwise ambiguous pointer', () => {
  const result = question(
    {
      category: 'clarification',
      courseRelevant: true,
      knowledgePoint: 'tree recursion',
      stuckPoint: '仍未理解递归参数为什么缩小',
      nextTeachingMove: '回放三节点树',
      confidence: 'medium',
      evidenceFromMessage: ['这块还是没懂'],
      durableMemoryAction: 'skip',
    },
    '这块还是没懂',
    { resolvedConversationTopic: '树递归参数缩小' },
  );
  assert.equal(result.workingMemoryAction, 'update');
  assert.equal(result.durableMemoryAction, 'skip');
});

check('outside-course questions cannot pollute the current course', () => {
  const result = question(
    {
      category: 'outside_course',
      courseRelevant: false,
      knowledgePoint: 'SQL join',
      nextTeachingMove: '通用解释',
      confidence: 'high',
      evidenceFromMessage: ['left join'],
      durableMemoryAction: 'create',
    },
    'left join 和 inner join 有什么区别',
  );
  assert.equal(result.layerRouting.shortTerm, 'skip');
  assert.equal(result.layerRouting.longTerm, 'skip');
  assert.equal(result.layerRouting.knowledgeBase, 'read_only');
  assert.equal(result.layerRouting.knowledgeCache, 'read_only');
});

check('high-confidence student code may create durable evidence', () => {
  const message = '我写的是 return self._stack.pop()，为什么 Queue 顺序反了';
  const result = question(
    {
      category: 'code_review',
      courseRelevant: true,
      knowledgePoint: 'Queue FIFO 与 Stack LIFO',
      masteredSignal: '能用 Stack public method 完成调用',
      stuckPoint: '把单个 Stack 的 LIFO 当成 Queue 的 FIFO',
      cause: '没有追踪 client 可观察的移除顺序',
      nextTeachingMove: '用 A/B/C 手算两个结构',
      confidence: 'high',
      evidenceFromMessage: ['return self._stack.pop()', 'Queue 顺序反了'],
      durableMemoryAction: 'create',
      durableMemoryReason: '学生代码直接暴露稳定顺序模型。',
    },
    message,
  );
  assert.equal(result.durableMemoryAction, 'create');
  assert.equal(result.evidenceFromMessage.length, 2);
});

check('course-contract failure becomes compact mastery-gap-cause-next state', () => {
  const studentMessage = [
    '请检查我的作业：',
    '```python',
    'def is_even(value: int) -> bool:',
    '    return value % 2 == 0',
    '```',
  ].join('\n');
  const signal = {
    contractId: 'course-answer-contract.csc108.v1',
    courseCode: 'CSC108',
    knowledgePoint: 'CSC108 teacher-style function docstring',
    masteredSignal: null,
    stuckPoint: 'The function is missing its teacher-style docstring.',
    cause: 'The algorithm was checked before the function contract.',
    nextTeachingMove: 'Write the purpose and two doctests before reviewing the body.',
    confidence: 'high',
    evidenceFromMessage: ['def is_even(value: int) -> bool:'],
    contractCheckIds: ['csc108.function.docstring.present'],
  };
  const result = applyCourseAnswerContractMemorySignal({
    diagnosis: question(
      {
        category: 'code_review',
        courseRelevant: true,
        knowledgePoint: 'even function',
        masteredSignal: null,
        stuckPoint: null,
        cause: null,
        nextTeachingMove: 'Review the modulo expression.',
        confidence: 'low',
        evidenceFromMessage: ['def is_even(value: int) -> bool:'],
        durableMemoryAction: 'skip',
      },
      studentMessage,
    ),
    signal,
    studentMessage,
    hasCourseSource: true,
  });
  assert.equal(result.knowledgePoint, signal.knowledgePoint);
  assert.equal(result.masteredSignal, null);
  assert.equal(result.stuckPoint, signal.stuckPoint);
  assert.equal(result.cause, signal.cause);
  assert.equal(result.nextTeachingMove, signal.nextTeachingMove);
  assert.equal(result.workingMemoryAction, 'update');
  assert.equal(result.durableMemoryAction, 'create');
  assert.deepEqual(result.evidenceFromMessage, signal.evidenceFromMessage);
  assert.doesNotMatch(JSON.stringify(result), /Return True if and only if/);
});

check('ungrounded model excerpts are discarded and cannot prove mastery', () => {
  const result = question(
    {
      category: 'clarification',
      courseRelevant: true,
      knowledgePoint: 'aliasing',
      masteredSignal: '会画完整对象图',
      nextTeachingMove: '检查引用',
      confidence: 'high',
      evidenceFromMessage: ['学生会画完整对象图'],
      durableMemoryAction: 'create',
    },
    '直接赋值不行吗',
  );
  assert.deepEqual(result.evidenceFromMessage, []);
  assert.equal(result.masteredSignal, null);
  assert.equal(result.durableMemoryAction, 'skip');
});

function attempt(raw, attempts, hasExistingDurableMemory = false) {
  return normalizeAttemptMemoryDiagnosis({
    raw,
    concept: 'tree recursion',
    attempts,
    hasExistingDurableMemory,
  });
}

const failed = {
  status: 'failed',
  answer: 'return 1 + size(tree)',
  feedback: '递归调用仍传入原树。',
  gradingSource: 'platform_ai',
  gradingReliable: true,
};

check('unsubmitted attempts remain business facts only', () => {
  const result = attempt(
    { knowledgePoint: 'tree recursion', nextTeachingMove: '重新呈现', confidence: 'low' },
    [
      {
        status: 'ungraded',
        answer: '',
        feedback: '没有收到答案',
        gradingSource: 'not_graded',
        gradingReliable: false,
      },
    ],
  );
  assert.equal(result.workingMemoryAction, 'skip');
  assert.equal(result.durableMemoryAction, 'skip');
  assert.equal(result.layerRouting.controlFacts, 'read_only');
});

check('grading errors remain business facts only', () => {
  const result = attempt(
    {
      knowledgePoint: 'tree recursion',
      stuckPoint: '模型声称存在错误',
      nextTeachingMove: '恢复判题后重试',
      confidence: 'high',
      evidenceFromAttempt: ['grader unavailable'],
    },
    [
      {
        status: 'error',
        answer: 'return size(tree.left)',
        feedback: 'grader unavailable',
        gradingSource: 'platform_ai',
        gradingReliable: true,
      },
    ],
  );
  assert.equal(result.workingMemoryAction, 'skip');
  assert.equal(result.durableMemoryAction, 'skip');
  assert.equal(result.stuckPoint, null);
});

check('one medium-confidence failure updates short term only', () => {
  const result = attempt(
    {
      knowledgePoint: 'tree recursion',
      stuckPoint: '递归参数未缩小',
      nextTeachingMove: '画调用树',
      confidence: 'medium',
      evidenceFromAttempt: ['return 1 + size(tree)'],
    },
    [failed],
  );
  assert.equal(result.workingMemoryAction, 'update');
  assert.equal(result.durableMemoryAction, 'skip');
});

check('ungrounded attempt diagnosis cannot invent mastery or a durable gap', () => {
  const result = attempt(
    {
      knowledgePoint: 'tree recursion',
      masteredSignal: '会写所有树递归',
      stuckPoint: '递归参数未缩小',
      cause: '没有建立严格更小子问题',
      nextTeachingMove: '画调用树',
      confidence: 'high',
      evidenceFromAttempt: [],
      durableMemoryReason: 'model requested create',
    },
    [failed, { ...failed, answer: 'return size(tree) + 1' }],
  );
  assert.deepEqual(result.evidenceFromAttempt, []);
  assert.equal(result.masteredSignal, null);
  assert.equal(result.stuckPoint, null);
  assert.equal(result.cause, null);
  assert.equal(result.durableMemoryAction, 'skip');
});

check('a failed answer needs explicit positive grader evidence before retaining mastery', () => {
  const result = attempt(
    {
      knowledgePoint: 'tree recursion',
      masteredSignal: '会写所有树递归',
      stuckPoint: '递归参数未缩小',
      nextTeachingMove: '画调用树',
      confidence: 'high',
      evidenceFromAttempt: ['return 1 + size(tree)'],
    },
    [failed],
  );
  assert.equal(result.masteredSignal, null);
  assert.equal(result.stuckPoint, '递归参数未缩小');
});

check('one objective wrong choice stays short term even with reliable grading', () => {
  const result = attempt(
    {
      knowledgePoint: 'aliasing',
      stuckPoint: '把浅拷贝当作深拷贝',
      cause: '没有区分外层容器与元素引用',
      nextTeachingMove: '画对象图',
      confidence: 'high',
      evidenceFromAttempt: ['学生选择 C'],
      durableMemoryReason: 'model requested create',
    },
    [
      {
        status: 'failed',
        answer: '选择 C',
        feedback: '学生选择 C；正确选项为 B。',
        gradingSource: 'platform_objective',
        gradingReliable: true,
      },
    ],
  );
  assert.equal(result.confidence, 'high');
  assert.equal(result.workingMemoryAction, 'update');
  assert.equal(result.durableMemoryAction, 'skip');
  assert.equal(result.cause, null);
});

check('one high-confidence student-authored code trace may promote', () => {
  const answer = [
    'def size(tree):',
    '    if tree is None:',
    '        return 0',
    '    return 1 + size(tree)',
  ].join('\n');
  const result = attempt(
    {
      knowledgePoint: 'tree recursion',
      stuckPoint: '递归调用仍传入原树',
      cause: '没有建立严格更小子问题',
      nextTeachingMove: '逐层标注 subtree',
      confidence: 'high',
      evidenceFromAttempt: ['return 1 + size(tree)'],
      durableMemoryReason: 'student code directly exposes the reusable pattern',
    },
    [
      {
        status: 'failed',
        answer,
        feedback: '递归调用仍传入原树。',
        gradingSource: 'platform_ai',
        gradingReliable: true,
      },
    ],
  );
  assert.equal(result.durableMemoryAction, 'create');
  assert.equal(result.cause, '没有建立严格更小子问题');
});

check('repeated reliable failures promote one durable pattern', () => {
  const result = attempt(
    {
      knowledgePoint: 'tree recursion',
      stuckPoint: '连续两次未缩小递归参数',
      cause: '没有建立严格更小子问题不变量',
      nextTeachingMove: '逐层标注 subtree',
      confidence: 'high',
      evidenceFromAttempt: ['return 1 + size(tree)'],
    },
    [failed, { ...failed, answer: 'return size(tree) + 1' }],
  );
  assert.equal(result.durableMemoryAction, 'create');
  assert.equal(result.trend, 'repeated_gap');
});

check('another failure strengthens instead of duplicating an existing pattern', () => {
  const result = attempt(
    {
      knowledgePoint: 'tree recursion',
      stuckPoint: '递归参数未缩小',
      nextTeachingMove: '逐层标注 subtree',
      confidence: 'high',
      evidenceFromAttempt: ['return 1 + size(tree)'],
    },
    [failed],
    true,
  );
  assert.equal(result.durableMemoryAction, 'strengthen');
  assert.equal(result.layerRouting.longTerm, 'strengthen');
});

check('one later pass marks an existing gap improving, not mastered', () => {
  const result = attempt(
    {
      knowledgePoint: 'tree recursion',
      masteredSignal: '本题递归参数已改为 child',
      nextTeachingMove: '用独立迁移题复测',
      confidence: 'high',
      evidenceFromAttempt: ['size(tree.left)'],
    },
    [
      {
        status: 'passed',
        answer: 'return 1 + size(tree.left)',
        feedback: '本题通过。',
        gradingSource: 'platform_ai',
        gradingReliable: true,
      },
    ],
    true,
  );
  assert.equal(result.durableMemoryAction, 'revise');
  assert.equal(result.trend, 'improving');
  assert.equal(result.stuckPoint, null);
  assert.match(result.durableMemoryReason, /单次通过/);
});

check('phase 07 executor no longer consumes expected answers to make writes', () => {
  const storeSource = fs.readFileSync(
    path.join(root, 'features/qa/test-center/memory/local-memory-test-store.ts'),
    'utf8',
  );
  const start = storeSource.indexOf('async function recordProblemWritebackCase');
  const end = storeSource.indexOf('\nasync function recordSourceUpload', start);
  const executor = storeSource.slice(start, end);
  assert.doesNotMatch(executor, /testCase\.writeMode/);
  assert.doesNotMatch(executor, /testCase\.masteredSignal/);
  assert.doesNotMatch(executor, /testCase\.stuckPoint/);
  assert.match(executor, /memory-local-attempt-diagnosis/);
  assert.match(executor, /canOpenWeakPoint/);
  assert.match(executor, /diagnosis\.durableMemoryAction === 'strengthen'/);
});

check('production question writeback uses the shared gated diagnosis', () => {
  const routeSource = fs.readFileSync(
    path.join(root, 'app/api/notebooks/send-message/route.ts'),
    'utf8',
  );
  const queueSource = fs.readFileSync(
    path.join(root, 'lib/learning/working-memory-tasks.ts'),
    'utf8',
  );
  assert.match(routeSource, /normalizeQuestionMemoryDiagnosis/);
  assert.match(routeSource, /learnerWorkingMemory/);
  assert.match(queueSource, /diagnosis\.workingMemoryAction === 'update'/);
  assert.match(queueSource, /diagnosis\.durableMemoryAction === 'skip'/);
  assert.match(queueSource, /applyNotebookChatDurableMemory/);
  assert.doesNotMatch(queueSource, /deriveChatWorkingMemory/);
  assert.doesNotMatch(
    queueSource.slice(queueSource.indexOf('export function queueChatTurnWorkingMemoryUpdate')),
    /assistant_reply/,
  );

  const testStoreSource = fs.readFileSync(
    path.join(root, 'features/qa/test-center/memory/local-memory-test-store.ts'),
    'utf8',
  );
  const questionCaseStart = testStoreSource.indexOf('async function recordQuestionWritebackCase');
  const questionCaseEnd = testStoreSource.indexOf('\nfunction seedPreferences', questionCaseStart);
  const questionCaseExecutor = testStoreSource.slice(questionCaseStart, questionCaseEnd);
  assert.doesNotMatch(questionCaseExecutor, /type:\s*'assistant_reply'/);
  assert.doesNotMatch(questionCaseExecutor, /question:\s*testCase\.userMessage/);

  const legacyStart = testStoreSource.indexOf('async function recordQuestion(');
  const legacyEnd = testStoreSource.indexOf(
    '\nasync function recordQuestionWritebackCase',
    legacyStart,
  );
  const legacyQuestionExecutor = testStoreSource.slice(legacyStart, legacyEnd);
  assert.doesNotMatch(legacyQuestionExecutor, /type:\s*'assistant_reply'/);
  assert.doesNotMatch(legacyQuestionExecutor, /recordNotebookPrivateMemory/);
  assert.match(legacyQuestionExecutor, /durableMemoryAction:\s*'skip'/);
});

check('production attempt short-term writeback skips run, pending, and grading errors', () => {
  const queueSource = fs.readFileSync(
    path.join(root, 'lib/learning/working-memory-tasks.ts'),
    'utf8',
  );
  const start = queueSource.indexOf('export function queueProblemAttemptWorkingMemoryUpdate');
  const body = queueSource.slice(start);
  assert.match(body, /args\.attempt\.kind !== 'answer'/);
  assert.match(body, /args\.attempt\.kind !== 'submit'/);
  assert.match(body, /args\.attempt\.status !== 'passed'/);
  assert.match(body, /args\.attempt\.status !== 'failed'/);
  assert.match(body, /args\.attempt\.status !== 'partial'/);
  assert.ok(body.indexOf("args.attempt.status !== 'partial'") < body.indexOf('const passed'));
});

check('CLI run records are visible in the UI without fake browser mutations', () => {
  const resultStoreSource = fs.readFileSync(
    path.join(root, 'features/qa/test-center/memory/local-memory-activity-result-store.ts'),
    'utf8',
  );
  const workspaceSource = fs.readFileSync(
    path.join(root, 'features/qa/test-center/memory/memory-lifecycle-test-workspace.tsx'),
    'utf8',
  );
  const runnerSource = fs.readFileSync(
    path.join(root, 'scripts/maintenance/run-phase2-07-08-memory-writeback.mjs'),
    'utf8',
  );
  assert.match(resultStoreSource, /mutation:\s*LocalMemoryMutationResponse\s*\|\s*null/);
  assert.match(resultStoreSource, /result\.mutation\s*\|\|\s*result\.cliRun/);
  assert.match(workspaceSource, /CliMemoryRunEvidence/);
  assert.match(runnerSource, /mutation:\s*null/);
  assert.match(runnerSource, /cliRun:\s*record\.result/);
});

check('confirmed durable writes keep auditable references and precede local shadow updates', () => {
  const learnSource = fs.readFileSync(
    path.join(root, 'components/learn/learn-page-client.tsx'),
    'utf8',
  );
  const candidateStart = learnSource.indexOf('function memoryWriteCandidateFromLearningAction');
  const candidateEnd = learnSource.indexOf(
    '\nfunction learningActionPreferredConcepts',
    candidateStart,
  );
  const candidateSource = learnSource.slice(candidateStart, candidateEnd);
  assert.match(candidateSource, /conversationId:\s*args\.conversationId/);
  assert.match(candidateSource, /sourceReferences:\s*\[/);
  assert.doesNotMatch(candidateSource, /question:\s*args\./);

  const actionStart = learnSource.indexOf("if (action.kind === 'memory.propose_write')");
  const actionEnd = learnSource.indexOf("if (action.kind === 'course.import_source')", actionStart);
  const actionSource = learnSource.slice(actionStart, actionEnd);
  assert.ok(
    actionSource.indexOf('writeMemoryWithActivity') <
      actionSource.indexOf('saveLearnerCourseState'),
  );
});

console.log(
  JSON.stringify(
    {
      contract: 'learner-memory-update-v1',
      passed: checks.length,
      failed: 0,
      checks,
    },
    null,
    2,
  ),
);
