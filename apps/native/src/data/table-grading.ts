import { matchTableCellLocally, tableCellKey } from '../../../../lib/problem-bank/table-problem';
import type {
  NotebookProblemPublicTable,
  NotebookProblemGradingTable,
} from '../../../../lib/problem-bank/schema';
import { runPythonRowsInBrowser } from '../../../../lib/client/browser-python';
import type { LocalGradeResult } from './local-problem-grading';

export async function gradeNativeTable(
  content: NotebookProblemPublicTable,
  grading: NotebookProblemGradingTable,
  cells: Record<string, string>,
): Promise<LocalGradeResult & { cells: Array<{ key: string; correct: boolean }> }> {
  if (!grading.cells.length) throw new Error('这道表格题缺少标准答案。');
  const verdicts = new Map<string, boolean>();
  const rows: Array<{ id: string; code: string }> = [];
  for (const cell of grading.cells) {
    const key = tableCellKey(cell.rowId, cell.colId);
    const answer = cells[key] ?? '';
    const direct = matchTableCellLocally(cell, answer);
    if (direct !== null) {
      verdicts.set(key, direct);
      continue;
    }
    const code =
      cell.matcher === 'python_value'
        ? `import ast\ndef same(a,b):\n    if type(a) is not type(b): return False\n    if isinstance(a,(list,tuple)): return len(a)==len(b) and all(same(x,y) for x,y in zip(a,b))\n    if isinstance(a,dict): return a.keys()==b.keys() and all(same(a[k],b[k]) for k in a)\n    return a==b\na=ast.literal_eval(${JSON.stringify(answer)})\nanswers=${JSON.stringify(cell.acceptedAnswers)}\nprint(any(same(a,ast.literal_eval(v)) for v in answers))`
        : `print(bool(${(cell.check ?? 'False').replaceAll('{answer}', answer)}))`;
    rows.push({ id: key, code });
  }
  if (rows.length) {
    const runs = await runPythonRowsInBrowser({
      rows,
      setup: content.setupCode,
      files: (content.files ?? []).filter((file) => file.role !== 'expected_output'),
    });
    if (runs.length !== rows.length) throw new Error('表格批改未完成，请重试。');
    for (const run of runs) verdicts.set(run.id, !run.errorType && run.stdout.trim() === 'True');
  }
  const weights = grading.cells.map((cell) => (cell.points && cell.points > 0 ? cell.points : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const result = grading.cells.map((cell) => ({
    key: tableCellKey(cell.rowId, cell.colId),
    correct: verdicts.get(tableCellKey(cell.rowId, cell.colId)) === true,
  }));
  const score =
    result.reduce((sum, cell, index) => sum + (cell.correct ? weights[index] : 0), 0) / total;
  const count = result.filter((cell) => cell.correct).length;
  return {
    status: count === result.length ? 'passed' : count ? 'partial' : 'failed',
    score,
    feedback: `答对 ${count}/${result.length} 格。`,
    autoGraded: true,
    cells: result,
  };
}
