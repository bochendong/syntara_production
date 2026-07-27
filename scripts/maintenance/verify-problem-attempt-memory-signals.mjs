#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = process.cwd();
const signalPath = path.join(root, 'lib/server/problem-attempt-memory-signals.ts');
const servicePath = path.join(root, 'lib/server/notebook-problems/service.ts');
const signalSource = fs.readFileSync(signalPath, 'utf8');
const serviceSource = fs.readFileSync(servicePath, 'utf8');
const indexedMemoryIds = [];

const transpiled = ts.transpileModule(signalSource, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: signalPath,
}).outputText;

const compiledModule = { exports: {} };
const stubbedRequire = (id) => {
  if (id === '@/lib/server/study-memory-store') {
    return { ensureStudyMemoryTable: async () => undefined };
  }
  if (id === '@/lib/server/study-memory-vector-store') {
    return {
      indexStudyMemoryRecord: async (_prisma, memory) => {
        indexedMemoryIds.push(memory.id);
      },
    };
  }
  return require(id);
};
new Function('require', 'module', 'exports', transpiled)(
  stubbedRequire,
  compiledModule,
  compiledModule.exports,
);

const {
  maybeWriteProblemAttemptMemorySignal,
  planProblemAttemptMemorySignal,
  semanticProblemAttemptPattern,
} = compiledModule.exports;
assert.equal(
  typeof planProblemAttemptMemorySignal,
  'function',
  'planner must be exported for direct contract checks',
);

function attempt(id, status, createdAt, kind = 'answer', problemId = 'problem-1') {
  return {
    id,
    problemId,
    userId: 'user-1',
    kind,
    status,
    score: status === 'passed' ? 1 : 0,
    answer: {},
    createdAt,
    updatedAt: createdAt,
  };
}

function cloneProblem(problem, patch) {
  return {
    ...problem,
    ...patch,
    publicContent: patch.publicContent || problem.publicContent,
    grading: patch.grading || problem.grading,
    sourceMeta: patch.sourceMeta || problem.sourceMeta,
  };
}

function existingFrom(plan) {
  return {
    state: plan.state,
    attemptIds: plan.attemptIds,
    nonPassingAttemptIds: plan.nonPassingAttemptIds,
    passingAttemptIds: plan.passingAttemptIds,
    passingProblemIds: plan.passingProblemIds,
    resolutionPassingAttemptIds: plan.resolutionPassingAttemptIds,
    resolutionPassingProblemIds: plan.resolutionPassingProblemIds,
    latestAttemptId: plan.latestAttemptId,
    latestAttemptStatus: plan.latestAttemptStatus,
  };
}

const failed1 = attempt('attempt-failed-1', 'failed', 1);
const failed2 = attempt('attempt-failed-2', 'partial', 2);
const failed3 = attempt('attempt-failed-3', 'failed', 3);
const passed1 = attempt('attempt-passed-1', 'passed', 4);
const passed2 = attempt('attempt-passed-2', 'passed', 5, 'answer', 'problem-2');
const failedAfterResolution = attempt('attempt-failed-after-resolution', 'failed', 6);
const runFailure = attempt('attempt-run-1', 'failed', 5, 'run');
const error1 = attempt('attempt-error-1', 'error', 6);
const error2 = attempt('attempt-error-2', 'error', 7);

const checks = [];
function check(name, operation) {
  operation();
  checks.push({ name, passed: true });
}

check('semantic pattern normalizes tag order, case, width, and whitespace', () => {
  const left = semanticProblemAttemptPattern({
    id: 'problem-left',
    tags: [' BST ', 'Tree\u3000Recursion'],
  });
  const right = semanticProblemAttemptPattern({
    id: 'problem-right',
    tags: ['tree recursion', 'ｂｓｔ'],
  });
  assert.equal(left.key, right.key);
  assert.deepEqual(left.normalizedTags, ['bst', 'tree recursion']);
  assert.equal(left.isConceptPattern, true);
});

