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
  ] = await Promise.all([
    import('../../lib/problem-bank/code-readiness'),
    import('../../lib/server/notebook-problems/judge'),
    import('../../lib/server/notebook-problems/import.core.prompts'),
    import('../../lib/server/notebook-problems/import.core.llm'),
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
      functionSignature: 'def add(a, b):',
      constraints: [],
      publicTests: [
        { id: 'public-1', expression: 'add(1, 2)', expected: '3' },
        { id: 'public-2', expression: 'add(0, 0)', expected: '0' },
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
      secretTests: [
        { id: 'secret-1', expression: 'add(-1, 1)', expected: '0' },
        { id: 'secret-2', expression: 'add(10, 20)', expected: '30' },
        { id: 'secret-3', expression: 'add(2.5, 1.5)', expected: '4.0' },
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
  assert.match(zhPrompt, /优先 choice/);
  assert.match(zhPrompt, /代码输出预测和报错判断/);
  assert.match(zhPrompt, /至少 2 个 public tests 和 3 个 secret tests/);
  assert.match(zhPrompt, /不得使用 input、stdin、print 判分或文件读写/);
  assert.match(zhPrompt, /彼此独立作答和计分的表格行/);

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
