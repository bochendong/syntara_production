#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = process.cwd();
const sourcePath = path.join(root, 'lib/learning/study-memory.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    esModuleInterop: true,
  },
  fileName: sourcePath,
}).outputText;

const storage = new Map();
globalThis.window = {
  dispatchEvent() {},
};
globalThis.localStorage = {
  getItem(key) {
    return storage.get(key) ?? null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};
globalThis.CustomEvent = class CustomEvent {
  constructor(type, init) {
    this.type = type;
    this.detail = init?.detail;
  }
};

const compiledModule = { exports: {} };
const stubbedRequire = (id) => {
  if (id === '@/lib/learning/default-public-memories') {
    return { getDefaultNotebookPublicMemories: () => [] };
  }
  return require(id);
};
new Function('require', 'module', 'exports', transpiled)(
  stubbedRequire,
  compiledModule,
  compiledModule.exports,
);

const { applyNotebookChatDurableMemory, loadStudyMemory } = compiledModule.exports;
const checks = [];
function check(name, operation) {
  operation();
  checks.push({ name, passed: true });
}

function diagnosis(patch = {}) {
  return {
    category: 'code_review',
    courseRelevant: true,
    knowledgePoint: 'Queue FIFO 与 Stack LIFO',
    masteredSignal: '能使用 Stack 的 public method。',
    stuckPoint: '把单个 Stack 的 LIFO 当成 Queue 的 FIFO。',
    cause: '没有追踪 client 可观察的移除顺序。',
    nextTeachingMove: '用 A、B、C 手算两个结构的移除顺序。',
    confidence: 'high',
    evidenceFromMessage: ['return self._stack.pop()'],
    workingMemoryAction: 'update',
    durableMemoryAction: 'create',
    durableMemoryReason: '学生自产代码直接暴露可复用的顺序模型。',
    layerRouting: {
      sourceOfTruth: 'conversation_message',
      controlFacts: 'read_only',
      shortTerm: 'overwrite',
      longTerm: 'create',
      knowledgeBase: 'read_only',
      knowledgeCache: 'read_only',
    },
    ...patch,
  };
}

const baseArgs = {
  userId: 'memory-contract-user',
  stageId: 'notebook-contract-1',
  notebookName: 'CSC148 ADT',
};

let firstId = '';
check('create stores one structured private learner-state memory', () => {
  const result = applyNotebookChatDurableMemory({
    ...baseArgs,
    sourceMessageId: 'local-message:1001',
    diagnosis: diagnosis(),
  });
  assert.equal(result.outcome, 'created');
  assert.ok(result.item);
  firstId = result.item.id;
  assert.equal(result.item.scope, 'private');
  assert.equal(result.item.source, 'chat');
  assert.equal(result.item.question, undefined);
  assert.equal(result.item.learnerState.knowledgePoint, 'Queue FIFO 与 Stack LIFO');
  assert.equal(result.item.sourceReferences[0].messageId, 'local-message:1001');
});

check('same normalized knowledge point updates the same item instead of duplicating it', () => {
  const result = applyNotebookChatDurableMemory({
    ...baseArgs,
    sourceMessageId: 'local-message:1002',
    diagnosis: diagnosis({ knowledgePoint: 'Queue FIFO 与 Stack LIFO！' }),
  });
  const profile = loadStudyMemory(baseArgs.userId, baseArgs.stageId);
  assert.equal(result.outcome, 'updated');
  assert.equal(result.item.id, firstId);
  assert.equal(profile.privateMemories.length, 1);
  assert.deepEqual(
    result.item.sourceReferences.map((reference) => reference.messageId),
    ['local-message:1002', 'local-message:1001'],
  );
});

check('revise replaces stale weakness fields and can record counter-evidence', () => {
  const result = applyNotebookChatDurableMemory({
    ...baseArgs,
    sourceMessageId: 'local-message:1003',
    diagnosis: diagnosis({
      masteredSignal: '能解释 FIFO，并在新代码中保持最早入队元素先出队。',
      stuckPoint: null,
      cause: null,
      nextTeachingMove: '下一次用独立迁移题复测。',
      durableMemoryAction: 'revise',
      durableMemoryReason: '本轮学生代码提供了直接反证。',
      layerRouting: {
        sourceOfTruth: 'conversation_message',
        controlFacts: 'read_only',
        shortTerm: 'overwrite',
        longTerm: 'revise',
        knowledgeBase: 'read_only',
        knowledgeCache: 'read_only',
      },
    }),
  });
  assert.equal(result.outcome, 'updated');
  assert.equal(result.item.id, firstId);
  assert.equal(result.item.learnerState.stuckPoint, undefined);
  assert.equal(result.item.learnerState.cause, undefined);
  assert.match(result.item.text, /掌握：能解释 FIFO/);
  assert.doesNotMatch(result.item.text, /把单个 Stack/);
});

check('revise without an existing same-key memory is conservatively skipped', () => {
  const result = applyNotebookChatDurableMemory({
    ...baseArgs,
    sourceMessageId: 'local-message:2001',
    diagnosis: diagnosis({
      knowledgePoint: 'Representation Invariants',
      durableMemoryAction: 'revise',
    }),
  });
  assert.equal(result.outcome, 'skipped');
  assert.equal(result.reason, 'missing_existing_for_revise');
  assert.equal(loadStudyMemory(baseArgs.userId, baseArgs.stageId).privateMemories.length, 1);
});

check('skip and empty durable state never mutate local durable memory', () => {
  const before = loadStudyMemory(baseArgs.userId, baseArgs.stageId).privateMemories;
  const skipped = applyNotebookChatDurableMemory({
    ...baseArgs,
    sourceMessageId: 'local-message:3001',
    diagnosis: diagnosis({ durableMemoryAction: 'skip' }),
  });
  const empty = applyNotebookChatDurableMemory({
    ...baseArgs,
    sourceMessageId: 'local-message:3002',
    diagnosis: diagnosis({ masteredSignal: null, stuckPoint: null, cause: null }),
  });
  const after = loadStudyMemory(baseArgs.userId, baseArgs.stageId).privateMemories;
  assert.equal(skipped.reason, 'action_skip');
  assert.equal(empty.reason, 'missing_durable_state');
  assert.deepEqual(after, before);
});

check('durable payload contains no raw chat transcript or assistant answer field', () => {
  const item = loadStudyMemory(baseArgs.userId, baseArgs.stageId).privateMemories[0];
  assert.equal(item.question, undefined);
  assert.equal('assistantAnswer' in item, false);
  assert.doesNotMatch(item.text, /我这样不就行了吗/);
});

console.log(
  JSON.stringify(
    {
      contract: 'notebook-chat-durable-memory-v1',
      passed: checks.length,
      failed: 0,
      checks,
    },
    null,
    2,
  ),
);