check('untagged semantic patterns remain isolated by problem id', () => {
  const left = semanticProblemAttemptPattern({ id: 'untagged-left', tags: [] });
  const right = semanticProblemAttemptPattern({ id: 'untagged-right', tags: ['  '] });
  assert.notEqual(left.key, right.key);
  assert.equal(left.isConceptPattern, false);
  assert.equal(right.isConceptPattern, false);
});

check('run attempts never promote durable memory', () => {
  const plan = planProblemAttemptMemorySignal({
    attempt: runFailure,
    recentAttempts: [runFailure, failed2, failed1],
  });
  assert.equal(plan.action, 'skipped');
  assert.equal(plan.state, null);
});

check('one formal failure stays out of durable memory', () => {
  const plan = planProblemAttemptMemorySignal({
    attempt: failed1,
    recentAttempts: [failed1],
  });
  assert.equal(plan.action, 'skipped');
  assert.equal(plan.nonPassingAttemptIds.length, 1);
});

const createdPlan = planProblemAttemptMemorySignal({
  attempt: failed2,
  recentAttempts: [failed2, failed1],
});
check('second formal non-pass creates one active gap', () => {
  assert.equal(createdPlan.action, 'created');
  assert.equal(createdPlan.state, 'active_gap');
  assert.deepEqual(createdPlan.nonPassingAttemptIds, ['attempt-failed-1', 'attempt-failed-2']);
});

check('replaying represented evidence is idempotent', () => {
  const replay = planProblemAttemptMemorySignal({
    attempt: failed2,
    recentAttempts: [failed2, failed1],
    existing: existingFrom(createdPlan),
  });
  assert.equal(replay.action, 'unchanged');
});

const strengthenedPlan = planProblemAttemptMemorySignal({
  attempt: failed3,
  recentAttempts: [failed3, failed2, failed1],
  existing: existingFrom(createdPlan),
});
check('third non-pass strengthens the existing gap', () => {
  assert.equal(strengthenedPlan.action, 'strengthened');
  assert.equal(strengthenedPlan.state, 'active_gap');
  assert.equal(strengthenedPlan.nonPassingAttemptIds.length, 3);
});

const improvingPlan = planProblemAttemptMemorySignal({
  attempt: passed1,
  recentAttempts: [passed1, failed3, failed2, failed1],
  existing: existingFrom(strengthenedPlan),
});
check('later pass marks improving instead of mastered', () => {
  assert.equal(improvingPlan.action, 'improving');
  assert.equal(improvingPlan.state, 'improving');
  assert.equal(improvingPlan.passingAttemptIds.length, 1);
  assert.match(improvingPlan.reason, /does not prove durable mastery/);
});

const resolvedPlan = planProblemAttemptMemorySignal({
  attempt: passed2,
  recentAttempts: [passed2, passed1, failed3, failed2, failed1],
  existing: existingFrom(improvingPlan),
});
check('a pass on a second problem resolves the same-pattern gap', () => {
  assert.equal(resolvedPlan.action, 'resolved');
  assert.equal(resolvedPlan.state, 'resolved');
  assert.deepEqual(resolvedPlan.resolutionPassingProblemIds, ['problem-1', 'problem-2']);
});

const reactivatedPlan = planProblemAttemptMemorySignal({
  attempt: failedAfterResolution,
  recentAttempts: [failedAfterResolution, passed2, passed1, failed3, failed2, failed1],
  existing: existingFrom(resolvedPlan),
});
check('a later non-pass reactivates a resolved gap and resets closure evidence', () => {
  assert.equal(reactivatedPlan.action, 'reactivated');
  assert.equal(reactivatedPlan.state, 'active_gap');
  assert.deepEqual(reactivatedPlan.resolutionPassingAttemptIds, []);
  assert.deepEqual(reactivatedPlan.resolutionPassingProblemIds, []);
  assert.ok(reactivatedPlan.passingAttemptIds.includes(passed1.id));
  assert.ok(reactivatedPlan.passingAttemptIds.includes(passed2.id));
});

