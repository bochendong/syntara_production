import { NativeCodeTests, type ServerCodeTestRun } from './native-code-tests';
import { visibleCodeTests } from '../../../../../lib/problem-bank/visible-code-tests';
import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  runPythonScriptInBrowser,
  type BrowserScriptResult,
} from '../../../../../lib/client/browser-python';
import type { NotebookCodeFile } from '../../../../../lib/problem-bank/schema';

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

export function NativeCodePlayground({
  code,
  files,
  stdin,
  example,
  tests = [],
  onRunTests,
  className,
}: {
  code: string;
  files: NotebookCodeFile[];
  stdin?: string;
  /// 占位里给的试法，用这道题自己的例子
  example?: string;
  tests?: ReturnType<typeof visibleCodeTests>;
  onRunTests?: ServerCodeTestRun;
  className?: string;
}) {
  const [expression, setExpression] = useState('');
  const [input, setInput] = useState(stdin ?? '');
  const [result, setResult] = useState<BrowserScriptResult | null>(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  async function run() {
    setRunning(true);
    setError('');
    try {
      const expr = expression.trim().replace(/^>>>\s*/, '');
      setResult(
        await runPythonScriptInBrowser({
          code: expr ? `${code}\n\nprint(repr(${expr}))\n` : code,
          files: files.filter((file) => file.role !== 'expected_output'),
          stdin: input,
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  }
  const inputFiles = [
    ...files.filter((file) => file.role !== 'expected_output'),
    ...(result?.files ?? []),
  ];
  return (
    <>
      <NativeCodeTests code={code} tests={tests} files={files} onRunTests={onRunTests} />
      {!onRunTests ? (
        <>
          <section
            aria-label="自己试"
            className={cn(
              'space-y-2 border-t border-sky-100 bg-[linear-gradient(90deg,rgba(240,249,255,0.9),rgba(255,255,255,0.95)_50%,rgba(245,243,255,0.9))] px-4 py-3',
              className,
            )}
          >
            <div className="flex items-center gap-2">
              <input
                value={expression}
                onChange={(event) => setExpression(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    void run();
                  }
                }}
                aria-label="自己试表达式"
                placeholder={example ? `>>> ${example}` : '>>> 输入一个表达式，回车运行'}
                spellCheck={false}
                autoCapitalize="off"
                autoComplete="off"
                className="h-9 min-w-0 flex-1 rounded-full border border-sky-100 bg-white/90 px-4 font-mono text-xs text-slate-800 shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] outline-none transition placeholder:text-slate-400 focus:border-sky-300 focus:shadow-[0_0_0_3px_rgba(125,211,252,0.25)]"
              />
              <button
                type="button"
                onClick={() => void run()}
                disabled={running}
                aria-label="在本机运行"
                className="relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-gradient-to-br from-white via-sky-100 to-sky-300 text-sky-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_2px_6px_rgba(14,165,233,0.25)] transition hover:scale-105 disabled:opacity-70"
              >
                {running ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Play className="h-3.5 w-3.5 fill-current" />
                )}
              </button>
            </div>
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
            {inputFiles.length ? (
              <div className="flex flex-wrap gap-1.5">
                {inputFiles.map((file, index) => (
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
            ) : null}
            {error ? (
              <pre
                role="alert"
                className="whitespace-pre-wrap rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 font-mono text-xs text-rose-700"
              >
                {error}
              </pre>
            ) : result ? (
              <pre
                className={cn(
                  'max-h-48 overflow-auto whitespace-pre-wrap rounded-xl border px-3 py-2 font-mono text-xs shadow-sm',
                  result.error
                    ? 'border-rose-200 bg-rose-50 text-rose-700'
                    : 'border-emerald-200 bg-white text-slate-800',
                )}
              >
                {result.stdout}
                {result.error ? `${result.stdout ? '\n' : ''}${result.error}` : ''}
                {!result.stdout && !result.error ? '∅' : ''}
              </pre>
            ) : null}
          </section>
        </>
      ) : null}
    </>
  );
}
