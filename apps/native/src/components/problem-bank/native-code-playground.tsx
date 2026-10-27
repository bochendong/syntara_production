import { useState } from 'react';
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
}: {
  code: string;
  files: NotebookCodeFile[];
  stdin?: string;
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
  return (
    <section style={{ padding: 12, borderTop: '1px solid #e2e8f0' }} aria-label="自己试">
      <div style={{ display: 'flex', gap: 8 }}>
        <label>
          {' '}
          &gt;&gt;&gt;{' '}
          <input
            value={expression}
            onChange={(event) => setExpression(event.target.value)}
            aria-label="自己试表达式"
          />
        </label>
        <button type="button" onClick={() => void run()} disabled={running}>
          {running ? '运行中…' : '自己试'}
        </button>
      </div>
      {(stdin !== undefined || /\binput\s*\(/.test(code)) && (
        <label>
          输入{' '}
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            aria-label="程序输入"
          />
        </label>
      )}
      {[...files.filter((file) => file.role !== 'expected_output'), ...(result?.files ?? [])].map(
        (file, index) => (
          <details key={`${file.path}-${index}`}>
            <summary>{file.path}</summary>
            {file.path.toLowerCase().endsWith('.csv') ? (
              <table>
                <tbody>
                  {csvRows(file.content).map((row, i) => (
                    <tr key={i}>
                      {row.map((cell, j) => (
                        <td key={j}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <pre>{file.content}</pre>
            )}
          </details>
        ),
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <pre>
          {result.stdout}
          {result.error ? `\n${result.error}` : ''}
        </pre>
      )}
    </section>
  );
}