const sameProblemSecondPass = attempt(
  'attempt-passed-same-problem-2',
  'passed',
  6,
  'answer',
  'problem-1',
);
const stillImprovingPlan = planProblemAttemptMemorySignal({
  attempt: sameProblemSecondPass,
  recentAttempts: [sameProblemSecondPass, passed1, failed3, failed2, failed1],
  existing: existingFrom(improvingPlan),
});
check('repeated passes on the same problem do not resolve a gap', () => {
  assert.equal(stillImprovingPlan.action, 'improving');
  assert.equal(stillImprovingPlan.state, 'improving');
  assert.deepEqual(stillImprovingPlan.resolutionPassingProblemIds, ['problem-1']);
});

check('replaying the improving event is idempotent', () => {
  const replay = planProblemAttemptMemorySignal({
    attempt: passed1,
    recentAttempts: [passed1, failed3, failed2, failed1],
    existing: existingFrom(improvingPlan),
  });
  assert.equal(replay.action, 'unchanged');
});

check('a pass without a prior repeated gap creates no durable mastery', () => {
  const plan = planProblemAttemptMemorySignal({
    attempt: passed1,
    recentAttempts: [passed1],
  });
  assert.equal(plan.action, 'skipped');
  assert.equal(plan.state, null);
});

check('error statuses do not become learner failures', () => {
  const plan = planProblemAttemptMemorySignal({
    attempt: error2,
    recentAttempts: [error2, error1],
  });
  assert.equal(plan.action, 'skipped');
  assert.equal(plan.nonPassingAttemptIds.length, 0);
});

check('service calls memory projection only after the attempt transaction', () => {
  const transactionIndex = serviceSource.indexOf('const created = (await prismaDb.$transaction');
  const attemptMappedIndex = serviceSource.indexOf('const attempt = mapAttemptRow(created)');
  const memoryCallIndex = serviceSource.indexOf('await maybeWriteProblemAttemptMemorySignal');
  assert.ok(transactionIndex >= 0);
  assert.ok(attemptMappedIndex > transactionIndex);
  assert.ok(memoryCallIndex > attemptMappedIndex);
  assert.match(serviceSource, /if \(args\.kind !== 'run'\)/);
  assert.match(serviceSource, /learner-memory write failed after commit/);
});

check('database merge has a stable lock and idempotent upsert', () => {
  assert.match(signalSource, /pg_advisory_xact_lock/);
  assert.match(signalSource, /ON CONFLICT \("id"\) DO UPDATE/);
  assert.match(signalSource, /memory_problem_attempt_/);
  assert.match(signalSource, /改善中/);
  assert.doesNotMatch(signalSource, /已掌握/);
  assert.doesNotMatch(signalSource, /题目摘要/);
  assert.doesNotMatch(signalSource, /function problemStem/);
  assert.match(signalSource, /problemIds/);
  assert.match(signalSource, /problemTitles/);
});

const storedMemories = [];
let patternAttemptRows = [];

function patternAttemptRow(problemAttempt, problem) {
  return {
    id: problemAttempt.id,
    problemId: problemAttempt.problemId,
    userId: problemAttempt.userId,
    kind: problemAttempt.kind,
    status: problemAttempt.status,
    score: problemAttempt.score,
    answerJson: problemAttempt.answer,
    resultJson: problemAttempt.result,
    createdAt: new Date(problemAttempt.createdAt),
    updatedAt: new Date(problemAttempt.updatedAt),
    problemTitle: problem.title,
    problemType: problem.type,
    problemTags: problem.tags,
    courseId: problem.courseId,
    notebookId: problem.notebookId,
  };
}

function setPatternAttempts(entries) {
  patternAttemptRows = entries.map(({ problemAttempt, problem }) =>
    patternAttemptRow(problemAttempt, problem),
  );
}

