import { useState } from 'react';
import {
  tableAnswerColumns,
  tableCellKey,
  tableRowCode,
  tableRunResultText,
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
      {content.setupCode && <pre>{content.setupCode}</pre>}
      <table>
        <thead>
          <tr>
            <th></th>
            {content.columns.map((column) => (
              <th key={column.id}>{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {content.rows.map((row, index) => (
            <tr key={row.id}>
              <td>
                {results && content.runnable && (
                  <button type="button" onClick={() => void run(row.id)} aria-label="运行这一行">
                    ▶
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
                    aria-label="复制上一行"
                  >
                    ↓
                  </button>
                )}
              </td>
              {content.columns.map((column) =>
                column.role === 'given' ? (
                  <td key={column.id}>
                    <pre>{row.cells[column.id] ?? ''}</pre>
                  </td>
                ) : (
                  <td key={column.id}>
                    <textarea
                      aria-label={`${row.id} ${column.header}`}
                      disabled={disabled}
                      value={values[tableCellKey(row.id, column.id)] ?? ''}
                      onChange={(event) =>
                        onChange({
                          ...values,
                          [tableCellKey(row.id, column.id)]: event.target.value,
                        })
                      }
                      rows={2}
                    />
                    {(content.quickAnswers?.length
                      ? content.quickAnswers
                      : ['ERROR', 'NOTHING']
                    ).map((answer) => (
                      <button
                        type="button"
                        key={answer}
                        disabled={disabled}
                        onClick={() =>
                          onChange({ ...values, [tableCellKey(row.id, column.id)]: answer })
                        }
                      >
                        {answer === 'ERROR' ? '报错' : answer === 'NOTHING' ? '无输出' : answer}
                      </button>
                    ))}
                    {results?.find((item) => item.key === tableCellKey(row.id, column.id)) && (
                      <span>
                        {results.find((item) => item.key === tableCellKey(row.id, column.id))
                          ?.correct
                          ? '✓'
                          : '✗'}
                      </span>
                    )}
                    {runs[row.id] && <pre>{runs[row.id]}</pre>}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
