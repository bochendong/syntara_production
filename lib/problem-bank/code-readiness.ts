import type { NotebookProblemImportDraft } from './schema';

export const MIN_PUBLIC_CODE_TESTS = 2;
export const MIN_SECRET_CODE_TESTS = 3;
export const MIN_TOTAL_CODE_TESTS = MIN_PUBLIC_CODE_TESTS + MIN_SECRET_CODE_TESTS;

const UNSUPPORTED_CODE_IO_RE = /\b(?:input|print|open)\s*\(|\bsys\s*\.\s*stdin\b/;
const UNSAFE_TEST_EXPRESSION_RE =
  /(?:__|\b(?:import|exec|eval|compile|globals|locals|os|sys|subprocess|pathlib|tempfile)\b|[;\r\n])/;
const GENERIC_TEST_ID_RE = /^(?:public|secret|test|case)[_-]?\d+$/i;

export function codeReferenceSolution(draft: NotebookProblemImportDraft): string {
  if (draft.grading.type !== 'code') return '';
  return draft.grading.solutionCode?.trim() || draft.grading.referenceAnswer?.trim() || '';
}

function normalizedTestKey(testCase: { expression: string; expected: string }): string {
  return `${testCase.expression.replace(/\s+/g, ' ').trim()}\u0000${testCase.expected
    .replace(/\s+/g, ' ')
    .trim()}`;
}

export function codeDraftReadinessErrors(draft: NotebookProblemImportDraft): string[] {
  if (
    draft.type !== 'code' ||
    draft.publicContent.type !== 'code' ||
    draft.grading.type !== 'code'
  ) {
    return [];
  }

  const errors: string[] = [];
  const content = draft.publicContent;
  const secretTests = draft.secretJudge?.secretTests ?? [];
  const solution = codeReferenceSolution(draft);
  const functionSignature = content.functionSignature?.trim() || '';
  const runnerAdapter =
    content.runnerAdapter ?? (content.language === 'python' ? 'python-unittest' : '');
  const interfaceCode = [functionSignature, content.starterCode, solution]
    .filter(Boolean)
    .join('\n');

  if (content.language !== 'python' || runnerAdapter !== 'python-unittest') {
    errors.push(
      `代码题语言包 ${content.language}/${runnerAdapter || '未指定'} 尚未配置可执行适配器；当前仅支持 python/python-unittest`,
    );
  }
  if (
    draft.secretJudge &&
    (draft.secretJudge.language !== content.language ||
      (draft.secretJudge.runnerAdapter ?? runnerAdapter) !== runnerAdapter)
  ) {
    errors.push('代码题公开语言包与隐藏测试必须使用同一个 runner adapter');
  }
  if (content.language !== 'python' || runnerAdapter !== 'python-unittest') {
    return Array.from(new Set(errors));
  }

  if (!functionSignature || !/^\s*(?:async\s+)?def\s+[A-Za-z_]\w*\s*\(/m.test(functionSignature)) {
    errors.push('代码题缺少有效的 Python function signature');
  }
  if (functionSignature && !/->\s*[^:]+\s*:/.test(functionSignature)) {
    errors.push('Python function signature 必须包含返回类型注解');
  }
  if (!content.starterCode?.trim()) {
    errors.push('代码题缺少学生编辑器 starterCode');
  } else {
    if (!/^[\s\S]*def\s+[A-Za-z_]\w*\s*\([^)]*:[^)]*\)[\s\S]*->/m.test(content.starterCode)) {
      errors.push('starterCode 必须包含参数类型和返回类型注解');
    }
    if (!/(?:"""[\s\S]+?"""|'''[\s\S]+?''')/.test(content.starterCode)) {
      errors.push('starterCode 必须包含说明参数、返回值和行为的 docstring');
    }
  }
  const statementKinds = new Set(
    (content.statementSections ?? []).map((section) => section.kind ?? 'overview'),
  );
  const requiredStatementKinds = [
    'overview',
    'requirements',
    'interface',
    'examples',
    'constraints',
  ] as const;
  const missingStatementKinds = requiredStatementKinds.filter((kind) => !statementKinds.has(kind));
  if (missingStatementKinds.length > 0) {
    errors.push(`代码题缺少 LeetCode 式题面部分：${missingStatementKinds.join(', ')}`);
  }
  if (!solution) {
    errors.push('代码题缺少参考答案');
  } else if (!/\breturn\b/.test(solution)) {
    errors.push('代码题参考答案必须通过 return 返回结果');
  }
  if (UNSUPPORTED_CODE_IO_RE.test(interfaceCode)) {
    errors.push('代码题不得依赖 input、print、stdin 或文件读写；请改写为参数输入和 return 输出');
  }
  if (content.publicTests.length < MIN_PUBLIC_CODE_TESTS) {
    errors.push(`代码题至少需要 ${MIN_PUBLIC_CODE_TESTS} 个 public tests`);
  }
  if (secretTests.length < MIN_SECRET_CODE_TESTS) {
    errors.push(`代码题至少需要 ${MIN_SECRET_CODE_TESTS} 个 secret tests`);
  }
  if (content.publicTests.length + secretTests.length < MIN_TOTAL_CODE_TESTS) {
    errors.push(`代码题至少需要 ${MIN_TOTAL_CODE_TESTS} 个 tests`);
  }

  const allTests = [...content.publicTests, ...secretTests];
  const ids = allTests.map((testCase) => testCase.id);
  if (new Set(ids).size !== ids.length) {
    errors.push('代码题的 testcase id 必须唯一');
  }
  if (ids.some((id) => GENERIC_TEST_ID_RE.test(id))) {
    errors.push('代码题的 testcase id 必须描述测试场景，不能只写 public_1 或 secret_1');
  }
  const keys = allTests.map(normalizedTestKey);
  if (new Set(keys).size !== keys.length) {
    errors.push('public tests 与 secret tests 不得重复');
  }
  if (allTests.some((testCase) => UNSUPPORTED_CODE_IO_RE.test(testCase.expression))) {
    errors.push('代码题测试只能检查函数返回值，不得使用 input、print、stdin 或文件读写');
  }
  if (allTests.some((testCase) => UNSAFE_TEST_EXPRESSION_RE.test(testCase.expression))) {
    errors.push('AI 生成的 testcase 必须是单行函数调用，不得执行导入、动态代码或系统操作');
  }

  const functionName = functionSignature.match(/\bdef\s+([A-Za-z_]\w*)\s*\(/)?.[1];
  if (
    functionName &&
    allTests.some(
      (testCase) =>
        !new RegExp(`\\b${functionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`).test(
          testCase.expression,
        ),
    )
  ) {
    errors.push(`每个 testcase 都必须调用目标函数 ${functionName}`);
  }

  return Array.from(new Set(errors));
}

export function withoutCodeReadinessErrors(errors: string[]): string[] {
  return errors.filter(
    (error) =>
      !/^代码题/.test(error) &&
      !/^AI 生成的 testcase/.test(error) &&
      !/^每个 testcase/.test(error) &&
      !/^public tests 与 secret tests/.test(error) &&
      !/^参考答案未通过/.test(error),
  );
}