const fakePrisma = {
  async $transaction(operation) {
    return operation(this);
  },
  async $queryRawUnsafe(sql, ...params) {
    if (sql.includes('pg_advisory_xact_lock')) return [{ locked: true }];
    if (sql.includes('SELECT') && sql.includes('FROM "StudyMemory"')) {
      const [userId, fallbackId, source, targetType, targetId] = params;
      return storedMemories
        .filter(
          (memory) =>
            memory.ownerId === userId &&
            (memory.id === fallbackId || memory.source === source) &&
            memory.targetType === targetType &&
            (targetType === 'notebook'
              ? memory.notebookId === targetId
              : memory.courseId === targetId),
        )
        .sort((left, right) => +new Date(right.updatedAt) - +new Date(left.updatedAt));
    }
    if (sql.includes('FROM "NotebookProblemAttempt"')) {
      const [userId, targetType, targetId, limit] = params;
      return patternAttemptRows
        .filter(
          (row) =>
            row.userId === userId &&
            (targetType === 'notebook' ? row.notebookId === targetId : row.courseId === targetId),
        )
        .sort((left, right) => +new Date(right.createdAt) - +new Date(left.createdAt))
        .slice(0, Number(limit));
    }
    if (sql.includes('INSERT INTO "StudyMemory"')) {
      const now = new Date();
      const existingIndex = storedMemories.findIndex((memory) => memory.id === params[0]);
      const next = {
        id: params[0],
        ownerId: params[1],
        courseId: params[2],
        notebookId: params[3],
        targetType: params[4],
        scope: 'private',
        kind: params[5],
        status: params[6],
        source: params[7],
        title: params[8],
        text: params[9],
        reason: params[10],
        question: null,
        sourceReferences: JSON.parse(params[11]),
        createdAt: existingIndex >= 0 ? storedMemories[existingIndex].createdAt : now,
        updatedAt: now,
      };
      if (existingIndex >= 0) storedMemories.splice(existingIndex, 1, next);
      else storedMemories.push(next);
      return [next];
    }
    throw new Error(`Unexpected fake query: ${sql.slice(0, 80)}`);
  },
};
const problem = {
  id: 'problem-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  title: 'BST 边界',
  type: 'short_answer',
  status: 'published',
  source: 'manual',
  order: 1,
  points: 1,
  tags: ['BST', '边界'],
  difficulty: 'medium',
  publicContent: { stem: '解释空树与重复值边界。' },
  grading: { type: 'short_answer', referenceAnswer: '参考答案' },
  sourceMeta: {},
  createdAt: 1,
  updatedAt: 1,
};

setPatternAttempts([
  { problemAttempt: failed2, problem },
  { problemAttempt: failed1, problem },
]);
const createdResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem,
  attempt: failed2,
  recentAttempts: [failed2, failed1],
});
check('atomic writer creates one evidence-backed row', () => {
  assert.equal(createdResult.action, 'created');
  assert.equal(storedMemories.length, 1);
  assert.equal(storedMemories[0].sourceReferences.version, 3);
  assert.deepEqual(storedMemories[0].sourceReferences.problemIds, ['problem-1']);
  assert.deepEqual(storedMemories[0].sourceReferences.problemTitles, ['BST 边界']);
  assert.equal(storedMemories[0].sourceReferences.state, 'active_gap');
  assert.equal(storedMemories[0].sourceReferences.nonPassingAttemptIds.length, 2);
});

const replayResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem,
  attempt: failed2,
  recentAttempts: [failed2, failed1],
});
check('atomic writer replay leaves the single row unchanged', () => {
  assert.equal(replayResult.action, 'unchanged');
  assert.equal(storedMemories.length, 1);
});

const strengthenedResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem,
  attempt: failed3,
  recentAttempts: [failed3, failed2, failed1],
});
check('atomic writer strengthens the same row', () => {
  assert.equal(strengthenedResult.action, 'strengthened');
  assert.equal(strengthenedResult.memoryId, createdResult.memoryId);
  assert.equal(storedMemories[0].sourceReferences.nonPassingAttemptIds.length, 3);
});

const improvingResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem,
  attempt: passed1,
  recentAttempts: [passed1, failed3, failed2, failed1],
});
check('atomic writer records counter-evidence as improving', () => {
  assert.equal(improvingResult.action, 'improving');
  assert.equal(improvingResult.memoryId, createdResult.memoryId);
  assert.equal(storedMemories.length, 1);
  assert.equal(storedMemories[0].sourceReferences.state, 'improving');
  assert.match(storedMemories[0].title, /改善中/);
  assert.doesNotMatch(storedMemories[0].text, /已掌握/);
  assert.ok(indexedMemoryIds.length >= 3);
});

const crossProblemA = cloneProblem(problem, {
  id: 'problem-cross-a',
  title: '递归树高度',
  tags: ['Tree Recursion', 'Strict Subproblem'],
  publicContent: { stem: 'CROSS_PROBLEM_A_STEM_MUST_NOT_ENTER_LONG_TERM_MEMORY' },
});
const crossProblemB = cloneProblem(problem, {
  id: 'problem-cross-b',
  title: '递归统计叶子',
  tags: [' strict subproblem ', 'ＴＲＥＥ ＲＥＣＵＲＳＩＯＮ'],
  publicContent: { stem: 'CROSS_PROBLEM_B_STEM_MUST_NOT_ENTER_LONG_TERM_MEMORY' },
});
const crossProblemC = cloneProblem(problem, {
  id: 'problem-cross-c',
  title: '递归检查所有节点',
  tags: ['tree recursion', 'strict subproblem'],
  publicContent: { stem: 'CROSS_PROBLEM_C_STEM_MUST_NOT_ENTER_LONG_TERM_MEMORY' },
});
const crossProblemD = cloneProblem(problem, {
  id: 'problem-cross-d',
  title: '递归复制树',
  tags: ['strict subproblem', 'tree recursion'],
  publicContent: { stem: 'CROSS_PROBLEM_D_STEM_MUST_NOT_ENTER_LONG_TERM_MEMORY' },
});
const crossFailedA = attempt('attempt-cross-failed-a', 'failed', 11, 'answer', crossProblemA.id);
const crossFailedB = attempt('attempt-cross-failed-b', 'partial', 12, 'submit', crossProblemB.id);
const crossPassedC = attempt('attempt-cross-passed-c', 'passed', 13, 'answer', crossProblemC.id);
const crossPassedD = attempt('attempt-cross-passed-d', 'passed', 14, 'answer', crossProblemD.id);
const crossFailedAgain = attempt(
  'attempt-cross-failed-again',
  'failed',
  15,
  'answer',
  crossProblemA.id,
);

setPatternAttempts([{ problemAttempt: crossFailedA, problem: crossProblemA }]);
const firstCrossFailureResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: crossProblemA,
  attempt: crossFailedA,
  recentAttempts: [crossFailedA],
});
check('first failure on a tagged pattern remains short-term only', () => {
  assert.equal(firstCrossFailureResult.action, 'skipped');
  assert.equal(firstCrossFailureResult.memoryId, null);
});

setPatternAttempts([
  { problemAttempt: crossFailedB, problem: crossProblemB },
  { problemAttempt: crossFailedA, problem: crossProblemA },
]);
const secondCrossFailureResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: crossProblemB,
  attempt: crossFailedB,
  // This mirrors the production caller: it only supplies the current
  // problem's history. The writer must load the related problem itself.
  recentAttempts: [crossFailedB],
});
const crossMemory = storedMemories.find(
  (memory) => memory.id === secondCrossFailureResult.memoryId,
);
check('second failure on a different same-tag problem creates one semantic gap', () => {
  assert.equal(secondCrossFailureResult.action, 'created');
  assert.ok(crossMemory);
  assert.deepEqual(crossMemory.sourceReferences.problemIds, ['problem-cross-a', 'problem-cross-b']);
  assert.deepEqual(crossMemory.sourceReferences.problemTitles, ['递归树高度', '递归统计叶子']);
  assert.equal(crossMemory.sourceReferences.nonPassingAttemptIds.length, 2);
  assert.doesNotMatch(crossMemory.text, /CROSS_PROBLEM_[ABC]_STEM/);
  assert.match(crossMemory.text, /来源题目：/);
});

