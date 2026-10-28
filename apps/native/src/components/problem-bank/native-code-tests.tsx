import { useState } from 'react';
import { Check, Loader2, Play, X } from 'lucide-react';
import type { NotebookCodeFile } from '../../../../../lib/problem-bank/schema';
import { runPythonRowsInBrowser } from '../../../../../lib/client/browser-python';
import { visibleCodeTests } from '../../../../../lib/problem-bank/visible-code-tests';
import { highlightPython } from './code-answer-editor';
import './native-code-tests.css';

type TestCase = ReturnType<typeof visibleCodeTests>[number];
type CaseResult = { passed: boolean; actual: string; code: string };
export type ServerCodeTestRun = (
  code: string,
  caseIds?: string[],
) => Promise<{
  cases: Array<{ id: string; passed: boolean; detail?: string }>;
  feedback?: string;
} | null>;

export function NativeCodeTests({
  code,
  tests,
  files,
  onRunTests,
  label = '公开测试',
}: {
  code: string;
  tests: TestCase[];
  files: NotebookCodeFile[];
  onRunTests?: ServerCodeTestRun;
  label?: '公开测试' | '隐藏测试';
}) {
  const [results, setResults] = useState<Record<string, CaseResult>>({});
  const [running, setRunning] = useState<string[]>([]);
  const [error, setError] = useState('');
  async function run(cases: TestCase[]) {
    setRunning(cases.map((test) => test.id));
    setError('');
    const submittedCode = code;
    try {
      if (onRunTests) {
        const result = await onRunTests(
          submittedCode,
          cases.map((test) => test.id),
        );
        if (!result) throw new Error(`${label}暂时无法运行，请重试。`);
        const updates: Record<string, CaseResult> = {};
        for (const test of cases) {
          const index = tests.indexOf(test) + 1;
          const item = result.cases.find(
            (value) => value.id === test.id || value.id.endsWith(`.test_visible_${index}`),
          );
          if (!item) throw new Error(result.feedback || `没有返回这项${label}的结果。`);
          updates[test.id] = {
            passed: item.passed,
            actual: item.detail ?? '',
            code: submittedCode,
          };
        }
        setResults((previous) => ({ ...previous, ...updates }));
        return;
      }
      const rows = await runPythonRowsInBrowser({
        setup: submittedCode,
        files: files.filter((file) => file.role !== 'expected_output'),
        rows: cases.map((test) => ({
          id: test.id,
          code: `import json as _syntara_test_json\n_syntara_test_actual = (${test.expression})\nprint(_syntara_test_json.dumps({"passed": _syntara_test_actual == (${test.expected}), "actual": repr(_syntara_test_actual)}))`,
        })),
      });
      const updates: Record<string, CaseResult> = {};
      for (const row of rows) {
        if (row.errorType) {
          updates[row.id] = { passed: false, actual: row.errorType, code: submittedCode };
        } else {
          const value: unknown = JSON.parse(row.stdout.trim().split('\n').at(-1) ?? '');
          if (
            !value ||
            typeof value !== 'object' ||
            !('passed' in value) ||
            !('actual' in value) ||
            typeof value.passed !== 'boolean' ||
            typeof value.actual !== 'string'
          ) {
            throw new Error('无法读取测试结果，请重新运行。');
          }
          updates[row.id] = { passed: value.passed, actual: value.actual, code: submittedCode };
        }
      }
      setResults((previous) => ({ ...previous, ...updates }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning([]);
    }
  }
  if (!tests.length) return null;
  return (
    <section className="native-code-tests" aria-label={`${label}用例`}>
      {onRunTests && label === '公开测试' ? (
        <p className="native-code-test-hint">本问按题意假定辅助函数正确，可以独立测试。</p>
      ) : null}
      <header>
        <span>
          {label} <small>{tests.length}</small>
        </span>
        <button
          type="button"
          onClick={() => void run(tests)}
          disabled={running.length > 0}
          aria-label={label === '隐藏测试' ? '运行全部隐藏测试' : '运行全部'}
        >
          {running.length ? <Loader2 size={13} className="animate-spin" /> : <Play size={12} />}
          运行全部
        </button>
      </header>
      <div className="native-code-test-list">
        {tests.map((test, index) => {
          const result = results[test.id];
          const stale = result && result.code !== code;
          return (
            <article
              key={test.id}
              className="native-code-test-case"
              data-testid="native-code-test-case"
            >
              <div className="native-code-test-call">
                <span className="native-code-test-number">{index + 1}</span>
                <pre>{highlightPython(test.expression)}</pre>
                <button
                  type="button"
                  aria-label={
                    label === '公开测试' ? `运行测试 ${index + 1}` : `运行隐藏测试 ${index + 1}`
                  }
                  disabled={running.length > 0}
                  onClick={() => void run([test])}
                >
                  {running.includes(test.id) ? (
                    <Loader2 size={13} className="animate-spin" />
                  ) : (
                    <Play size={12} />
                  )}
                </button>
              </div>
              <div className="native-code-test-values">
                <span>
                  预期 <code>{test.expected}</code>
                </span>
                {result ? (
                  <span data-status={stale ? 'stale' : result.passed ? 'passed' : 'failed'}>
                    {stale ? (
                      '待重跑'
                    ) : result.passed ? (
                      <Check size={12} aria-label="通过" />
                    ) : (
                      <X size={12} aria-label="未通过" />
                    )}
                    {result.actual ? (
                      <>
                        实际 <code>{result.actual}</code>
                      </>
                    ) : result.passed ? (
                      '通过'
                    ) : (
                      '未通过'
                    )}
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}
