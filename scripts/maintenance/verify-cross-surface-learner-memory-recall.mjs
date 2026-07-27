#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const root = process.cwd();
const storePath = path.join(root, 'lib/server/study-memory-store.ts');
const contextPath = path.join(root, 'lib/server/study-memory-context.ts');
const storeSource = fs.readFileSync(storePath, 'utf8');
const contextSource = fs.readFileSync(contextPath, 'utf8');

function compile(source, fileName, stubbedRequire) {
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName,
  }).outputText;
  const compiled = { exports: {} };
  new Function('require', 'module', 'exports', transpiled)(
    stubbedRequire,
    compiled,
    compiled.exports,
  );
  return compiled.exports;
}

const store = compile(storeSource, storePath, (id) => {
  if (id === '@/lib/server/repositories/course-enrollment-repository') {
    return { findCourseAccessRole: async () => null };
  }
  if (id === '@/lib/server/study-memory-vector-store') {
    return { indexStudyMemoryRecord: async () => undefined };
  }
  return require(id);
});

const context = compile(contextSource, contextPath, (id) => {
  if (id === '@/lib/logger') {
    return { createLogger: () => ({ warn: () => undefined }) };
  }
  if (id === '@/lib/server/memory-search-intent') {
    return {
      inferMemorySearchIntent: () => ({
        originalQuery: '',
        rewrittenQuery: '',
        scopeMode: 'course_wide',
        knowledgeTypes: [],
        plan: { primarySources: [], secondarySources: [], searchQueries: [] },
        sourceGrounding: { required: false },
      }),
    };
  }
  if (id.startsWith('@/')) return {};
  return require(id);
});

const checks = [];
function check(name, operation) {
  operation();
  checks.push({ name, passed: true });
}

check('direct cross-surface sources are an explicit learner-only allowlist', () => {
  assert.deepEqual(Array.from(store.DIRECT_COURSE_LEARNER_MEMORY_SOURCES), [
    'notebook_chat_memory_diagnosis',
    'problem_attempt_inference',
  ]);
});

await (async () => {
  const executeSql = [];
  const queries = [];
  const rows = [
    {
      id: 'memory-chat',
      ownerId: 'learner-1',
      courseId: 'course-1',
      notebookId: 'notebook-1',
      targetType: 'notebook',
      scope: 'private',
      kind: 'knowledge_gap',
      status: 'active',
      source: 'notebook_chat_memory_diagnosis',
      title: '学习状态：树递归',
      text: '薄弱：递归参数没有缩小。',
      reason: '学生代码提供直接证据。',
      question: null,
      sourceReferences: { messageReferences: [{ messageId: 'message-1' }] },
      createdAt: new Date('2026-07-20T00:00:00.000Z'),
      updatedAt: new Date('2026-07-23T00:00:00.000Z'),
    },
    {
      id: 'memory-attempt',
      ownerId: 'learner-1',
      courseId: 'course-1',
      notebookId: 'notebook-2',
      targetType: 'notebook',
      scope: 'private',
      kind: 'knowledge_gap',
      status: 'active',
      source: 'problem_attempt_inference',
      title: '稳定薄弱点：树递归',
      text: '同一模式已有两次未通过。',
      reason: '两次正式作答证据。',
      question: null,
      sourceReferences: { attemptIds: ['attempt-1', 'attempt-2'] },
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
    },
  ];
  const prisma = {
    $executeRawUnsafe: async (sql) => {
      executeSql.push(sql);
      return 0;
    },
    $queryRawUnsafe: async (sql, ...params) => {
      queries.push({ sql, params });
      return rows;
    },
  };

  const blankIdentityResult = await store.listRecentPrivateNotebookLearnerMemoriesForCourse(
    prisma,
    ' ',
    'course-1',
  );
  check('blank viewer identity cannot trigger a private-memory query', () => {
    assert.deepEqual(blankIdentityResult, []);
    assert.equal(queries.length, 0);
  });

  const result = await store.listRecentPrivateNotebookLearnerMemoriesForCourse(
    prisma,
    'learner-1',
    'course-1',
    99,
  );

  check('bounded direct query returns serialized recent learner memories', () => {
    assert.equal(result.length, 2);
    assert.equal(result[0].updatedAt, '2026-07-23T00:00:00.000Z');
    assert.ok(executeSql.some((sql) => sql.includes('private_notebook_course_recall_idx')));
  });

  check(
    'SQL is isolated by viewer, course, notebook target, private scope and active status',
    () => {
      assert.equal(queries.length, 1);
      const [{ sql, params }] = queries;
      assert.match(sql, /"ownerId"\s*=\s*\$1/);
      assert.match(sql, /"courseId"\s*=\s*\$2/);
      assert.match(sql, /"targetType"\s*=\s*'notebook'/);
      assert.match(sql, /"scope"\s*=\s*'private'/);
      assert.match(sql, /"status"\s*=\s*'active'/);
      assert.match(sql, /"source"\s+IN\s+\(\$3,\s*\$4\)/);
      assert.match(sql, /ORDER BY\s+"updatedAt"\s+DESC/);
      assert.match(sql, /LIMIT\s+\$5/);
      assert.deepEqual(params, [
        'learner-1',
        'course-1',
        'notebook_chat_memory_diagnosis',
        'problem_attempt_inference',
        12,
      ]);
    },
  );
})();

check('course recall integrates the bounded list independently of semantic vector results', () => {
  assert.match(
    contextSource,
    /recallTarget\.targetType === 'course'[\s\S]*listRecentPrivateNotebookLearnerMemoriesForCourse\(/,
  );
  assert.match(contextSource, /directMemories = uniqueById\(\[[\s\S]*\.\.\.directCourseLearner/);
  assert.match(
    contextSource,
    /Recent private learner memories from course notebooks injected directly/,
  );
});

check('array source references preserve stable learner message evidence', () => {
  const text = context.sourceReferencesText([
    {
      order: 1,
      title: '树递归 learner evidence',
      why: 'Direct student evidence.',
      messageId: 'local-message-1',
      excerpt: 'return size(tree)',
    },
  ]);
  assert.match(text, /local-message-1/);
  assert.match(text, /return size\(tree\)/);
});

check('legacy object source references are not dropped from prompt context', () => {
  const text = context.sourceReferencesText({
    schema: 'openmaic.notebook_chat_learner_memory.v1',
    learnerMemoryKey: 'notebook:notebook-1:tree-recursion',
    knowledgePointKey: 'tree-recursion',
    messageReferences: [
      { messageId: 'local-message-2', role: 'user', excerpt: '这次我还是传回原树' },
    ],
    evidence: ['还是传回原树'],
  });
  assert.match(text, /openmaic\.notebook_chat_learner_memory\.v1/);
  assert.match(text, /tree-recursion/);
  assert.match(text, /local-message-2/);
  assert.match(text, /还是传回原树/);
});

check('problem-attempt object references retain attempt and problem provenance', () => {
  const text = context.sourceReferencesText({
    memoryKey: 'problem-attempt-pattern:tree-recursion',
    state: 'active_gap',
    attemptIds: ['attempt-1', 'attempt-2'],
    problemIds: ['problem-1', 'problem-2'],
  });
  assert.match(text, /active_gap/);
  assert.match(text, /attempt-1/);
  assert.match(text, /problem-1/);
});

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: checks.length,
      passed: checks.length,
      names: checks.map((item) => item.name),
    },
    null,
    2,
  ),
);