setPatternAttempts([
  { problemAttempt: crossPassedC, problem: crossProblemC },
  { problemAttempt: crossFailedB, problem: crossProblemB },
  { problemAttempt: crossFailedA, problem: crossProblemA },
]);
const crossImprovingResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: crossProblemC,
  attempt: crossPassedC,
  recentAttempts: [crossPassedC],
});
check('one pass on another same-tag problem marks the semantic gap improving only', () => {
  const updatedCrossMemory = storedMemories.find(
    (memory) => memory.id === crossImprovingResult.memoryId,
  );
  assert.equal(crossImprovingResult.action, 'improving');
  assert.equal(crossImprovingResult.memoryId, secondCrossFailureResult.memoryId);
  assert.equal(updatedCrossMemory.sourceReferences.state, 'improving');
  assert.deepEqual(updatedCrossMemory.sourceReferences.problemIds, [
    'problem-cross-a',
    'problem-cross-b',
    'problem-cross-c',
  ]);
  assert.doesNotMatch(updatedCrossMemory.title, /已掌握/);
  assert.doesNotMatch(updatedCrossMemory.text, /已掌握/);
});

setPatternAttempts([
  { problemAttempt: crossPassedD, problem: crossProblemD },
  { problemAttempt: crossPassedC, problem: crossProblemC },
  { problemAttempt: crossFailedB, problem: crossProblemB },
  { problemAttempt: crossFailedA, problem: crossProblemA },
]);
const crossResolvedResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: crossProblemD,
  attempt: crossPassedD,
  recentAttempts: [crossPassedD],
});
check('a pass on a second same-tag problem resolves and archives the same row', () => {
  const resolvedCrossMemory = storedMemories.find(
    (memory) => memory.id === crossResolvedResult.memoryId,
  );
  assert.equal(crossResolvedResult.action, 'resolved');
  assert.equal(crossResolvedResult.state, 'resolved');
  assert.equal(crossResolvedResult.memoryId, secondCrossFailureResult.memoryId);
  assert.equal(storedMemories.length, 2);
  assert.equal(resolvedCrossMemory.status, 'archived');
  assert.equal(resolvedCrossMemory.sourceReferences.state, 'resolved');
  assert.deepEqual(resolvedCrossMemory.sourceReferences.resolutionPassingProblemIds, [
    'problem-cross-c',
    'problem-cross-d',
  ]);
  assert.match(resolvedCrossMemory.title, /弱点已关闭/);
});

setPatternAttempts([
  { problemAttempt: crossFailedAgain, problem: crossProblemA },
  { problemAttempt: crossPassedD, problem: crossProblemD },
  { problemAttempt: crossPassedC, problem: crossProblemC },
  { problemAttempt: crossFailedB, problem: crossProblemB },
  { problemAttempt: crossFailedA, problem: crossProblemA },
]);
const crossReactivatedResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: crossProblemA,
  attempt: crossFailedAgain,
  recentAttempts: [crossFailedAgain],
});
check('a later failure reactivates the archived semantic row instead of creating another', () => {
  const reactivatedCrossMemory = storedMemories.find(
    (memory) => memory.id === crossReactivatedResult.memoryId,
  );
  assert.equal(crossReactivatedResult.action, 'reactivated');
  assert.equal(crossReactivatedResult.state, 'active_gap');
  assert.equal(crossReactivatedResult.memoryId, secondCrossFailureResult.memoryId);
  assert.equal(storedMemories.length, 2);
  assert.equal(reactivatedCrossMemory.status, 'active');
  assert.equal(reactivatedCrossMemory.sourceReferences.state, 'active_gap');
  assert.deepEqual(reactivatedCrossMemory.sourceReferences.resolutionPassingAttemptIds, []);
  assert.deepEqual(reactivatedCrossMemory.sourceReferences.resolutionPassingProblemIds, []);
});

