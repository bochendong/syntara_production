#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../..');
const contractPath = resolve(repositoryRoot, 'features/memory/domain/course-answer-contract.ts');
const source = readFileSync(contractPath, 'utf8');
const notebookChatRouteSource = readFileSync(
  resolve(repositoryRoot, 'app/api/notebooks/send-message/route.ts'),
  'utf8',
);
const statelessCourseChatSource = readFileSync(
  resolve(repositoryRoot, 'features/chat/server/stateless-chat.ts'),
  'utf8',
);
const trustedCourseTurnSource = readFileSync(
  resolve(repositoryRoot, 'features/chat/server/trusted-course-turn.ts'),
  'utf8',
);
const codeJudgeSource = readFileSync(
  resolve(repositoryRoot, 'lib/server/notebook-problems/judge.ts'),
  'utf8',
);
const coursePackSource = readFileSync(
  resolve(repositoryRoot, 'lib/server/course-pack-context.ts'),
  'utf8',
);
const memoryWorkflowSource = readFileSync(
  resolve(repositoryRoot, 'features/teaching-orchestrator/domain/fixed-workflows.ts'),
  'utf8',
);
const teacherCourseAgentSource = readFileSync(
  resolve(repositoryRoot, 'features/chat/server/teacher-course-agent.ts'),
  'utf8',
);
const courseRuleStoreSource = readFileSync(
  resolve(repositoryRoot, 'features/memory/server/course-rule-pack-store.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: contractPath,
  reportDiagnostics: true,
});

