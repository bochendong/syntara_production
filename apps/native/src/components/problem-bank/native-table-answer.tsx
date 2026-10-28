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
}: {
  content: NotebookProblemPublicTable;
  values: Record<string, string>;
  onChange: (cells: Record<string, string>) => void;
  results?: Array<{ key: string; correct: boolean }>;
  disabled?: boolean;
}) {
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
                <span className="sr-only">行</span>
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
                      title="运行这一行"
                      aria-label="运行这一行"
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
                      title="复制上一行"
                      aria-label="复制上一行"
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
                          placeholder="填写答案…"
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
                                ? '报错'
                                : answer === 'NOTHING'
                                  ? '无输出'
                                  : answer}
                            </button>
                          ))}
                        </div>
                      </div>
                      {results?.find((item) => item.key === tableCellKey(row.id, column.id)) && (
                        <span className="native-table-verdict">
                          {results.find((item) => item.key === tableCellKey(row.id, column.id))
                            ?.correct ? (
                            <Check size={14} aria-label="答对" />
                          ) : (
                            <X size={14} aria-label="答错" />
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