const legacyProblemA = cloneProblem(problem, {
  id: 'problem-legacy-a',
  title: '旧版引用共享',
  tags: ['Aliasing', 'Mutable Objects'],
});
const legacyProblemB = cloneProblem(problem, {
  id: 'problem-legacy-b',
  title: '新版引用共享',
  tags: ['mutable objects', 'ＡＬＩＡＳＩＮＧ'],
});
const legacyFailedA = attempt('attempt-legacy-failed-a', 'failed', 21, 'answer', legacyProblemA.id);
const legacyFailedB = attempt('attempt-legacy-failed-b', 'failed', 22, 'answer', legacyProblemB.id);
storedMemories.push({
  id: 'legacy-version-2-memory',
  ownerId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  targetType: 'notebook',
  scope: 'private',
  kind: 'problem_attempt_signal',
  status: 'active',
  source: 'problem_attempt_inference',
  title: '稳定薄弱点：旧版引用共享',
  text: 'legacy',
  reason: 'legacy',
  question: null,
  sourceReferences: {
    version: 2,
    memoryKey: 'problem-attempt-learning:notebook:notebook-1:problem-legacy-a',
    signalType: 'problem_attempt_learning_state',
    state: 'active_gap',
    sourceType: 'problem_attempt',
    problemId: legacyProblemA.id,
    problemTitle: legacyProblemA.title,
    courseId: 'course-1',
    notebookId: 'notebook-1',
    attemptIds: [legacyFailedA.id],
    nonPassingAttemptIds: [legacyFailedA.id],
    passingAttemptIds: [],
    latestAttemptId: legacyFailedA.id,
    latestAttemptStatus: 'failed',
    tags: legacyProblemA.tags,
  },
  createdAt: new Date(20),
  updatedAt: new Date(20),
});
setPatternAttempts([
  { problemAttempt: legacyFailedB, problem: legacyProblemB },
  { problemAttempt: legacyFailedA, problem: legacyProblemA },
]);
const legacyUpgradeResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: legacyProblemB,
  attempt: legacyFailedB,
  recentAttempts: [legacyFailedB],
});
const upgradedLegacyMemory = storedMemories.find(
  (memory) => memory.id === 'legacy-version-2-memory',
);
check('version 2 singular problem evidence upgrades into the semantic record', () => {
  assert.equal(legacyUpgradeResult.action, 'strengthened');
  assert.equal(legacyUpgradeResult.memoryId, 'legacy-version-2-memory');
  assert.equal(upgradedLegacyMemory.sourceReferences.version, 3);
  assert.deepEqual(upgradedLegacyMemory.sourceReferences.problemIds, [
    'problem-legacy-a',
    'problem-legacy-b',
  ]);
  assert.deepEqual(upgradedLegacyMemory.sourceReferences.nonPassingAttemptIds, [
    'attempt-legacy-failed-a',
    'attempt-legacy-failed-b',
  ]);
});

const untaggedProblemA = cloneProblem(problem, {
  id: 'problem-untagged-a',
  title: '无标签题 A',
  tags: [],
});
const untaggedProblemB = cloneProblem(problem, {
  id: 'problem-untagged-b',
  title: '无标签题 B',
  tags: [],
});
const untaggedFailedA1 = attempt(
  'attempt-untagged-a-1',
  'failed',
  31,
  'answer',
  untaggedProblemA.id,
);
const untaggedFailedA2 = attempt(
  'attempt-untagged-a-2',
  'failed',
  32,
  'answer',
  untaggedProblemA.id,
);
const untaggedFailedB1 = attempt(
  'attempt-untagged-b-1',
  'failed',
  33,
  'answer',
  untaggedProblemB.id,
);
const untaggedFailedB2 = attempt(
  'attempt-untagged-b-2',
  'partial',
  34,
  'answer',
  untaggedProblemB.id,
);
setPatternAttempts([
  { problemAttempt: untaggedFailedA2, problem: untaggedProblemA },
  { problemAttempt: untaggedFailedA1, problem: untaggedProblemA },
]);
const untaggedAResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: untaggedProblemA,
  attempt: untaggedFailedA2,
  recentAttempts: [untaggedFailedA2, untaggedFailedA1],
});
setPatternAttempts([
  { problemAttempt: untaggedFailedB1, problem: untaggedProblemB },
  { problemAttempt: untaggedFailedA2, problem: untaggedProblemA },
  { problemAttempt: untaggedFailedA1, problem: untaggedProblemA },
]);
const untaggedBFirstResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: untaggedProblemB,
  attempt: untaggedFailedB1,
  recentAttempts: [untaggedFailedB1],
});
check('an untagged problem cannot borrow another untagged problem evidence', () => {
  assert.equal(untaggedAResult.action, 'created');
  assert.equal(untaggedBFirstResult.action, 'skipped');
  assert.equal(untaggedBFirstResult.memoryId, null);
});

