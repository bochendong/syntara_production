import { useState } from 'react';
import { Check, Copy, Play, X } from 'lucide-react';
import { highlightPython } from './code-answer-editor';
import {
  tableAnswerColumns,
  tableCellKey,
  tableRowCode,
  tableRunResultText,
  tableSetupNeedsDisplay,
} from '../../../../../lib/problem-bank/table-problem';
import type { NotebookProblemPublicTable } from '../../../../../lib/problem-bank/schema';
import { runPythonRowsInBrowser } from '../../../../../lib/client/browser-python';
import './native-table-answer.css';

export function NativeTableAnswer({
  content,
  values,
  onChange,
  results,
  disabled,
  locale,
}: {
  content: NotebookProblemPublicTable;
  values: Record<string, string>;
  onChange: (cells: Record<string, string>) => void;
  results?: Array<{ key: string; correct: boolean }>;
  disabled?: boolean;
  locale: 'zh-CN' | 'en-US';
}) {
  const zh = locale === 'zh-CN';
  const [runs, setRuns] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const answerColumns = tableAnswerColumns(content);
  async function run(rowId: string) {
    const code = tableRowCode(content, rowId);
    if (!code) return;
    try {
      const [result] = await runPythonRowsInBrowser({
        rows: [{ id: rowId, code }],
        setup: content.setupCode,
        files: (content.files ?? []).filter((file) => file.role !== 'expected_output'),
      });
      if (result)
        setRuns((previous) => ({
          ...previous,
          [rowId]: result.errorType
            ? tableRunResultText(result)
            : (result.value ?? tableRunResultText(result)),
        }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <div className="native-table-answer">
      {tableSetupNeedsDisplay(content) && (
        <pre className="native-table-setup">{highlightPython(content.setupCode ?? '')}</pre>
      )}
      <div className="native-table-scroll">
        <table>
          <thead>
            <tr>
              <th className="native-table-index">
                <span className="sr-only">{zh ? '行' : 'Row'}</span>
              </th>
              {content.columns.map((column) => (
                <th key={column.id} data-kind={column.cellKind} data-role={column.role}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {content.rows.map((row, index) => (
              <tr key={row.id}>
                <th scope="row" className="native-table-index">
                  <span className="native-table-row-label">
                    {/^(?:\d{1,2}|[a-z])$/i.test(row.id) ? row.id : index + 1}
                  </span>
                  {results && content.runnable && (
                    <button
                      type="button"
                      onClick={() => void run(row.id)}
                      className="native-table-icon-button"
                      title={zh ? '运行这一行' : 'Run this row'}
                      aria-label={zh ? '运行这一行' : 'Run this row'}
                    >
                      <Play size={13} aria-hidden="true" />
                    </button>
                  )}
                  {index > 0 && answerColumns.length > 1 && !disabled && (
                    <button
                      type="button"
                      onClick={() =>
                        onChange({
                          ...values,
                          ...Object.fromEntries(
                            answerColumns.map((column) => [
                              tableCellKey(row.id, column.id),
                              values[tableCellKey(content.rows[index - 1].id, column.id)] ?? '',
                            ]),
                          ),
                        })
                      }
                      className="native-table-icon-button"
                      title={zh ? '复制上一行' : 'Copy previous row'}
                      aria-label={zh ? '复制上一行' : 'Copy previous row'}
                    >
                      <Copy size={13} aria-hidden="true" />
                    </button>
                  )}
                </th>
                {content.columns.map((column) =>
                  column.role === 'given' ? (
                    <td key={column.id} className="native-table-given" data-kind={column.cellKind}>
                      <pre>
                        {column.cellKind === 'code'
                          ? highlightPython(row.cells[column.id] ?? '')
                          : (row.cells[column.id] ?? '')}
                      </pre>
                    </td>
                  ) : (
                    <td key={column.id} className="native-table-answer-cell">
                      <div className="native-table-input-wrap">
                        <textarea
                          aria-label={`${index + 1} ${column.header}`}
                          data-kind={column.cellKind}
                          disabled={disabled}
                          value={values[tableCellKey(row.id, column.id)] ?? ''}
                          onChange={(event) =>
                            onChange({
                              ...values,
                              [tableCellKey(row.id, column.id)]: event.target.value,
                            })
                          }
                          placeholder={zh ? '填写答案…' : 'Enter answer…'}
                          spellCheck={false}
                          autoCapitalize="off"
                          autoCorrect="off"
                          rows={Math.min(
                            8,
                            Math.max(
                              column.cellKind === 'output' ? 3 : 1,
                              (values[tableCellKey(row.id, column.id)] ?? '').split('\n').length,
                            ),
                          )}
                        />
                        <div className="native-table-quick-answers">
                          {(column.cellKind === 'output'
                            ? (content.quickAnswers ?? ['ERROR', 'NOTHING'])
                            : []
                          ).map((answer) => (
                            <button
                              type="button"
                              key={answer}
                              disabled={disabled}
                              onClick={() =>
                                onChange({ ...values, [tableCellKey(row.id, column.id)]: answer })
                              }
                            >
                              {answer === 'ERROR'
                                ? zh
                                  ? '报错'
                                  : 'ERROR'
                                : answer === 'NOTHING'
                                  ? zh
                                    ? '无输出'
                                    : 'NOTHING'
                                  : answer}
                            </button>
                          ))}
                        </div>
                      </div>
                      {results?.find((item) => item.key === tableCellKey(row.id, column.id)) && (
                        <span className="native-table-verdict">
                          {results.find((item) => item.key === tableCellKey(row.id, column.id))
                            ?.correct ? (
                            <Check size={14} aria-label={zh ? '答对' : 'Correct'} />
                          ) : (
                            <X size={14} aria-label={zh ? '答错' : 'Incorrect'} />
                          )}
                        </span>
                      )}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {Object.entries(runs).map(([rowId, output]) => (
        <pre className="native-table-run-output" key={rowId}>
          {rowId} · {output}
        </pre>
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
