import type { NotebookProblemImportDraft } from './schema';
import { assembleCodeFromSlots } from './code-slots';
import { formatPartLabel, multipartCodePartDrafts } from './multipart';

export const MIN_PUBLIC_CODE_TESTS = 2;
export const MIN_SECRET_CODE_TESTS = 3;
export const MIN_TOTAL_CODE_TESTS = MIN_PUBLIC_CODE_TESTS + MIN_SECRET_CODE_TESTS;

const UNSUPPORTED_CODE_IO_RE = /\b(?:input|print|open)\s*\(|\bsys\s*\.\s*stdin\b/;
const UNSAFE_TEST_EXPRESSION_RE =
  /(?:__|\b(?:import|exec|eval|compile|globals|locals|os|sys|subprocess|pathlib|tempfile)\b|[;\r\n])/;
const GENERIC_TEST_ID_RE = /^(?:public|secret|test|case)[_-]?\d+$/i;

export function codeReferenceSolution(draft: NotebookProblemImportDraft): string {
  if (draft.grading.type !== 'code') return '';
  const direct = draft.grading.solutionCode?.trim() || draft.grading.referenceAnswer?.trim();
  if (direct) return direct;
  // 只给了每个空位的答案时，拼回整段代码
  const slots = draft.publicContent.type === 'code' ? draft.publicContent.slots : undefined;
  const template = draft.publicContent.type === 'code' ? draft.publicContent.template : undefined;
  if (template && slots?.length && draft.grading.solutionSlots) {
    return assembleCodeFromSlots(template, slots, draft.grading.solutionSlots);
  }
  return '';
}

function normalizedTestKey(testCase: { expression: string; expected: string }): string {
  return `${testCase.expression.replace(/\s+/g, ' ').trim()}\u0000${testCase.expected
    .replace(/\s+/g, ' ')
    .trim()}`;
}

/** 大题里代码小问的错误统一以「代码题小问 (x)：」开头，和整道代码题的错误一起被清理、重算。 */
export function codePartErrorPrefix(label: string): string {
  return `代码题小问 ${formatPartLabel(label)}：`;
}

export function codeDraftReadinessErrors(draft: NotebookProblemImportDraft): string[] {
  if (draft.type === 'multipart') {
    return multipartCodePartDrafts(draft).flatMap(({ label, draft: partDraft }) =>
      codeDraftReadinessErrors(partDraft).map(
        (error) => `${codePartErrorPrefix(label)}${error.replace(/^代码题/, '')}`,
      ),
    );
  }
  if (
    draft.type !== 'code' ||
    draft.publicContent.type !== 'code' ||
    draft.grading.type !== 'code'
  ) {
    return [];
  }

  const errors: string[] = [];
  const content = draft.publicContent;
  if (new Set(content.sampleIO.map((sample) => sample.input.trim())).size < 2)
    errors.push('代码题至少需要 2 个可执行并已验证的 sampleIO 示例');
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

  if (!content.starterCode?.trim()) errors.push('代码题缺少学生编辑器 starterCode');
  // Source questions may specify their interface and examples in the supplied
  // header/docstring. Fixed presentation sections must not force filler text.
  if (!solution) {
    errors.push('代码题缺少参考答案');
  }
  if (content.publicTestCode !== undefined || draft.secretJudge?.secretTestCode !== undefined) {
    if (
      !(content.publicTestCode !== undefined
        ? content.publicTestCode.trim()
        : content.publicTests.length)
    )
      errors.push('代码题缺少公开测试代码');
    if (
      !(draft.secretJudge?.secretTestCode !== undefined
        ? draft.secretJudge.secretTestCode.trim()
        : secretTests.length)
    )
      errors.push('代码题缺少隐藏测试代码');
    return Array.from(new Set(errors));
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