setPatternAttempts([
  { problemAttempt: untaggedFailedB2, problem: untaggedProblemB },
  { problemAttempt: untaggedFailedB1, problem: untaggedProblemB },
]);
const untaggedBSecondResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: untaggedProblemB,
  attempt: untaggedFailedB2,
  recentAttempts: [untaggedFailedB2, untaggedFailedB1],
});
check('each untagged problem creates its own durable row after its own repeat', () => {
  assert.equal(untaggedBSecondResult.action, 'created');
  assert.notEqual(untaggedAResult.memoryId, untaggedBSecondResult.memoryId);
});

const untaggedPassedA1 = attempt(
  'attempt-untagged-a-pass-1',
  'passed',
  35,
  'answer',
  untaggedProblemA.id,
);
setPatternAttempts([
  { problemAttempt: untaggedPassedA1, problem: untaggedProblemA },
  { problemAttempt: untaggedFailedA2, problem: untaggedProblemA },
  { problemAttempt: untaggedFailedA1, problem: untaggedProblemA },
]);
const untaggedImprovingResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: untaggedProblemA,
  attempt: untaggedPassedA1,
  recentAttempts: [untaggedPassedA1, untaggedFailedA2, untaggedFailedA1],
});
const untaggedPassedA2 = attempt(
  'attempt-untagged-a-pass-2',
  'passed',
  36,
  'answer',
  untaggedProblemA.id,
);
setPatternAttempts([
  { problemAttempt: untaggedPassedA2, problem: untaggedProblemA },
  { problemAttempt: untaggedPassedA1, problem: untaggedProblemA },
  { problemAttempt: untaggedFailedA2, problem: untaggedProblemA },
  { problemAttempt: untaggedFailedA1, problem: untaggedProblemA },
]);
const untaggedStillImprovingResult = await maybeWriteProblemAttemptMemorySignal({
  prisma: fakePrisma,
  userId: 'user-1',
  courseId: 'course-1',
  notebookId: 'notebook-1',
  problem: untaggedProblemA,
  attempt: untaggedPassedA2,
  recentAttempts: [untaggedPassedA2, untaggedPassedA1],
});
check('an untagged problem cannot close its gap by repeated passes on itself', () => {
  const untaggedMemory = storedMemories.find(
    (memory) => memory.id === untaggedStillImprovingResult.memoryId,
  );
  assert.equal(untaggedImprovingResult.action, 'improving');
  assert.equal(untaggedStillImprovingResult.action, 'improving');
  assert.equal(untaggedStillImprovingResult.memoryId, untaggedAResult.memoryId);
  assert.equal(untaggedMemory.status, 'active');
  assert.deepEqual(untaggedMemory.sourceReferences.resolutionPassingProblemIds, [
    untaggedProblemA.id,
  ]);
});

console.log(
  JSON.stringify(
    {
      contract: 'problem-attempt-memory-signals-v3',
      passed: checks.length,
      failed: 0,
      checks,
    },
    null,
    2,
  ),
);
