import { NativeCodeTests, type ServerCodeTestRun } from './native-code-tests';
import { visibleCodeTests } from '../../../../../lib/problem-bank/visible-code-tests';
import { useRef, useState } from 'react';
import { Eye, Loader2, Play, Plus, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  runPythonScriptInBrowser,
  type BrowserScriptResult,
} from '../../../../../lib/client/browser-python';
import type { NotebookCodeFile } from '../../../../../lib/problem-bank/schema';
import type { RevealedHiddenTests } from '../../data/platform-api-client';

function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted && ch === '"' && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === ',') {
      row.push(cell);
      cell = '';
    } else if (!quoted && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}

type CustomTest = {
  id: number;
  expression: string;
  result: BrowserScriptResult | null;
  error: string;
  running: boolean;
};

function TestFiles({ files }: { files: Array<{ path: string; content: string }> }) {
  if (!files.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {files.map((file, index) => (
        <details
          key={`${file.path}-${index}`}
          className="group rounded-xl border border-sky-100 bg-white/80 text-xs shadow-sm open:w-full"
        >
          <summary className="cursor-pointer list-none px-3 py-1 font-mono font-semibold text-sky-800">
            {file.path}
          </summary>
          {file.path.toLowerCase().endsWith('.csv') ? (
            <div className="max-h-56 overflow-auto border-t border-sky-50 p-2">
              <table className="border-collapse font-mono text-[11px]">
                <tbody>
                  {csvRows(file.content).map((row, i) => (
                    <tr key={i} className={i === 0 ? 'bg-sky-50 font-semibold' : ''}>
                      {row.map((cell, j) => (
                        <td key={j} className="border border-slate-100 px-2 py-0.5">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <pre className="max-h-56 overflow-auto border-t border-sky-50 p-2 font-mono text-[11px]">
              {file.content}
            </pre>
          )}
        </details>
      ))}
    </div>
  );
}

export function NativeCodePlayground({
  code,
  files,
  stdin,
  example,
  tests = [],
  onRunTests,
  className,
  hiddenTests,
  onViewHiddenTests,
  onRunHiddenTests,
  language,
  onRunScript,
}: {
  code: string;
  files: NotebookCodeFile[];
  stdin?: string;
  /// 占位里给的试法，用这道题自己的例子
  example?: string;
  tests?: ReturnType<typeof visibleCodeTests>;
  onRunTests?: ServerCodeTestRun;
  className?: string;
  hiddenTests?: RevealedHiddenTests;
  onViewHiddenTests?: () => void;
  onRunHiddenTests?: ServerCodeTestRun;
  language?: string;
  /** Racket 等不能在浏览器跑的语言：「自己试」交给服务器运行整段代码 */
  onRunScript?: (program: string) => Promise<BrowserScriptResult>;
}) {
  const nextId = useRef(1);
  const [customTests, setCustomTests] = useState<CustomTest[]>([
    { id: 0, expression: '', result: null, error: '', running: false },
  ]);
  const [input, setInput] = useState(stdin ?? '');
  const updateTest = (id: number, changes: Partial<CustomTest>) => {
    setCustomTests((current) =>
      current.map((test) => (test.id === id ? { ...test, ...changes } : test)),
    );
  };
  async function run(test: CustomTest) {
    if (test.running) return;
    updateTest(test.id, { running: true, error: '', result: null });
    try {
      const expr = test.expression.trim().replace(/^>>>\s*/, '');
      if (onRunScript) {
        // HtDP 顶层表达式会打印自己的值；取最后一行，去掉学生自己测试的汇总
        const output = await onRunScript(expr ? `${code}\n\n${expr}\n` : code);
        const printed = output.stdout.replace(
          /\n?(?:The test passed!|All \d+ tests passed!|Ran \d+ tests?\.)[\s\S]*$/,
          '',
        );
        updateTest(test.id, {
          result: {
            ...output,
            stdout: expr ? (printed.trimEnd().split('\n').at(-1) ?? '') : output.stdout,
          },
        });
        return;
      }
      const result = await runPythonScriptInBrowser({
        code: expr ? `${code}\n\nprint(repr(${expr}))\n` : code,
        files: files.filter((file) => file.role !== 'expected_output'),
        stdin: input,
      });
      updateTest(test.id, { result });
    } catch (cause) {
      updateTest(test.id, { error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      updateTest(test.id, { running: false });
    }
  }
  const inputFiles = files.filter((file) => file.role !== 'expected_output');
  return (
    <>
      <NativeCodeTests
        code={code}
        tests={tests}
        files={files}
        onRunTests={onRunTests}
        language={language}
        assumedHelpersHint={!onRunScript}
      />
      {!onRunTests || onRunScript ? (
        <>
          <section
            aria-label="自己试"
            className={cn('native-code-playground space-y-2', className)}
          >
            {customTests.map((test, index) => (
              <div key={test.id} className="native-code-playground-test">
                <div className="native-code-playground-entry">
                  <span className="native-code-test-number" aria-hidden="true">
                    {tests.length + index + 1}
                  </span>
                  <input
                    value={test.expression}
                    onChange={(event) =>
                      updateTest(test.id, {
                        expression: event.target.value,
                        result: null,
                        error: '',
                      })
                    }
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void run(test);
                      }
                    }}
                    aria-label={`自定义测试 ${tests.length + index + 1} 的表达式`}
                    placeholder={tests[0]?.expression || example || '输入一个表达式，回车运行'}
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    disabled={test.running}
                    className="native-code-playground-input"
                  />
                  <button
                    type="button"
                    onClick={() => void run(test)}
                    disabled={test.running}
                    aria-label={`运行自定义测试 ${tests.length + index + 1}`}
                    className="native-code-playground-run"
                  >
                    {test.running ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Play size={12} />
                    )}
                  </button>
                  {index > 0 ? (
                    <button
                      type="button"
                      aria-label={`删除自定义测试 ${tests.length + index + 1}`}
                      className="native-code-playground-run"
                      disabled={test.running}
                      onClick={() =>
                        setCustomTests((current) => current.filter((row) => row.id !== test.id))
                      }
                    >
                      <X size={13} />
                    </button>
                  ) : null}
                </div>
                {test.error ? (
                  <pre role="alert" className="native-code-playground-result is-error">
                    {test.error}
                  </pre>
                ) : test.result ? (
                  <pre
                    className={cn('native-code-playground-result', test.result.error && 'is-error')}
                  >
                    {test.result.stdout}
                    {test.result.error
                      ? `${test.result.stdout ? '\n' : ''}${test.result.error}`
                      : ''}
                    {!test.result.stdout && !test.result.error ? '∅' : ''}
                  </pre>
                ) : null}
                <TestFiles files={test.result?.files ?? []} />
              </div>
            ))}
            <button
              type="button"
              className="native-code-playground-add"
              onClick={() => {
                const id = nextId.current++;
                setCustomTests((current) => [
                  ...current,
                  { id, expression: '', result: null, error: '', running: false },
                ]);
              }}
            >
              <Plus size={14} /> 添加测试
            </button>
            {stdin !== undefined || /\binput\s*\(/.test(code) ? (
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                aria-label="程序输入"
                rows={2}
                placeholder="stdin"
                spellCheck={false}
                className="block w-full resize-y rounded-lg border border-slate-200 bg-white/90 px-3 py-1.5 font-mono text-xs text-slate-700 outline-none focus:border-sky-400"
              />
            ) : null}
            <TestFiles files={inputFiles} />
          </section>
        </>
      ) : null}
      {onViewHiddenTests ? (
        <section className="native-code-hidden-tests" aria-label="隐藏测试">
          {!hiddenTests ? (
            <button
              type="button"
              className="native-code-playground-add"
              onClick={onViewHiddenTests}
            >
              <Eye size={14} /> 隐藏测试
            </button>
          ) : null}
          {hiddenTests ? (
            <div>
              <NativeCodeTests
                label="隐藏测试"
                language={language}
                code={code}
                files={files}
                tests={hiddenTests.cases.map((test, index) => ({ ...test, id: `hidden-${index}` }))}
                onRunTests={onRunHiddenTests}
              />
              {hiddenTests.hasScript ? (
                <p className="native-code-hidden-note">
                  部分隐藏测试以判题代码配置，无法按用例展示。
                </p>
              ) : null}
              {!hiddenTests.cases.length && !hiddenTests.hasScript ? (
                <p className="native-code-hidden-note">这道题暂无可展示的隐藏测试。</p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
