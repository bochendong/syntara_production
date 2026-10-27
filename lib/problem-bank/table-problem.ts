import type {
  NotebookProblemPublicTable,
  NotebookTableCellGrading,
  NotebookTableColumn,
} from './schema';

/** 表格题的格子 key：answer.cells / result.cells 都用它。 */
export function tableCellKey(rowId: string, colId: string): string {
  return `${rowId}:${colId}`;
}

export function tableAnswerColumns(content: NotebookProblemPublicTable): NotebookTableColumn[] {
  return content.columns.filter((column) => column.role === 'answer');
}

export function tableAnswerKeys(content: NotebookProblemPublicTable): string[] {
  const columns = tableAnswerColumns(content);
  return content.rows.flatMap((row) => columns.map((column) => tableCellKey(row.id, column.id)));
}

/** 一行里第一个 code 格，就是这一行要运行的片段。 */
export function tableRowCode(content: NotebookProblemPublicTable, rowId: string): string | null {
  const row = content.rows.find((item) => item.id === rowId);
  const column = content.columns.find((item) => item.role === 'given' && item.cellKind === 'code');
  const code = row && column ? row.cells[column.id] : undefined;
  return code?.trim() ? code : null;
}

/** print 输出的比较方式：去掉行尾空格和末尾空行。 */
export function normalizeTableOutput(value: string): string {
  return value
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

function isKeyword(value: string, keyword: 'ERROR' | 'NOTHING') {
  return value.trim().toUpperCase().startsWith(keyword);
}

/**
 * 不需要 Python 就能判的格子在这里判；python_value / run_check 返回 null，交给服务器运行。
 * ERROR 开头算写了 ERROR（后面的原因不卡分）。
 */
export function matchTableCellLocally(
  cell: NotebookTableCellGrading,
  answer: string,
): boolean | null {
  const trimmed = answer.trim();
  if (!trimmed) return false;
  if (cell.acceptedAnswers.some((accepted) => isKeyword(accepted, 'ERROR'))) {
    if (isKeyword(trimmed, 'ERROR')) return true;
  }
  if (cell.acceptedAnswers.some((accepted) => accepted.trim().toUpperCase() === 'NOTHING')) {
    if (trimmed.toUpperCase() === 'NOTHING') return true;
  }
  if (isKeyword(trimmed, 'ERROR') || trimmed.toUpperCase() === 'NOTHING') return false;
  if (cell.matcher === 'python_value' || cell.matcher === 'run_check') return null;
  if (cell.matcher === 'normalized_exact') {
    const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').toLowerCase();
    return cell.acceptedAnswers.some((accepted) => normalize(accepted) === normalize(trimmed));
  }
  const output = normalizeTableOutput(answer);
  return cell.acceptedAnswers.some((accepted) => normalizeTableOutput(accepted) === output);
}

/** 一行代码真跑出来的结果，写成和学生答案同样的格式。 */
export function tableRunResultText(run: { stdout: string; errorType?: string | null }): string {
  if (run.errorType) return `ERROR (${run.errorType})`;
  const output = normalizeTableOutput(run.stdout);
  return output || 'NOTHING';
}
