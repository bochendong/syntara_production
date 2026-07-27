import type { NotebookContentMatrixBlock } from './schema';

export function matrixBlockToLatex(block: Pick<NotebookContentMatrixBlock, 'rows' | 'brackets'>) {
  const rows = block.rows
    .map((row) => row.map((cell) => cell.trim() || '0').join(' & '))
    .join(' \\\\ ');
  return `\\begin{${block.brackets}}${rows}\\end{${block.brackets}}`;
}

export function estimateLatexDisplayHeight(latex: string, display = true): number {
  const normalized = latex.trim();
  if (!normalized) return display ? 64 : 42;

  let height = display ? 64 : 42;

  if (/\\begin\{(matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases|array)\}/.test(normalized)) {
    const rowCount = Math.max(1, normalized.split('\\\\').length);
    height = Math.max(height, 76 + rowCount * 28);
  }
  if (/\\frac|\\dfrac|\\cfrac/.test(normalized)) height += 14;
  if (/\\sum|\\prod|\\int|\\lim/.test(normalized)) height += 16;
  if (/\^\{.*?\}|\_\{.*?\}/.test(normalized)) height += 8;
  if (normalized.length > 90) height += 10;

  return Math.max(display ? 56 : 38, Math.min(180, height));
}

export function estimateCodeBlockHeight(code: string, extraLines = 0): number {
  const lineCount = code.split('\n').length + extraLines;
  return Math.min(220, Math.max(84, lineCount * 18 + 28));
}