const compileErrors = (compiled.diagnostics || []).filter(
  (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
);
assert.equal(
  compileErrors.length,
  0,
  compileErrors.map((diagnostic) => diagnostic.messageText).join('\n'),
);

const localModule = { exports: {} };
const evaluate = new Function(
  'require',
  'module',
  'exports',
  '__filename',
  '__dirname',
  compiled.outputText,
);
evaluate(require, localModule, localModule.exports, contractPath, dirname(contractPath));

const {
  COURSE_ANSWER_CONTRACT_TEACHING_MEMORY,
  COURSE_ANSWER_CONTRACT_REGISTRY,
  buildCourseAnswerContractMemorySignal,
  courseAnswerContractSchema,
  formatCourseAnswerContractValidationFailures,
  inferCourseAnswerContractConversationTask,
  inferCourseAnswerContractTask,
  renderCourseAnswerContractPrompt,
  resolveCourseAnswerContractReviewText,
  validateCourseAnswerContract,
} = localModule.exports;

const tests = [];

function test(name, run) {
  tests.push({ name, run });
}

function checkIds(result) {
  return new Set(result.failures.map((failure) => failure.checkId));
}

function validate(input) {
  return validateCourseAnswerContract({
    courseId: 'fixture-course',
    notebookId: 'fixture-notebook',
    notebookName: 'Fixture notebook',
    answerText: '',
    ...input,
  });
}

test('registry schemas, check IDs, and evidence references are stable and valid', () => {
  const registryCheckIds = new Set();
  for (const contract of Object.values(COURSE_ANSWER_CONTRACT_REGISTRY)) {
    assert.equal(courseAnswerContractSchema.safeParse(contract).success, true);
    const evidenceIds = new Set(contract.evidence.map((evidence) => evidence.id));
    for (const check of contract.checks) {
      assert.equal(registryCheckIds.has(check.id), false, `duplicate check id: ${check.id}`);
      registryCheckIds.add(check.id);
      for (const evidenceRef of check.evidenceRefs) {
        assert.equal(
          evidenceIds.has(evidenceRef),
          true,
          `${check.id} has unresolved evidence ref ${evidenceRef}`,
        );
      }
    }
  }
  assert.equal(registryCheckIds.has('csc108.function.docstring.present'), true);
  assert.equal(registryCheckIds.has('csc148.bst.ordering.inclusive'), true);
  assert.equal(
    Object.hasOwn(COURSE_ANSWER_CONTRACT_TEACHING_MEMORY, 'csc148.bst.search.single_branch'),
    true,
  );
});

test('rendered CSC148 contract states inclusive ordering and duplicate policy', () => {
  const prompt = renderCourseAnswerContractPrompt(COURSE_ANSWER_CONTRACT_REGISTRY.CSC148);
  assert.match(prompt, /csc148\.bst\.ordering\.inclusive/);
  assert.match(prompt, /left-subtree value is <= the root/i);
  assert.match(prompt, /right-subtree value is >= the root/i);
  assert.match(prompt, /Duplicates are allowed in either subtree/i);
  assert.match(prompt, /queue\/CSC148\/8_trees\.md:725-743/);
  assert.match(prompt, /learner_memory_extraction:/);
  assert.match(prompt, /knowledgePoint=CSC148 BinarySearchTree ordering invariant/);
  assert.match(prompt, /Never copy the full submission or course source into learner memory/);
});

test('CSC108 review proactively detects a missing docstring', () => {
  const result = validate({
    courseCode: 'CSC108',
    message: [
      '请检查这份作业能不能交：',
      '```python',
      'def is_even(value: int) -> bool:',
      '    return value % 2 == 0',
      '```',
    ].join('\n'),
    answerText: '实现逻辑没有问题，可以提交。',
  });
  assert.equal(checkIds(result).has('csc108.function.docstring.present'), true);
  const memorySignal = buildCourseAnswerContractMemorySignal(result);
  assert.equal(memorySignal?.knowledgePoint, 'CSC108 teacher-style function docstring');
  assert.equal(memorySignal?.masteredSignal, null);
  assert.deepEqual(memorySignal?.evidenceFromMessage, ['def is_even(value: int) -> bool:']);
  assert.match(memorySignal?.nextTeachingMove || '', /purpose sentence/i);
  assert.doesNotMatch(JSON.stringify(memorySignal), /queue\/CSC108/);
});

test('course chat classifier gates implicit CSC108/CSC148 programming turns', () => {
  assert.equal(
    inferCourseAnswerContractTask('请解释 assignment.py 里的这个函数为什么不工作'),
    'code_review',
  );
  assert.equal(
    inferCourseAnswerContractTask('BinarySearchTree 的 RI 和 duplicates 应该怎么写？'),
    'generation',
  );
  assert.equal(
    inferCourseAnswerContractTask('请检查我的 BST 实现是否符合 Representation Invariants'),
    'code_review',
  );
  assert.equal(inferCourseAnswerContractTask('今天这门课讲了什么？'), 'not_applicable');
});

test('server task hint forces validation for an implicit CSC108 .py turn', () => {
  const result = validate({
    courseCode: 'CSC108',
    message: '这是 assignment.py 中的函数：',
    taskHint: 'code_review',
    answerText: '实现看起来没有问题。',
    answerCode: '',
  });
  assert.equal(result.task, 'code_review');
});

test('follow-up review reuses the most recent user-authored code submission', () => {
  const priorCode = [
    '请检查：',
    '```python',
    'def double(value: int) -> int:',
    '    return value * 2',
    '```',
  ].join('\n');
  const resolved = resolveCourseAnswerContractReviewText(
    [priorCode, '继续检查一下'],
    'code_review',
  );
  assert.match(resolved, /def double\(value: int\) -> int:/);
  assert.match(resolved, /Follow-up review request:\n\n继续检查一下/);

  const result = validate({
    courseCode: 'CSC108',
    message: resolved,
    taskHint: 'code_review',
    answerText: '逻辑正确，可以提交。',
  });
  assert.equal(checkIds(result).has('csc108.function.docstring.present'), true);
});

test('naked follow-up inherits the adjacent user code-review task', () => {
  assert.equal(
    inferCourseAnswerContractConversationTask([
      '请检查：\n```python\ndef double(value: int) -> int:\n    return value * 2\n```',
      '继续',
    ]),
    'code_review',
  );
  assert.equal(
    inferCourseAnswerContractConversationTask([
      '请检查：\n```python\ndef double(value: int) -> int:\n    return value * 2\n```',
      '我们换个话题，今天讲了什么？',
      '继续',
    ]),
    'not_applicable',
  );
});

test('follow-up review preserves adjacent visible assignment requirements', () => {
  const resolved = resolveCourseAnswerContractReviewText(
    [
      '作业要求：必须保留给定函数签名，而且不要包含 doctest。',
      '```python\ndef double(value: int) -> int:\n    return value * 2\n```',
      '继续检查',
    ],
    'code_review',
  );
  assert.match(resolved, /Visible assignment requirements:/);
  assert.match(resolved, /不要包含 doctest/);
  assert.match(resolved, /def double\(value: int\) -> int:/);
});

test('notebook chat uses the shared task classifier and taskHint contract gate', () => {
  assert.match(notebookChatRouteSource, /inferCourseAnswerContractTask\(/);
  assert.match(notebookChatRouteSource, /taskHint:\s*courseContractTask/);
  assert.match(
    notebookChatRouteSource,
    /looksLikeProgrammingQuestion\(courseContractInputMessage\)\s*\|\|\s*enforceCourseAnswerContract/,
  );
  assert.match(
    notebookChatRouteSource,
    /courseContractTask === 'code_review'[\s\S]*buildCourseAnswerContractMemorySignal\(/,
  );
  assert.match(
    notebookChatRouteSource,
    /answerText:\s*courseContractInputMessage,[\s\S]*taskHint:\s*'grading'/,
  );
  assert.match(notebookChatRouteSource, /applyCourseAnswerContractMemorySignal\(/);
  assert.match(
    notebookChatRouteSource,
    /const finalPlan = withCourseContractMemorySignal\(qualityResult\.plan\);[\s\S]*writeDurableMemoryForPlan\(finalPlan\)/,
  );
  assert.ok(
    notebookChatRouteSource.indexOf('withCourseContractMemorySignal(qualityResult.plan)') <
      notebookChatRouteSource.indexOf('writeDurableMemoryForPlan(finalPlan)'),
  );
});

test('notebook chat buffers contract drafts and fails closed after repair exhaustion', () => {
  assert.match(
    notebookChatRouteSource,
    /!enforceCourseAnswerContract\s*&&\s*answer\.length\s*>\s*emittedAnswerLength/,
  );
  assert.match(
    notebookChatRouteSource,
    /enforceCourseAnswerContract\s*&&\s*currentFailures\.length\s*>\s*0/,
  );
  assert.match(notebookChatRouteSource, /throw new NotebookCourseContractValidationError/);
});

test('all production programming surfaces use the shared course contract gate', () => {
  assert.match(trustedCourseTurnSource, /inferCourseAnswerContractConversationTask\(/);
  assert.match(trustedCourseTurnSource, /validateCourseAnswerContract\(/);
  assert.match(trustedCourseTurnSource, /COURSE_CONTRACT_REPAIR_ATTEMPTS/);
  assert.match(statelessCourseChatSource, /resolveTrustedCourseTurn\(/);
  assert.match(statelessCourseChatSource, /runWithRequestContext\([\s\S]*runTrustedCourseTurn\(/);
  assert.match(codeJudgeSource, /enforceCodeSubmissionCourseContract/);
  assert.match(codeJudgeSource, /taskHint:\s*'grading'/);
  assert.match(coursePackSource, /renderCourseAnswerContractPrompt\(answerContract\)/);
  assert.match(coursePackSource, /proactively inspect the teacher-style docstring/);
  assert.match(coursePackSource, /proactively evaluate the declared Representation Invariants/);
  assert.match(memoryWorkflowSource, /knowledgePoint, masteredSignal/);
  assert.match(
    memoryWorkflowSource,
    /never copy the full submission or course source into memory/i,
  );
});

test('course chat rejects prompt-bearing client context at the server trust boundary', () => {
  assert.match(
    trustedCourseTurnSource,
    /notebooks:\s*serverCourseContext\?\.notebooks\s*\?\?\s*\[\]/,
  );
  assert.match(trustedCourseTurnSource, /layeredMemory:\s*serverCourseContext\?\.layeredMemory/);
  assert.match(
    trustedCourseTurnSource,
    /answererHandoff:\s*serverCourseContext\?\.answererHandoff/,
  );
  assert.match(trustedCourseTurnSource, /resourceStates:\s*serverCourseContext\?\.resourceStates/);
  assert.doesNotMatch(trustedCourseTurnSource, /\.\.\.args\.body\.courseContext/);
});

test('legacy course SSE builds trusted evidence inside the request context', () => {
  const handlerStart = statelessCourseChatSource.indexOf(
    'export async function handleStatelessChatRequest',
  );
  const modelResolution = statelessCourseChatSource.indexOf('await resolveModel(', handlerStart);
  const initialTrustResolution = statelessCourseChatSource.indexOf(
    'await resolveTrustedCourseTurn({ body: parsedBody })',
    handlerStart,
  );
  const requestContextStart = statelessCourseChatSource.indexOf(
    'await runWithRequestContext(',
    handlerStart,
  );
  const trustedContextBuild = statelessCourseChatSource.indexOf(
    'await buildTrustedCourseQuestionContext({',
    requestContextStart,
  );
  const serverContextInjection = statelessCourseChatSource.indexOf(
    'serverCourseContext: serverContext.courseContext',
    trustedContextBuild,
  );
  const generationRun = statelessCourseChatSource.indexOf(
    'await runTrustedCourseTurn({',
    serverContextInjection,
  );

  assert.ok(handlerStart >= 0);
  assert.ok(modelResolution > handlerStart);
  assert.ok(initialTrustResolution > modelResolution);
  assert.ok(requestContextStart > initialTrustResolution);
  assert.ok(trustedContextBuild > requestContextStart);
  assert.ok(serverContextInjection > trustedContextBuild);
  assert.ok(generationRun > serverContextInjection);
});

test('teacher and student course agents share the database-backed rule gateway', () => {
  assert.match(teacherCourseAgentSource, /loadCourseRuleContext\(/);
  assert.match(teacherCourseAgentSource, /validateCourseRulePacks\(/);
  assert.match(teacherCourseAgentSource, /formatCourseRuleGuidance\(/);
  assert.match(courseRuleStoreSource, /loadApplicableCourseRulePacks\(/);
  assert.match(courseRuleStoreSource, /evaluatorKey/);
});

test('CSC108 review identifies a placeholder docstring even when one is present', () => {
  const result = validate({
    courseCode: 'CSC108',
    message: [
      '请检查这份作业：',
      '```python',
      'def is_even(value: int) -> bool:',
      '    """Helper."""',
      '    return value % 2 == 0',
      '```',
    ].join('\n'),
    answerText: '它已经有 docstring，所以可以提交。',
  });
  assert.equal(checkIds(result).has('csc108.function.docstring.description'), true);
});

test('CSC108 generation detects a weak docstring and missing examples', () => {
  const result = validate({
    courseCode: 'CSC108',
    message: '请实现一个 CSC108 函数。',
    answerCode: [
      'def is_even(value: int) -> bool:',
      '    """Return value."""',
      '    return value % 2 == 0',
    ].join('\n'),
  });
  const ids = checkIds(result);
  assert.equal(ids.has('csc108.function.docstring.description'), true);
  assert.equal(ids.has('csc108.function.docstring.examples'), true);
});

test('visible Final Exam no-doctest rule overrides the CSC108 default', () => {
  const message = 'Implement this CSC108 function. Do not include doctests.';
  const invalid = validate({
    courseCode: 'CSC108',
    message,
    answerCode: [
      'def is_even(value: int) -> bool:',
      '    """Return whether value is an even integer.',
      '',
      '    >>> is_even(2)',
      '    True',
      '    """',
      '    return value % 2 == 0',
    ].join('\n'),
  });
  assert.equal(checkIds(invalid).has('csc108.function.doctest.forbidden_by_prompt'), true);

  const valid = validate({
    courseCode: 'CSC108',
    message,
    answerCode: [
      'def is_even(value: int) -> bool:',
      '    """Return whether value is an even integer."""',
      '    return value % 2 == 0',
    ].join('\n'),
  });
  assert.deepEqual(formatCourseAnswerContractValidationFailures(valid), []);
});

test('CSC148 rejects the old strict ordering fixture', () => {
  const result = validate({
    courseCode: 'CSC148',
    message: 'Implement a complete BinarySearchTree class.',
    answerCode: [
      'class BinarySearchTree:',
      '    """A binary search tree.',
      '',
      '    Representation Invariants:',
      '        - Every item in self._left is < self._root.',
      '        - Every item in self._right is > self._root.',
      '    """',
      '',
      '    def __init__(self, root: object | None) -> None:',
      '        """Initialize this tree with root."""',
      '        if root is None:',
      '            self._root = None',
      '            self._left = None',
      '            self._right = None',
      '        else:',
      '            self._root = root',
      '            self._left = BinarySearchTree(None)',
      '            self._right = BinarySearchTree(None)',
    ].join('\n'),
  });
  assert.equal(checkIds(result).has('csc148.bst.ordering.inclusive'), true);
});

test('a method-only CSC148 answer is not forced to repeat the whole class RI', () => {
  const result = validate({
    courseCode: 'CSC148',
    message: 'Implement the BinarySearchTree contains method using the course representation.',
    answerCode: [
      'def __contains__(self, item: object) -> bool:',
      '    """Return whether item is stored in this BST."""',
      '    if self.is_empty():',
      '        return False',
      '    if item == self._root:',
      '        return True',
      '    if item < self._root:',
      '        return item in self._left',
      '    return item in self._right',
    ].join('\n'),
  });
  assert.deepEqual(result.failures, []);
});

test('CSC148 review catches insertion that overwrites an existing subtree', () => {
  const result = validate({
    courseCode: 'CSC148',
    message: [
      '请检查这份 BinarySearchTree 作业：',
      '```python',
      'class BinarySearchTree:',
      '    """A BST.',
      '',
      '    Representation Invariants:',
      '        - Every item in self._left is <= self._root.',
      '        - Every item in self._right is >= self._root.',
      '    """',
      '',
      '    def insert(self, item: object) -> None:',
      '        """Insert item into this tree."""',
      '        if item < self._root:',
      '            self._left = BinarySearchTree(item)',
      '        else:',
      '            self._right = BinarySearchTree(item)',
      '```',
    ].join('\n'),
    answerText: '这份代码整体上没问题。',
  });
  assert.equal(checkIds(result).has('csc148.bst.insert.no_subtree_overwrite'), true);
  const memorySignal = buildCourseAnswerContractMemorySignal(result);
  assert.equal(memorySignal?.knowledgePoint, 'CSC148 BinarySearchTree insertion recipe');
  assert.deepEqual(memorySignal?.evidenceFromMessage, ['self._left = BinarySearchTree(item)']);
});

const validCsc148BstClass = [
  'class BinarySearchTree:',
  '    """A binary search tree.',
  '',
  '    Representation Invariants:',
  '        - Every item in self._left is <= self._root.',
  '        - Every item in self._right is >= self._root.',
  '    """',
  '',
  '    def __init__(self, root: object | None) -> None:',
  '        """Initialize this BST."""',
  '        if root is None:',
  '            self._root = None',
  '            self._left = None',
  '            self._right = None',
  '        else:',
  '            self._root = root',
  '            self._left = BinarySearchTree(None)',
  '            self._right = BinarySearchTree(None)',
].join('\n');

test('CSC148 review must explicitly evaluate RI and the course BST recipe', () => {
  const message = ['请检查这份 BST 作业：', '```python', validCsc148BstClass, '```'].join('\n');
  const silent = validate({
    courseCode: 'CSC148',
    message,
    answerText: '代码看起来没问题，可以提交。',
  });
  const silentIds = checkIds(silent);
  assert.equal(silentIds.has('csc148.review.ri.proactive_evaluation'), true);
  assert.equal(silentIds.has('csc148.review.bst.proactive_evaluation'), true);
  assert.equal(buildCourseAnswerContractMemorySignal(silent), null);

  const explicit = validate({
    courseCode: 'CSC148',
    message,
    answerText:
      '我检查了 Representation Invariants：__init__ 在两个分支都建立并保持它们。空树的 _root、_left、_right 都是 None；非空树的左右孩子是 BinarySearchTree(None)。排序 RI 使用左边 <= root、右边 >= root，duplicates 可以在任一边。',
  });
  assert.deepEqual(explicit.failures, []);
});

test('CSC148 class review yields RI teaching state without an RI request', () => {
  const result = validate({
    courseCode: 'CSC148',
    message: [
      '帮我看看这个作业类能不能交：',
      '```python',
      'class Counter:',
      '    """A counter."""',
      '',
      '    def __init__(self, value: int) -> None:',
      '        self.value = value',
      '```',
    ].join('\n'),
    answerText: '初始化逻辑看起来没问题。',
  });
  assert.equal(checkIds(result).has('csc148.ri.heading.exact'), true);
  const memorySignal = buildCourseAnswerContractMemorySignal(result);
  assert.equal(memorySignal?.knowledgePoint, 'CSC148 Representation Invariants');
  assert.equal(memorySignal?.masteredSignal, null);
  assert.ok(memorySignal?.stuckPoint);
  assert.ok(memorySignal?.cause);
  assert.ok(memorySignal?.nextTeachingMove);
  assert.deepEqual(memorySignal?.evidenceFromMessage, ['class Counter:']);
});

test('production preflight grading projection yields four teaching fields for implicit reviews', () => {
  const csc108Turn = [
    '帮我检查这份作业：',
    '```python',
    'def double(value: int) -> int:',
    '    return value * 2',
    '```',
  ].join('\n');
  const csc108Signal = buildCourseAnswerContractMemorySignal(
    validate({
      courseCode: 'CSC108',
      message: csc108Turn,
      answerText: csc108Turn,
      taskHint: 'grading',
    }),
  );
  const csc148Turn = [
    '帮我检查这个类：',
    '```python',
    'class Counter:',
    '    """A counter."""',
    '',
    '    def __init__(self, value: int) -> None:',
    '        self.value = value',
    '```',
  ].join('\n');
  const csc148Signal = buildCourseAnswerContractMemorySignal(
    validate({
      courseCode: 'CSC148',
      message: csc148Turn,
      answerText: csc148Turn,
      taskHint: 'grading',
    }),
  );

  for (const signal of [csc108Signal, csc148Signal]) {
    assert.ok(signal?.knowledgePoint);
    assert.equal(signal?.masteredSignal, null);
    assert.ok(signal?.stuckPoint);
    assert.ok(signal?.cause);
    assert.ok(signal?.nextTeachingMove);
    assert.ok(signal?.evidenceFromMessage.length);
  }
  assert.doesNotMatch(csc108Turn, /docstring/i);
  assert.doesNotMatch(csc148Turn, /Representation Invariants|\bRI\b/i);
});

test('CSC148 review catches general-tree search that ignores BST routing', () => {
  const result = validate({
    courseCode: 'CSC148',
    message: [
      '请检查我的 BST search：',
      '```python',
      'class BinarySearchTree:',
      '    """A binary search tree.',
      '',
      '    Representation Invariants:',
      '        - Every item in self._left is <= self._root.',
      '        - Every item in self._right is >= self._root.',
      '    """',
      '',
      '    def __contains__(self, item: object) -> bool:',
      '        """Return whether item is in this BST."""',
      '        if self.is_empty():',
      '            return False',
      '        return item == self._root or item in self._left or item in self._right',
      '```',
    ].join('\n'),
    answerText:
      '我检查了 Representation Invariants 并确认方法返回前保持 RI；空树用 _root/_left/_right，ordering 使用 <= 和 >=，duplicates 允许。',
  });
  assert.equal(checkIds(result).has('csc148.bst.search.single_branch'), true);
  const memorySignal = buildCourseAnswerContractMemorySignal(result);
  assert.equal(memorySignal?.knowledgePoint, 'CSC148 BinarySearchTree search recipe');
  assert.match(memorySignal?.evidenceFromMessage[0] || '', /self\._left.*self\._right/);
});

test('CSC148 recognizes a renamed course-shaped SearchTree without BST keywords', () => {
  const result = validate({
    courseCode: 'CSC148',
    message: [
      '继续检查这个作业：',
      '```python',
      'class SearchTree:',
      '    """A search tree.',
      '',
      '    Representation Invariants:',
      '        - Every item in self._left is <= self._root.',
      '        - Every item in self._right is >= self._root.',
      '    """',
      '',
      '    def __init__(self, root: object | None) -> None:',
      '        if root is None:',
      '            self._root = None',
      '            self._left = None',
      '            self._right = None',
      '        else:',
      '            self._root = root',
      '            self._left = SearchTree(None)',
      '            self._right = SearchTree(None)',
      '',
      '    def search(self, item: object) -> bool:',
      '        return item == self._root or self._left.search(item) or self._right.search(item)',
      '```',
    ].join('\n'),
    answerText: '我检查了 Representation Invariants，并确认每个方法返回前都保持它们。',
  });
  const ids = checkIds(result);
  assert.equal(ids.has('csc148.review.bst.proactive_evaluation'), true);
  assert.equal(ids.has('csc148.bst.search.single_branch'), true);
});

test('CSC148 renamed SearchTree insertion still yields course-recipe learner evidence', () => {
  const result = validate({
    courseCode: 'CSC148',
    message: [
      '检查这段实现：',
      '```python',
      'class SearchTree:',
      '    """A search tree.',
      '',
      '    Representation Invariants:',
      '        - Every item in self._left is <= self._root.',
      '        - Every item in self._right is >= self._root.',
      '    """',
      '',
      '    def insert(self, item: object) -> None:',
      '        if item < self._root:',
      '            self._left = SearchTree(item)',
      '        else:',
      '            self._right = SearchTree(item)',
      '```',
    ].join('\n'),
    answerText: '我检查了 Representation Invariants，方法返回前保持 RI；ordering 使用 <= 和 >=。',
  });
  assert.equal(checkIds(result).has('csc148.bst.insert.no_subtree_overwrite'), true);
  const signal = buildCourseAnswerContractMemorySignal(result);
  assert.equal(signal?.knowledgePoint, 'CSC148 BinarySearchTree insertion recipe');
  assert.deepEqual(signal?.evidenceFromMessage, ['self._left = SearchTree(item)']);
});

test('CSC148 does not mistake a non-ordered recursive Tree for a BST', () => {
  const result = validate({
    courseCode: 'CSC148',
    message: [
      '检查这个普通递归树：',
      '```python',
      'class Tree:',
      '    def __init__(self, root: object | None) -> None:',
      '        self._root = root',
      '        self._left = None',
      '        self._right = None',
      '',
      '    def insert(self, item: object) -> None:',
      '        self._left = Tree(item)',
      '```',
    ].join('\n'),
    answerText: '这是普通递归树。',
  });
  assert.equal(checkIds(result).has('csc148.review.bst.proactive_evaluation'), false);
  assert.equal(checkIds(result).has('csc148.bst.insert.no_subtree_overwrite'), false);
});

test('a visibly supplied Node representation overrides the default CSC148 shape', () => {
  const result = validate({
    courseCode: 'CSC148',
    message: [
      '题目给定的辅助定义如下，请实现 BST lookup：',
      '```python',
      'class Node:',
      '    def __init__(self, value: int) -> None:',
      '        self.value = value',
      '        self.left: Node | None = None',
      '        self.right: Node | None = None',
      '```',
    ].join('\n'),
    answerCode: [
      'def lookup(root: Node | None, target: int) -> bool:',
      '    """Return whether target occurs below root.',
      '',
      '    >>> lookup(None, 3)',
      '    False',
      '    >>> lookup(Node(3), 3)',
      '    True',
      '    """',
      '    if root is None:',
      '        return False',
      '    if target == root.value:',
      '        return True',
      '    if target < root.value:',
      '        return lookup(root.left, target)',
      '    return lookup(root.right, target)',
    ].join('\n'),
  });
  assert.equal(result.representationProfile, 'visible_problem_override');
  assert.deepEqual(result.failures, []);
});

const strictFixtureText = readFileSync(
  resolve(repositoryRoot, 'scripts/maintenance/csc148-public-memory-concepts.mjs'),
  'utf8',
);
test('persisted CSC148 public-memory fixture no longer teaches strict BST ordering', () => {
  assert.doesNotMatch(strictFixtureText, /left < root < right/);
  assert.doesNotMatch(
    strictFixtureText,
    /Every item in self\._left is < self\._root, and every item in self\._right is > self\._root/,
  );
  assert.match(strictFixtureText, /Duplicates are allowed in either subtree/);
});

let failed = 0;
for (const { name, run } of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error instanceof Error ? error.stack || error.message : error);
  }
}

if (failed > 0) {
  console.error(`\n${failed}/${tests.length} course answer contract checks failed.`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS ${tests.length}/${tests.length} course answer contract checks.`);
}
