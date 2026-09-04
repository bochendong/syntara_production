#!/usr/bin/env node

import assert from 'node:assert/strict';
import Module from 'node:module';
import path from 'node:path';

async function main() {
  const root = path.resolve(__dirname, '../..');
  type ResolveFilename = (
    request: string,
    parent: NodeModule | undefined,
    isMain: boolean,
    options?: { paths?: string[] },
  ) => string;
  const commonJsModule = Module as unknown as { _resolveFilename: ResolveFilename };
  const originalResolveFilename = commonJsModule._resolveFilename;
  commonJsModule._resolveFilename = function resolveFilename(request, parent, isMain, options) {
    const resolvedRequest = request.startsWith('@/') ? path.join(root, request.slice(2)) : request;
    return originalResolveFilename.call(this, resolvedRequest, parent, isMain, options);
  };

  const [
    { codeDraftReadinessErrors },
    { verifyNotebookCodeDraftReferenceAnswer },
    prompts,
    importLlm,
    importDrafts,
    importText,
  ] = await Promise.all([
    import('../../lib/problem-bank/code-readiness'),
    import('../../lib/server/notebook-problems/judge'),
    import('../../lib/server/notebook-problems/import.core.prompts'),
    import('../../lib/server/notebook-problems/import.core.llm'),
    import('../../lib/server/notebook-problems/import.core.drafts'),
    import('../../lib/server/notebook-problems/import.core.text'),
  ]);

  const validDraft = {
    draftId: 'code-ready-contract',
    title: 'Add two numbers',
    type: 'code' as const,
    status: 'draft' as const,
    source: 'pdf' as const,
    points: 1,
    tags: ['functions'],
    difficulty: 'easy' as const,
    publicContent: {
      type: 'code' as const,
      stem: 'Implement `add(a, b)` and return the sum.',
      language: 'python' as const,
      runnerAdapter: 'python-unittest',
      functionSignature: 'def add(a: float, b: float) -> float:',
      starterCode:
        'def add(a: float, b: float) -> float:\n    """Return the sum of a and b."""\n    pass',
      constraints: [],
      statementSections: [
        {
          id: 'overview',
          title: 'Description',
          kind: 'overview' as const,
          body: 'Add two numbers.',
          items: [],
        },
        {
          id: 'requirements',
          title: 'Requirements',
          kind: 'requirements' as const,
          items: ['Return the sum.'],
        },
        {
          id: 'interface',
          title: 'Interface',
          kind: 'interface' as const,
          code: 'def add(a: float, b: float) -> float:',
          items: [],
        },
        {
          id: 'examples',
          title: 'Examples',
          kind: 'examples' as const,
          body: '`add(1, 2)` returns `3`.',
          items: [],
        },
        {
          id: 'constraints',
          title: 'Constraints',
          kind: 'constraints' as const,
          items: ['a and b are finite numbers.'],
        },
      ],
      publicTests: [
        { id: 'positive_integers', expression: 'add(1, 2)', expected: '3' },
        { id: 'both_zero', expression: 'add(0, 0)', expected: '0' },
      ],
      sampleIO: [],
      secretConfigPresent: true,
    },
    grading: {
      type: 'code' as const,
      solutionCode: 'def add(a, b):\n    return a + b',
      publishRequirementsMet: false,
    },
    secretJudge: {
      language: 'python' as const,
      runnerAdapter: 'python-unittest',
      secretTests: [
        { id: 'opposite_signs', expression: 'add(-1, 1)', expected: '0' },
        { id: 'larger_values', expression: 'add(10, 20)', expected: '30' },
        { id: 'decimal_values', expression: 'add(2.5, 1.5)', expected: '4.0' },
      ],
      timeoutMs: 5000,
    },
    sourceMeta: {},
    validationErrors: [],
  };

  assert.deepEqual(codeDraftReadinessErrors(validDraft), []);
  assert.equal((await verifyNotebookCodeDraftReferenceAnswer(validDraft)).passed, true);

  const printDraft = {
    ...validDraft,
    grading: {
      ...validDraft.grading,
      solutionCode: 'def add(a, b):\n    print(a + b)\n    return a + b',
    },
  };
  assert.match(codeDraftReadinessErrors(printDraft).join('\n'), /不得依赖 input、print/);

  const tooFewTests = {
    ...validDraft,
    publicContent: {
      ...validDraft.publicContent,
      publicTests: validDraft.publicContent.publicTests.slice(0, 1),
    },
  };
  assert.match(codeDraftReadinessErrors(tooFewTests).join('\n'), /至少需要 2 个 public tests/);

  const unsafeTest = {
    ...validDraft,
    publicContent: {
      ...validDraft.publicContent,
      publicTests: [
        ...validDraft.publicContent.publicTests.slice(0, 1),
        { id: 'public-unsafe', expression: '__import__("os").getcwd()', expected: '"/tmp"' },
      ],
    },
  };
  assert.match(codeDraftReadinessErrors(unsafeTest).join('\n'), /必须是单行函数调用/);

  const genericTestIds = {
    ...validDraft,
    publicContent: {
      ...validDraft.publicContent,
      publicTests: [
        { id: 'public_1', expression: 'add(1, 2)', expected: '3' },
        { id: 'public_2', expression: 'add(0, 0)', expected: '0' },
      ],
    },
  };
  assert.match(codeDraftReadinessErrors(genericTestIds).join('\n'), /必须描述测试场景/);

  const wrongAnswer = {
    ...validDraft,
    grading: {
      ...validDraft.grading,
      solutionCode: 'def add(a, b):\n    return a - b',
    },
  };
  const wrongAnswerResult = await verifyNotebookCodeDraftReferenceAnswer(wrongAnswer);
  assert.equal(wrongAnswerResult.passed, false);
  assert.match(wrongAnswerResult.errors.join('\n'), /参考答案未通过 testcase/);

  const zhPrompt = prompts.buildProblemImportSystemPrompt('zh-CN');
  assert.match(zhPrompt, /保持原题的作答方式与认知要求/);
  assert.match(zhPrompt, /code_reading/);
  assert.match(zhPrompt, /至少 2 个 public tests 和 3 个 secret tests/);
  assert.match(zhPrompt, /不得使用 input、stdin、print 判分或文件读写/);
  assert.match(zhPrompt, /彼此独立作答和计分的表格行/);
  assert.match(zhPrompt, /public_tests\.py/);
  assert.match(zhPrompt, /unittest/);
  assert.match(zhPrompt, /rubricCriteria/);

  const sourceWithCode = [
    '运行以下代码后输出什么？',
    '',
    '```python',
    "students = {'Alice': {'math': 85}}",
    'total = 0',
    'for name in students:',
    "    total += students[name]['math']",
    'print(total)',
    '```',
    '',
    '并说明 $total$ 的值。',
  ].join('\n');
  const normalizedSourceWithCode = importText.normalizeMathMarkdown(sourceWithCode);
  assert.match(normalizedSourceWithCode, /```python\nstudents =/);
  assert.match(normalizedSourceWithCode, /\ntotal = 0\n/);
  assert.doesNotMatch(normalizedSourceWithCode, /\$total = 0\$/);
  assert.match(normalizedSourceWithCode, /说明 \$total\$ 的值/);

  const choiceWithoutAnswer = importDrafts.normalizeCandidateDraft(
    {
      title: 'Output prediction',
      type: 'choice',
      points: 1,
      publicContent: {
        type: 'choice',
        stem: 'What is printed?\n\n```python\nprint(1 + 1)\n```',
        selectionMode: 'single',
        options: [
          { id: 'A', label: '`1`' },
          { id: 'B', label: '`2`' },
        ],
      },
      grading: { type: 'choice', correctOptionIds: [] },
    },
    'pdf',
  );
  assert.deepEqual(
    choiceWithoutAnswer.grading.type === 'choice'
      ? choiceWithoutAnswer.grading.correctOptionIds
      : null,
    [],
  );
  assert.match(choiceWithoutAnswer.validationErrors.join('\n'), /缺少可评分的正确答案/);
  assert.equal(choiceWithoutAnswer.publicContent.taskKind, 'code_reading');

  const shortAnswerWithoutCriteria = importDrafts.normalizeCandidateDraft(
    {
      title: 'Explain aliasing',
      type: 'short_answer',
      points: 3,
      publicContent: { type: 'short_answer', stem: 'Explain dictionary aliasing.' },
      grading: { type: 'short_answer', referenceAnswer: 'Two names reference one object.' },
    },
    'pdf',
  );
  assert.match(shortAnswerWithoutCriteria.validationErrors.join('\n'), /rubricCriteria/);

  const processCalculation = importDrafts.normalizeCandidateDraft(
    {
      title: 'Explain the calculation',
      type: 'short_answer',
      points: 3,
      publicContent: {
        type: 'short_answer',
        taskKind: 'calculation',
        stem: 'Compute the result and justify each step.',
      },
      grading: {
        type: 'short_answer',
        referenceAnswer: 'A complete derivation.',
        rubricCriteria: [
          { id: 'setup', description: 'Sets up the expression.', points: 1 },
          { id: 'work', description: 'Shows valid intermediate steps.', points: 1 },
          { id: 'result', description: 'Obtains the correct result.', points: 1 },
        ],
      },
    },
    'pdf',
  );
  assert.equal(processCalculation.publicContent.taskKind, 'calculation');
  assert.doesNotMatch(processCalculation.validationErrors.join('\n'), /rubricCriteria/);

  const invalidShowWorkCalculation = importDrafts.normalizeCandidateDraft(
    {
      title: 'Show work in final-only control',
      type: 'calculation',
      points: 2,
      publicContent: {
        type: 'calculation',
        stem: 'Compute and show every step.',
        showWork: true,
      },
      grading: { type: 'calculation', referenceAnswer: '2', acceptedForms: ['2'] },
    },
    'pdf',
  );
  assert.match(invalidShowWorkCalculation.validationErrors.join('\n'), /short_answer/);

  const numericBlank = importDrafts.normalizeCandidateDraft(
    {
      title: 'Simple sum',
      type: 'fill_blank',
      points: 1,
      publicContent: {
        type: 'fill_blank',
        stemTemplate: '$1+1={{answer}}$',
        blanks: [{ id: 'answer', answerKind: 'number' }],
      },
      grading: {
        type: 'fill_blank',
        blanks: [{ id: 'answer', acceptedAnswers: ['2'], caseSensitive: false }],
      },
    },
    'pdf',
  );
  assert.equal(
    numericBlank.grading.type === 'fill_blank' ? numericBlank.grading.blanks[0]?.matcher : null,
    'numeric_tolerance',
  );

  const futureJavaDraft = {
    ...validDraft,
    publicContent: {
      ...validDraft.publicContent,
      language: 'java',
      runnerAdapter: 'java-junit5',
    },
    secretJudge: {
      ...validDraft.secretJudge,
      language: 'java',
      runnerAdapter: 'java-junit5',
    },
  };
  const futureJavaErrors = codeDraftReadinessErrors(futureJavaDraft).join('\n');
  assert.match(futureJavaErrors, /尚未配置可执行适配器/);
  assert.doesNotMatch(futureJavaErrors, /Python function signature/);

  const functionShortAnswer = {
    ...validDraft,
    draftId: 'promote-function-implementation',
    type: 'short_answer' as const,
    publicContent: {
      type: 'short_answer' as const,
      stem: '实现函数 `add(a, b)`，返回两个数之和。',
    },
    grading: {
      type: 'short_answer' as const,
      referenceAnswer: 'def add(a, b):\n    return a + b',
    },
    secretJudge: undefined,
  };
  const promoted = importLlm.promoteFunctionImplementationDrafts([functionShortAnswer])[0];
  assert.equal(promoted?.type, 'code');
  assert.equal(promoted?.publicContent.type, 'code');
  assert.equal(promoted?.grading.type, 'code');

  const repairedAnswerDraft = {
    ...functionShortAnswer,
    title: 'Model-rewritten title',
    points: 1,
    tags: [],
    grading: {
      type: 'short_answer' as const,
      referenceAnswer: 'def add(a, b):\n    return a + b',
    },
  };
  const originalScoredDraft = {
    ...functionShortAnswer,
    title: 'Original scored problem',
    points: 13,
    tags: ['functions', 'assessment'],
  };
  const mergedAnswerDraft = importLlm.mergeAnswerRepairDraft(
    originalScoredDraft,
    repairedAnswerDraft,
  );
  assert.equal(mergedAnswerDraft.title, 'Original scored problem');
  assert.equal(mergedAnswerDraft.points, 13);
  assert.deepEqual(mergedAnswerDraft.tags, ['functions', 'assessment']);

  assert.equal(
    importLlm.resolveStructureItemPoints({
      index: 1,
      topLevelLabel: 'Q1',
      title: 'Scored problem',
      points: 13,
      problemTypeHint: 'short_answer',
      sourceAnchors: [],
      subparts: [],
      contextBlocks: [],
      visualRefs: [],
      confidence: 1,
    }),
    13,
  );
  assert.equal(
    importLlm.resolveStructureItemPoints({
      index: 2,
      topLevelLabel: 'Q2',
      title: 'Scored subparts',
      problemTypeHint: 'code',
      sourceAnchors: [],
      subparts: [
        { label: 'a', prompt: 'Part a', points: 2 },
        { label: 'b', prompt: 'Part b', points: 4 },
      ],
      contextBlocks: [],
      visualRefs: [],
      confidence: 1,
    }),
    6,
  );

  const corruptFillBlank = {
    ...validDraft,
    draftId: 'corrupt-fill-blank',
    type: 'fill_blank' as const,
    publicContent: {
      type: 'fill_blank' as const,
      stemTemplate: 'pattern = r"{{pattern}}"',
      blanks: [{ id: 'pattern' }],
    },
    grading: {
      type: 'fill_blank' as const,
      blanks: [
        {
          id: 'pattern',
          acceptedAnswers: ['canonicalAnswer', ':', '^([a-z]+)$'],
          caseSensitive: false,
        },
      ],
    },
    secretJudge: undefined,
  };
  assert.equal(importLlm.draftHasCompleteAnswer(corruptFillBlank), false);

  console.log('Assessment-compiler import contracts verified.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
